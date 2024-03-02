import { InstanceBase, InstanceStatus, runEntrypoint, TelnetHelper } from '@companion-module/base'
import { getActions } from './actions.js'
import { getFeedbacks } from './feedback.js'
import { ConfigFields } from './config.js'


class AtenMatrixInstance extends InstanceBase {
	constructor(internal){
		super(internal)
	}

	async init(config) {
		this.config = config

		this.setActionDefinitions(getActions(this))

		await this.configUpdated(config)

		this.outputs = [] //index is output number, value is input roted to it
		this.login = false
		this.heartbeatTime = 60
		this.heartbeatInterval = null
	}

	getConfigFields() {
		return ConfigFields
	}

	//Send telnet command
	sendCmd(cmd) {
		if (cmd != undefined && cmd != ''){
			this.socket.send(cmd + '\r\n')
		}
	}

	//Clean up intance before it is destroyed
	async destroy() {
		if (this.socket !== undefined) {
			this.socket.destroy()
		}
		
		if (this.heartbeatInterval !== undefined) {
			clearInterval(this.heartbeatInterval)
		}

		this.log('debug', `DESTROY ${this.id}`)
	}

	//Initialise the Telnet socket
	initTCP() {
		var receivebuffer = ''
		
		this.updateStatus(InstanceStatus.Connecting)
		this.log('info', "Connecting to ATEN")

		if(this.socket !== undefined) {
			this.socket.destroy()
			delete this.socket

			this.login = false
		}

		if(this.heartbeatInterval !== undefined){
			clearInterval(this.heartbeatInterval)
		}

		if (this.config.port === undefined){
			this.config.port = 23
		}

		if (this.config.host) {
			this.socket = new TelnetHelper(this.config.host, this.config.port)
			
			this.socket.on('error', (err) => {
				this.updateStatus(InstanceStatus.ConnectionFailure, err.message)
				this.log('error', "Network error: " + err.message)
				this.login = false
			})
			
			this.socket.on('connect', () => {
				this.updateStatus(InstanceStatus.Connecting)
				this.log('info', "Connected")
				this.login = false
			})
			
			this.socket.on('end', () => {
				this.log('info', 'Disconnected')
				if (this.heartbeatInterval !== undefined){
					clearInterval(this.heartbeatInterval)
				}
				this.log('debug', 'Heartbeat Destroyed')
				this.login = false
			})

			this.socket.on('data', (chunk) => {
				var i = 0, line = '', offset = 0
				receivebuffer += chunk

				// Split up Lines with new line and Process
				while ( (i = receivebuffer.indexOf('\r\n', offset)) !== -1) {
					line = receivebuffer.substr(offset, i - offset)
					offset = i + 1
					this.processLine(line.toString("utf8"))
				}
				receivebuffer = receivebuffer.substr(offset)

				// Handle Login Prompts
				if (receivebuffer.match(/Enter Username:/)){

					this.login = false
					this.updateStatus(InstanceStatus.Connecting, "loggin in")
					this.log('info', 'Entering Username')
					this.socket.send(this.config.user + '\r\n')
				} 
				if (this.login === false && receivebuffer.match(/Password:/)){

					this.socket.send(this.config.pass + '\r\n')
					this.log('info', 'Entering Password')
				}
			})
		}
	}

	//Processes lines recieved
	processLine(data){
		
		if (this.login === false && data.match(/is established/)){
			//Successful Login
			this.login = true
			this.updateStatus(InstanceStatus.Ok, "Logged in")
			this.log('info', 'ATEN Logged in')
			this.pollOutputs()

			this.heartbeatInterval = setInterval(
				this.sendHeartbeatCommand.bind(this),
				(this.heartbeatTime*1000)
			)
		} else if (data.match(/Incorrect/) || data.match(/User login fail/)){
			
			this.login = false
			this.updateStatus(InstanceStatus.STATUS_WARNING, 'Incorrect user/pass')
			this.log('error', 'Incorrect username or password')

		} else if (data.match(/Switch/)){
			//Matrix Informing after Switch event
			this.processSwitch(data)

		} else if (data.match(/connected to Output/)){
			//Matrix Informing after query
			this.processRoute(data)

		} else if (data.match(/Load/)){
			//Matrix informing after Load Profile
			this.pollOutputs()
		}
	}

	//Processes response from Matrix after a switch has been made
	processSwitch(data) {
		
		var regex = /Switch input (\d*) to output (\d*)/gm
		var result = regex.exec(data)

		if (result.length >= 3) {

			let src = parseInt(result[1], 10)
			let dst = parseInt(result[2], 10)
			this.outputs[dst] = src
			this.checkFeedbacks('output_bg')

		} else {

			this.log('warn', 'Unknown in processSwitch Regex got: ' + result)
		}
	}

	//Process response from Matrix after polling
	processRoute(data) {

		var regex = /Input Port (\d*) is connected to Output Port (\d*)/gm
		var result = regex.exec(data)

		if (result.length >= 3) {

			let src = parseInt(result[1], 10)
			let dst = parseInt(result[2], 10)
			this.outputs[dst] = src
			this.checkFeedbacks('output_bg')

		} else {
			this.log('warn', 'Unknown in processRoute Regex got: ' + result)
		}
	}

	//Poll the matrix for all routes to outputs
	pollOutputs () {
		this.log('debug', 'Polling matrix outputs')
		for (let i = 1; i <= this.config.device; i++) {
			this.socket.send(`RO ${i}\r\n`)
		}
	}

	//Send new line to keep connection alive
	sendHeartbeatCommand() {
		this.log('debug', 'HEARTBEAT')
		this.socket.send("\n")
	}
	
	// Define feedbacks
	initFeedbacks() {
		this.setFeedbackDefinitions(getFeedbacks(this))
	}
	
	//On Config changes apply new config
	async configUpdated(config) {
		var resetConnection = false

		if (this.config != config) {
			resetConnection = true
		}

		this.config = config

		this.outputs = []
		this.setActionDefinitions(getActions(this))
		this.initFeedbacks(this)

		if (resetConnection === true || this.socket === undefined) {
			this.initTCP()
		}
	}
}

runEntrypoint(AtenMatrixInstance, [])