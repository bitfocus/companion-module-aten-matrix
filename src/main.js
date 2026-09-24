import { InstanceBase, InstanceStatus, TelnetHelper } from '@companion-module/base'
import { getActions } from './actions.js'
import { getFeedbacks } from './feedbacks.js'
import { getPresetDefinitions } from './presets.js'
import { getVariableDefinitions, getVariableValues } from './variables.js'
import { getConfigFields } from './config.js'
import * as web from './http.js'
import { UpgradeScripts } from './upgrades.js'
import { getDeviceSize, getSizeIdForModel, pad2, SELECTED_PORT } from './utils.js'

export { UpgradeScripts }

// The matrix listens for Telnet on 23 and offers no way to change that
const TELNET_PORT = 23

// What the matrix ships with, and what it falls back to after a factory reset
const FACTORY_DEFAULT_PASSWORD = 'password'

// Lines the matrix sends that carry no state for us: the masked echo of a password we
// typed, and the chatter around the forced password change. Confirmed on a VM0808HB -
// anything else still gets logged, so new firmware wording doesn't vanish silently.
const IGNORED_LINES = [
	/^\*+$/,
	/Password Successful/i,
	/For security reasons/i,
	/required to change the account password/i,
]

export default class AtenMatrixInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.telnetPort = TELNET_PORT // not configurable on the matrix; a seam for tests
	}

	async init(config) {
		this.config = config
		this.outputs = [] // index is output number, value is input routed to it
		this.state = {
			selectedSource: undefined, // input picked via "Select source for take"
			selectedDestination: undefined, // output picked via "Select destination for take"
		}
		this.login = false
		this.lastPreset = undefined // last preset number recalled via the Recall Preset action
		this.firmwareVersion = undefined
		this.detectedModel = undefined // model name the matrix reported when logging in
		this.portNames = { input: {}, output: {}, preset: {} } // names from the web interface
		this.sinkActive = {} // output number -> whether something is plugged into it
		this.savedPresets = undefined // profile slots in use, once the web interface says so
		this.pollTime = 15 // re-poll the full routing status this often, as a safety net on top
		// of the instant "Switch input X to output Y" notifications the matrix already pushes
		this.pollInterval = null
		this.sinkPollTime = 2 // the sink status is a separate, much faster poll: it is what an
		// automation reacts to, and one read costs a single request on a session already open
		this.sinkPollInterval = null

		// The matrix terminates the session after a handful of rejected logins (3 on the
		// VM0808HB) and locks logins out for several minutes after too many connection/login
		// attempts in a row ("Login locked. Please wait for 5 minutes and try again later."),
		// so credentials are only ever sent once per connection and reconnects back off
		// exponentially instead of retrying on a fixed short interval.
		this.authFailed = false // true after a bad username/password - do not retry automatically
		this.authFailureCount = 0 // consecutive rejected logins, to warn before the matrix locks us out
		this.lockoutThreshold = 3 // rejected logins the matrix tolerates before locking us out
		this.loginAttempts = 0 // credentials sent on the current connection
		this.defaultPasswordTried = false // whether the factory default was already tried this config
		this.usingDefaultPassword = false // this connection logs in with the factory default
		this.reconnectBaseDelay = 10 // seconds
		this.reconnectMaxDelay = 300 // seconds - matches the matrix's own lockout duration
		this.reconnectDelay = this.reconnectBaseDelay
		this.reconnectTimer = null

		this.setActionDefinitions(getActions(this))
		this.initFeedbacks()
		this.initVariables()
		this.initPresets()

		await this.configUpdated(config)
	}

	getConfigFields() {
		return getConfigFields(this.detectedModel)
	}

	// Send telnet command
	sendCmd(cmd) {
		if (cmd != undefined && cmd != '') {
			if (this.socket === undefined || !this.socket.isConnected) {
				this.log('warn', `Not connected to matrix, cannot send command: ${cmd}`)
				return
			}
			this.log('debug', `Sending command to matrix: ${cmd}`)
			this.socket.send(cmd + '\r\n')
		}
	}

	// Route an input to an output
	route(input, output) {
		this.sendCmd(`SS ${pad2(input)},${pad2(output)}`)
	}

	// Turn an option value into an actual port number. Dropdowns hand us the port number
	// itself or SELECTED_PORT; expressions hand us a string, either a number or the word
	// "selected". Anything else - including a selection that has not been made yet - is
	// undefined, so callers can report it rather than routing a bogus port.
	resolvePort(value, selected) {
		if (typeof value === 'string' && value.trim().toLowerCase() === 'selected') {
			return selected
		}

		const port = Number(value)
		if (!Number.isInteger(port) || port < SELECTED_PORT) {
			return undefined
		}

		return port === SELECTED_PORT ? selected : port
	}

	resolveInput(value) {
		return this.resolvePort(value, this.state.selectedSource)
	}

	resolveOutput(value) {
		return this.resolvePort(value, this.state.selectedDestination)
	}

	// The name the matrix gave a port, or '' when it has none of its own. Dropdown labels
	// use this so an unnamed port stays a plain "Input 3" instead of "Input 3 - Input 3".
	getCustomPortName(kind, port) {
		return this.portNames?.[kind]?.[port] ?? ''
	}

	// The name to display for a port, falling back to the generic "Input 3"
	getPortName(kind, port) {
		const custom = this.getCustomPortName(kind, port)
		return custom !== '' ? custom : `${kind === 'input' ? 'Input' : 'Output'} ${port}`
	}

	// The same pair for the matrix's profiles. A slot nothing has been saved into is
	// reported as "Untitled", which would read like a name, so it counts as having none.
	getCustomPresetName(preset) {
		if (this.savedPresets !== undefined && !this.savedPresets.includes(Number(preset))) return ''
		return this.portNames?.preset?.[preset] ?? ''
	}

	getPresetName(preset) {
		const custom = this.getCustomPresetName(preset)
		return custom !== '' ? custom : `Preset ${preset}`
	}

	// The profile slots the matrix actually has something saved in, or every slot while
	// that is still unknown - the module is usable over Telnet alone, so an unreachable web
	// interface must not leave it with no profiles at all.
	getPresetNumbers() {
		if (this.savedPresets !== undefined) return this.savedPresets

		const { inputs, outputs } = getDeviceSize(this.config)
		return Array.from({ length: inputs + outputs }, (_, index) => index + 1)
	}

	// Record the names the matrix gave its ports and profiles. Dropdown labels are baked
	// into the action and feedback definitions, so a changed name means re-publishing all of
	// them - hence taking every list at once and only rebuilding when something changed.
	applyNames({ inputNames = [], outputNames = [], presetNames = [], savedPresets }) {
		let changed = false

		if (savedPresets !== undefined && String(this.savedPresets) !== String(savedPresets)) {
			this.savedPresets = savedPresets
			changed = true
		}

		for (const [kind, names] of [
			['input', inputNames],
			['output', outputNames],
			['preset', presetNames],
		]) {
			names.forEach((name, index) => {
				const number = index + 1
				const clean = String(name).trim()
				if ((this.portNames[kind][number] ?? '') === clean) return

				this.portNames[kind][number] = clean
				changed = true
			})
		}

		if (!changed) return

		this.setActionDefinitions(getActions(this))
		this.initFeedbacks()
		this.initVariables()
		this.initPresets()
	}

	// Clean up instance before it is destroyed
	async destroy() {
		if (this.socket !== undefined) {
			this.socket.destroy()
		}

		this.stopPolling()
		this.clearReconnectTimer()
		await web.closeSession(this.config).catch(() => {})

		this.log('debug', `DESTROY ${this.id}`)
	}

	// Initialise the Telnet socket
	initTCP() {
		var receivebuffer = ''

		this.clearReconnectTimer()

		if (this.socket !== undefined) {
			this.socket.destroy()
			delete this.socket

			this.setLoggedIn(false)
		}

		this.stopPolling()

		if (!this.config.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'No target IP configured')
			return
		}

		this.loginAttempts = 0
		this.updateStatus(InstanceStatus.Connecting)
		this.log('info', 'Connecting to ATEN')

		// Reconnection is handled by us (scheduleNextReconnect), not by the helper itself, so
		// that a failed login doesn't just get retried instantly on a fixed short interval.
		this.socket = new TelnetHelper(this.config.host, this.telnetPort, { reconnect: false })

		this.socket.on('error', (err) => {
			this.updateStatus(InstanceStatus.ConnectionFailure, err.message)
			this.log('error', 'Network error: ' + err.message)
			this.setLoggedIn(false)
			this.scheduleNextReconnect()
		})

		this.socket.on('connect', () => {
			this.updateStatus(InstanceStatus.Connecting)
			this.log('info', 'Connected')
			this.setLoggedIn(false)
		})

		this.socket.on('end', () => {
			this.log('info', 'Disconnected')
			this.updateStatus(InstanceStatus.Disconnected)
			this.stopPolling()
			this.setLoggedIn(false)
			this.scheduleNextReconnect()
		})

		this.socket.on('data', (chunk) => {
			var i = 0,
				line = '',
				offset = 0
			receivebuffer += chunk

			// Split up Lines with new line and Process
			while ((i = receivebuffer.indexOf('\r\n', offset)) !== -1) {
				line = receivebuffer.slice(offset, i)
				offset = i + 2 // skip both the \r and the \n
				this.processLine(line.toString('utf8'))
			}
			receivebuffer = receivebuffer.slice(offset)

			// Handle Login Prompts. The buffer is cleared after acting on a prompt so a
			// stale, unterminated prompt string can't keep re-matching on later chunks
			// (which would otherwise re-send the credentials on every subsequent event).
			// Once a login has been rejected, stop responding to further prompts on this
			// connection entirely - retrying blindly is what trips the matrix's lockout.
			// "New/Confirm Password:" are checked before the plain "Password:" prompt, since
			// both of their prompt strings also contain that substring.
			if (this.authFailed || this.socket === undefined) {
				// This connection has already been given up on - the matrix often re-prompts for
				// the login in the same chunk as the rejection, and answering that would burn
				// another of the few attempts it allows (and would also write to a dead socket).
			} else if (receivebuffer.match(/Enter Username:/)) {
				if (this.loginAttempts > 0) {
					// Being asked for credentials again means the previous attempt was rejected,
					// even though the matrix didn't say so in words we recognize. Stop rather
					// than burning through the handful of attempts it allows before locking us out.
					this.handleAuthFailure(
						'Login rejected - fix the username/password in the config and save it to retry',
						'The matrix asked for the login again, so the credentials were rejected. Not retrying ' +
							'automatically - fix the username/password in the config and save it to try again.',
					)
				} else {
					this.loginAttempts++
					this.setLoggedIn(false)
					this.updateStatus(InstanceStatus.Connecting, 'logging in')
					this.log('info', 'Entering Username')
					this.socket.send(this.config.user + '\r\n')
				}
				receivebuffer = ''
			} else if (this.login === false && receivebuffer.match(/New Password:/i)) {
				if (!this.config.autoSetPassword) {
					this.authFailed = true
					this.updateStatus(
						InstanceStatus.BadConfig,
						'Matrix still has its default password and wants it changed - see the log',
					)
					this.log(
						'error',
						'The matrix still uses its factory default password and forces a change before it can be used. ' +
							'Either change it on the device yourself, or enable "Automatically change to selected password ' +
							'if factory default password is active" in this connection\'s config.',
					)
					this.stopPolling()
					this.socket.destroy()
					delete this.socket
				} else if (this.config.pass === FACTORY_DEFAULT_PASSWORD) {
					this.authFailed = true
					this.updateStatus(InstanceStatus.BadConfig, 'Pick a password other than the factory default')
					this.log(
						'error',
						'The matrix wants its default password changed, but the configured password is that same default. ' +
							'Enter the password you want the matrix to use and save the config.',
					)
					this.stopPolling()
					this.socket.destroy()
					delete this.socket
				} else {
					this.log('info', 'Matrix requires a password change - setting the configured password')
					this.socket.send(this.config.pass + '\r\n')
				}
				receivebuffer = ''
			} else if (this.login === false && receivebuffer.match(/Confirm Password:/i)) {
				this.socket.send(this.config.pass + '\r\n')
				this.log('info', 'Confirming new password')
				receivebuffer = ''
			} else if (this.login === false && receivebuffer.match(/Password:/)) {
				if (this.usingDefaultPassword) {
					this.socket.send(FACTORY_DEFAULT_PASSWORD + '\r\n')
					this.log('info', 'Entering factory default password')
				} else {
					this.socket.send(this.config.pass + '\r\n')
					this.log('info', 'Entering Password')
				}
				receivebuffer = ''
			}
		})
	}

	// Give up on this connection after the matrix rejected the login. Retrying the same
	// credentials automatically would only burn through the few attempts it allows before
	// terminating the session and locking logins out for minutes.
	handleAuthFailure(statusMessage, logMessage) {
		this.authFailureCount++
		this.setLoggedIn(false)
		this.stopPolling()
		if (this.socket !== undefined) {
			this.socket.destroy()
			delete this.socket
		}

		// A matrix that has been factory reset is back on its default password, which looks
		// exactly like a wrong password from here. If the user opted in, try the default once -
		// the forced password change that follows then sets the configured password on the
		// device. Only once per config, and never as a third attempt, to stay under the lockout.
		const canTryDefault =
			this.config.autoSetPassword &&
			!this.defaultPasswordTried &&
			!this.usingDefaultPassword &&
			this.config.pass !== FACTORY_DEFAULT_PASSWORD &&
			this.authFailureCount < this.lockoutThreshold - 1

		if (canTryDefault) {
			this.defaultPasswordTried = true
			this.usingDefaultPassword = true
			this.updateStatus(InstanceStatus.Connecting, 'login rejected - trying the factory default password')
			this.log(
				'warn',
				'The configured password was rejected. Trying the factory default password once, in case the matrix has been reset.',
			)
			this.scheduleReconnect(2)
			return
		}

		this.authFailed = true
		this.clearReconnectTimer() // nothing left to retry, so drop any pending attempt
		if (this.usingDefaultPassword) {
			this.usingDefaultPassword = false
			this.updateStatus(InstanceStatus.AuthenticationFailure, statusMessage)
			this.log(
				'error',
				'The configured password and the factory default were both rejected. Fix the username/password in the config and save it to retry.',
			)
		} else {
			this.updateStatus(InstanceStatus.AuthenticationFailure, statusMessage)
			this.log('error', logMessage)
		}

		if (this.authFailureCount < this.lockoutThreshold) {
			this.log(
				'warn',
				`${this.authFailureCount} rejected login(s) in a row - after ${this.lockoutThreshold} the matrix locks logins for several minutes.`,
			)
		}
	}

	// Take the model the matrix reported and, when it is one we know the port count for,
	// correct the configured matrix size to match. Unknown models are left alone, since the
	// dropdown is the only thing we have to go on for those.
	applyDetectedModel(model) {
		const isNewModel = this.detectedModel !== model
		this.detectedModel = model
		this.updateVariableValues()

		const sizeId = getSizeIdForModel(model)
		let sizeChanged = false

		if (sizeId === undefined) {
			if (isNewModel) {
				this.log('info', `Matrix reports model ${model}, which has no known port count - pick a size in the config`)
			}
		} else if (this.config.device !== sizeId) {
			// Re-applied on every login, not just the first: the size field is hidden once the
			// model is known, so a config saved from that page can come back without it.
			this.log('info', `Matrix reports model ${model}, setting the matrix size to ${sizeId}`)
			this.config.device = sizeId
			this.outputs = []
			this.setActionDefinitions(getActions(this))
			this.initFeedbacks()
			this.initVariables()
			this.initPresets()
			sizeChanged = true
		}

		// Companion redraws the config page when a connection is saved, which is what gets the
		// detected model onto it - so save even when nothing else changed. A redraw throws away
		// anything half typed into that page, hence only doing it when something actually moved.
		if (isNewModel || sizeChanged) {
			this.saveConfig({ ...this.config })
		}
	}

	// Shared by both ways a session can become usable: the normal login banner, and the
	// forced password change, after which the matrix drops straight into its command prompt.
	handleLoginSuccess() {
		this.setLoggedIn(true)
		this.updateStatus(InstanceStatus.Ok, 'Logged in')
		this.log('info', 'ATEN Logged in')
		this.reconnectDelay = this.reconnectBaseDelay
		this.authFailureCount = 0
		this.defaultPasswordTried = false
		this.sendCmd('VR')
		this.pollOutputs()
		this.startPolling()
		this.refreshNames()
		this.refreshSinkStatus()
	}

	// Port and profile names live in the web interface rather than the Telnet protocol, so
	// they are fetched over HTTP. It is a nice-to-have on top of a working Telnet session:
	// if the web interface is unreachable or refuses the credentials, everything simply
	// keeps its generic name instead of the module reporting a problem. The matrix does not
	// announce a rename either, so this also runs from the "Refresh names" action.
	async refreshNames() {
		if (!this.config.host) return

		try {
			this.applyNames(await web.fetchNames(this.config))
		} catch (e) {
			this.log('debug', `Could not read the names from the web interface: ${e.message}`)
		}
	}

	// Whether an output has something plugged into it, or undefined while that is unknown -
	// the module works over Telnet alone, and this only ever comes from the web interface.
	getSinkActive(output) {
		return this.sinkActive[output]
	}

	// The matrix reports which outputs have a sink as one digit per output. It is only in
	// the web interface, so this shares the polling interval with the routing rather than
	// having one of its own, and stays quiet when the web interface cannot be reached.
	async refreshSinkStatus() {
		if (!this.config.host) return

		try {
			const active = await web.fetchSinkStatus(this.config)
			let changed = false
			active.forEach((isActive, index) => {
				const output = index + 1
				if (this.sinkActive[output] === isActive) return
				this.sinkActive[output] = isActive
				changed = true
			})

			if (changed) {
				this.updateVariableValues()
				this.checkFeedbacks('sinkConnected')
			}
		} catch (e) {
			this.log('debug', `Could not read the sink status from the web interface: ${e.message}`)
		}
	}

	// Rename a port on the matrix itself, then take the result straight into the module
	async renamePort(kind, port, name) {
		if (!this.config.host) return

		try {
			const result = await web.renamePort(this.config, kind, port, name)
			this.log('info', `Renamed ${kind} ${port} to "${result.appliedName}"`)
			this.applyNames(result)
		} catch (e) {
			this.log('warn', `Could not rename ${kind} ${port} via the web interface: ${e.message}`)
		}
	}

	// Track the login state and keep the 'connected' feedback in sync with it
	setLoggedIn(loggedIn) {
		if (this.login === loggedIn) return
		this.login = loggedIn
		this.checkFeedbacks('connected')
	}

	startPolling() {
		this.stopPolling()
		this.pollInterval = setInterval(this.pollOutputs.bind(this), this.pollTime * 1000)
		this.sinkPollInterval = setInterval(this.refreshSinkStatus.bind(this), this.sinkPollTime * 1000)
	}

	stopPolling() {
		if (this.pollInterval) {
			clearInterval(this.pollInterval)
			this.pollInterval = null
		}

		if (this.sinkPollInterval !== null) {
			clearInterval(this.sinkPollInterval)
			this.sinkPollInterval = null
		}
	}

	// Schedule the next reconnect attempt with exponential backoff, unless the last login
	// attempt was rejected outright (wrong username/password) - retrying that automatically
	// would just hammer the matrix with more failed logins and risk a lockout, for no benefit
	// since the same credentials would just fail again.
	scheduleNextReconnect() {
		if (this.authFailed) {
			this.log(
				'warn',
				'Not reconnecting automatically after an authentication failure. Fix the username/password in the config and save it to retry.',
			)
			return
		}

		this.scheduleReconnect(this.reconnectDelay)
		this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.reconnectMaxDelay)
	}

	scheduleReconnect(delaySeconds) {
		this.clearReconnectTimer()
		this.log('info', `Reconnecting to ATEN in ${delaySeconds}s`)
		this.reconnectTimer = setTimeout(() => this.initTCP(), delaySeconds * 1000)
	}

	clearReconnectTimer() {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer)
			this.reconnectTimer = null
		}
	}

	// Processes lines received
	processLine(data) {
		if (this.login === false && data.match(/is established/)) {
			// Successful Login. The banner names the model ("Connection to VM0808HB is
			// established"), which is more trustworthy than a hand-picked matrix size.
			const model = /Connection to (\S+) is established/i.exec(data)
			if (model !== null) {
				this.applyDetectedModel(model[1])
			}

			if (this.usingDefaultPassword) {
				// The matrix accepted the factory default without demanding a change, so it has
				// been reset but isn't forcing us through the change flow. Keep using the default
				// on later connections (rather than burning a failed attempt every reconnect),
				// but make the security problem obvious.
				this.log(
					'warn',
					'The matrix is on its factory default password - it has most likely been reset, and it is not ' +
						'asking for a new one. Set a password on the device and in this config.',
				)
			}
			this.handleLoginSuccess()
		} else if (data.match(/Password change successful/i)) {
			// Forced first-login password change completed. The matrix drops straight into its
			// command prompt afterwards (no "is established" banner), so this session is usable
			// as-is and the configured password is now the one the matrix holds.
			this.log('info', 'Matrix accepted the configured password - it is now set on the device')
			this.usingDefaultPassword = false
			this.handleLoginSuccess()
		} else if (data.match(/Login locked/i)) {
			// The matrix itself is enforcing a cooldown after too many attempts - honor it
			// instead of continuing to hammer the login, which would only extend the lockout.
			this.setLoggedIn(false)
			this.updateStatus(InstanceStatus.ConnectionFailure, 'Matrix has temporarily locked logins - backing off')
			this.log(
				'warn',
				'Matrix reports logins are locked; backing off for ' + this.reconnectMaxDelay + 's before retrying',
			)
			this.stopPolling()
			this.reconnectDelay = this.reconnectMaxDelay
			if (this.socket !== undefined) {
				this.socket.destroy()
				delete this.socket
			}
			this.scheduleReconnect(this.reconnectMaxDelay)
		} else if (data.match(/Incorrect/) || data.match(/User login fail/)) {
			this.handleAuthFailure(
				'Incorrect user/pass - fix the config and save it to retry',
				"Incorrect username or password - not retrying automatically, since that would just trip the matrix's login lockout. Fix the username/password in the config and save it to try again.",
			)
		} else if (data.match(/Switch/)) {
			// Matrix Informing after Switch event
			this.processSwitch(data)
		} else if (data.match(/is connected to Output Port/i)) {
			// Matrix Informing after query
			this.processRoute(data)
		} else if (data.match(/Software version/i)) {
			// Reply to VR
			this.processVersion(data)
		} else if (data.match(/Load/)) {
			// Matrix informing after Load Profile
			this.pollOutputs()
		} else if (this.isKnownChatter(data)) {
			// nothing to do, and not worth logging
		} else if (data.trim() !== '' && !data.trim().startsWith('>')) {
			// Anything we don't recognize yet - log it so it shows up for troubleshooting
			// instead of silently vanishing. Lines starting with the ">" prompt are just the
			// matrix echoing back what we sent, which would otherwise spam the log on every poll.
			this.log('debug', 'Unrecognized line from matrix: ' + data)
		}
	}

	// True for lines we have seen on real hardware and deliberately do nothing with
	isKnownChatter(data) {
		const line = data.trim()
		if (line === this.config.user) return true // the matrix echoing back the username
		return IGNORED_LINES.some((pattern) => pattern.test(line))
	}

	// Processes response from Matrix after a switch has been made
	processSwitch(data) {
		var regex = /Switch input (\d*) to output (\d*)/gm
		var result = regex.exec(data)

		if (result !== null && result.length >= 3) {
			let src = parseInt(result[1], 10)
			let dst = parseInt(result[2], 10)
			this.setRoute(src, dst)
			this.checkFeedbacks('route')
			this.updateVariableValues()
		} else {
			this.log('warn', 'Unknown in processSwitch Regex got: ' + data)
		}
	}

	// Record a routing, logging it when it actually changes so that a working poll is
	// visible in the log (a successful parse is otherwise completely silent)
	setRoute(input, output) {
		if (this.outputs[output] === input) return
		this.outputs[output] = input
		this.log('debug', `Output ${output} is fed by input ${input}`)
	}

	// Process response from Matrix after polling.
	// Verified against a VM0808HB, which replies to "RO <input>" with
	// "Input Port 01 is connected to Output Port 01". Note that ATEN's manual documents the
	// reverse wording ("Output port .. is connected to input port ..") - the hardware wins.
	// The trailing port list is parsed as a list, since one input can feed several outputs.
	processRoute(data) {
		var regex = /Input Port (\d+) is connected to Output Port ([\d\s]+)/i
		var result = regex.exec(data)

		if (result !== null) {
			let src = parseInt(result[1], 10)
			let destinations = result[2]
				.split(/\s+/)
				.filter((n) => n !== '')
				.map((n) => parseInt(n, 10))

			for (const dst of destinations) {
				this.setRoute(src, dst)
			}
			this.checkFeedbacks('route')
			this.updateVariableValues()
		} else {
			this.log('warn', 'Unknown in processRoute Regex got: ' + data)
		}
	}

	// Process the reply to VR, e.g. "Software version 1.0."
	processVersion(data) {
		var result = /Software version\s*([\d.]*\d)/i.exec(data)

		if (result !== null) {
			this.firmwareVersion = result[1]
			this.updateVariableValues()
		}
	}

	// Poll the matrix for all routes to outputs.
	// "RO n" asks the matrix which output the given INPUT is routed to, so this has
	// to loop over the input ports, not the outputs, to discover every active route.
	pollOutputs() {
		if (this.socket === undefined || !this.socket.isConnected || this.login !== true) {
			this.log('warn', 'Not connected to matrix, cannot poll routing status')
			return
		}

		this.log('debug', 'Polling matrix outputs')
		let { inputs } = getDeviceSize(this.config)
		for (let i = 1; i <= inputs; i++) {
			this.socket.send(`RO ${i}\r\n`)
		}
	}

	// Define feedbacks
	initFeedbacks() {
		this.setFeedbackDefinitions(getFeedbacks(this))
	}

	// Define variables and populate their initial values
	initVariables() {
		this.setVariableDefinitions(getVariableDefinitions(this))
		this.updateVariableValues()
	}

	// Push the currently known state into the variable values
	updateVariableValues() {
		this.setVariableValues(getVariableValues(this))
	}

	// Define presets
	initPresets() {
		const { sections, presets } = getPresetDefinitions(this)
		this.setPresetDefinitions(sections, presets)
	}

	// On Config changes apply new config
	async configUpdated(config) {
		const previous = this.config
		this.config = config

		// Only the settings the session is built on are worth dropping a working connection
		// for. The matrix size in particular is written back by the module itself once the
		// matrix reports its model, and reconnecting for that would be pointless churn.
		const connectionChanged =
			previous === undefined ||
			previous.host !== config.host ||
			previous.user !== config.user ||
			previous.pass !== config.pass

		if (previous === undefined || previous.device !== config.device) {
			this.outputs = []
		}

		this.setActionDefinitions(getActions(this))
		this.initFeedbacks()
		this.initVariables()
		this.initPresets()

		if (connectionChanged || this.socket === undefined) {
			// A config change (e.g. a corrected password) is a deliberate request to retry,
			// so clear whatever backoff state a previous connection attempt left behind.
			this.authFailed = false
			this.defaultPasswordTried = false
			this.usingDefaultPassword = false
			this.reconnectDelay = this.reconnectBaseDelay
			this.initTCP()
		}
	}
}
