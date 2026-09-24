// The Telnet protocol has no command for the names that can be given to ports and saved
// profiles in the matrix's web interface ("read" dumps the routing, EDID and network
// settings, but no names), so those are read and written over HTTP instead: log into the
// web interface, use the same endpoints its own pages use, and hand the session straight
// back. Verified against a VM0808HB running firmware V3.6.352.
const LOGIN_PATH = '/login/checkuser.asp?SID=&IsCCuser=0&langFlag=0'
const LOGOUT_PATH = '/login/logout.asp'
const PORT_NAMES_PATH = '/data/Annotation/Annotation.xml'
const SAVE_NAMES_PATH = '/annotation.asp'
const PROFILES_PATH = '/lib/video_wall.xml'
const PROFILE_LIST_PATH = '/lib/profile_list.xml'
const GENERAL_PATH = '/data/general/general.xml'
const TIMEOUT = 5000

// Characters a VM0808HB refuses in a port name. Established by writing one name after
// another and reading back what stuck: letters (umlauts included), digits, spaces and
// ! # $ % - . ^ _ ` { } ~ are all fine, these are not. The matrix does not complain about
// a name it dislikes - it silently drops the whole submission and keeps the old names.
const ILLEGAL_NAME_CHARS = /["&'()*+,/:;<=>?@[\\\]|]/g

// The matrix itself takes up to 63 bytes, but its web interface caps the field at 30
// characters, so that is what the module allows too - a name typed here stays editable
// there. The byte limit is kept as a backstop: 30 characters of, say, Japanese would be
// 90 bytes and the matrix would drop them.
export const MAX_NAME_LENGTH = 30
const MAX_NAME_BYTES = 63

function byteLength(text) {
	return new TextEncoder().encode(text).length
}

// Makes a name the matrix will accept. The comma matters most, since it separates the
// names in the lists the device hands out and takes back.
export function sanitizeName(name) {
	let clean = String(name).replace(ILLEGAL_NAME_CHARS, '').trim()

	// Cut whole characters, so a multi-byte one never ends up half sent
	let characters = [...clean].slice(0, MAX_NAME_LENGTH)
	while (byteLength(characters.join('')) > MAX_NAME_BYTES) {
		characters = characters.slice(0, -1)
	}

	return characters.join('')
}

async function request(url, options = {}) {
	const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), ...options })
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`)
	}
	return response.text()
}

function tagContent(xml, tag) {
	return new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)?.[1]
}

// The port names come as one comma-separated list per direction, in port order. They are
// taken exactly as they are, spaces included: renaming one port means writing the whole
// table back, so trimming here would quietly rewrite every other port's name.
function nameList(xml, tag) {
	const raw = tagContent(xml, tag)
	return raw === undefined ? [] : raw.split(',')
}

// The sink status is polled every couple of seconds, which is far too often to log in and
// out around each read, so that one session is kept. The matrix answers a request carrying
// a session it has forgotten with an HTML error page rather than an error status, so an
// expired session shows up as the work throwing - and is retried once on a fresh login.
const sessions = new Map()

async function withKeptSession(config, work) {
	const base = `http://${config.host}`

	const kept = sessions.get(config.host)
	if (kept !== undefined) {
		try {
			return await work(base, kept)
		} catch {
			sessions.delete(config.host)
		}
	}

	const sid = await login(config)
	sessions.set(config.host, sid)
	return work(base, sid)
}

// Hands a kept session back, so it does not sit there until the matrix times it out
export async function closeSession({ host }) {
	const sid = sessions.get(host)
	if (sid === undefined) return

	sessions.delete(host)
	await request(`http://${host}${LOGOUT_PATH}?SID=${sid}`).catch(() => {})
}

// Logs into the web interface, runs the given work with the session, and logs out again -
// the matrix only keeps a handful of sessions and they linger for a while, so an abandoned
// one eventually locks everybody out of the web interface.
async function login({ host, user, pass }) {
	const credentials = new URLSearchParams({ login_username: user, login_password: pass })
	const loginPage = await request(`http://${host}` + LOGIN_PATH, { method: 'POST', body: credentials })

	const sid = /SID=([A-Za-z0-9]+)/.exec(loginPage)?.[1]
	if (sid === undefined) {
		throw new Error('the web interface did not hand out a session id')
	}
	return sid
}

async function withSession(config, work) {
	const base = `http://${config.host}`
	const sid = await login(config)

	try {
		return await work(base, sid)
	} finally {
		await request(`${base}${LOGOUT_PATH}?SID=${sid}`).catch(() => {})
	}
}

function portNamesFrom(xml) {
	return {
		inputs: parseInt(tagContent(xml, 'INPUT_NUM') ?? '', 10),
		outputs: parseInt(tagContent(xml, 'OUTPUT_NUM') ?? '', 10),
		inputNames: nameList(xml, 'INPUT_PORTNAME'),
		outputNames: nameList(xml, 'OUTPUT_PORTNAME'),
	}
}

// The port counts and the name of every port, from the "Port Name" page
async function readPortNames(base, sid) {
	return portNamesFrom(await request(`${base}${PORT_NAMES_PATH}?SID=${sid}&time=${Date.now()}`))
}

// Which of the matrix's profile slots actually hold a profile. R1_ProfileInfo has one
// pipe-separated entry per slot, empty for a slot nothing has been saved into - the only
// place the web interface says so, since R1_ProfileList calls an empty slot "Untitled",
// which is also a name somebody could have given a real profile.
function savedPresetsFrom(xml) {
	const raw = tagContent(xml, 'R1_ProfileInfo')
	if (raw === undefined) return undefined

	return raw
		.split('|')
		.map((entry, index) => (entry.trim() === '' ? undefined : index + 1))
		.filter((slot) => slot !== undefined)
}

// Every name the web interface knows: one per port, and one per profile slot, along with
// the slots that are actually in use. Each lives on a different page of the web interface,
// but all three are reachable on the same session.
export async function fetchNames(config) {
	return withSession(config, async (base, sid) => {
		const ports = await readPortNames(base, sid)
		const profiles = await request(`${base}${PROFILES_PATH}?SID=${sid}&time=${Date.now()}`)
		const profileList = await request(`${base}${PROFILE_LIST_PATH}?SID=${sid}&time=${Date.now()}`)

		return {
			...ports,
			presetNames: nameList(profiles, 'R1_ProfileList'),
			savedPresets: savedPresetsFrom(profileList),
		}
	})
}

// Which outputs have something plugged into them. The web interface reports this as
// TxConnectStatus on its General page, one digit per output, and draws the red cross next
// to a port whose digit is "0" - but never says in words what it means. Confirmed by
// watching the field while a monitor was moved: 00000001 with it on output 8, 00000000
// unplugged, 00001000 on output 5, each within a second.
export async function fetchSinkStatus(config) {
	return withKeptSession(config, async (base, sid) => {
		const xml = await request(`${base}${GENERAL_PATH}?SID=${sid}&time=${Date.now()}`)
		const mask = tagContent(xml, 'TxConnectStatus')
		if (mask === undefined) {
			throw new Error('the web interface did not report TxConnectStatus')
		}

		return [...mask.trim()].map((digit) => digit === '1')
	})
}

// The form fields are Port_in_01..Port_in_09, then Port_in_10 upwards
function nameField(kind, port) {
	return `Port_${kind === 'input' ? 'in' : 'out'}_${String(port).padStart(2, '0')}`
}

// Renames one port. The matrix only takes the whole table at once, so the current names
// are read first and handed straight back with the one entry replaced. It accepts or drops
// that submission without a word either way, so the names are read back and checked.
export async function renamePort(config, kind, port, name) {
	const clean = sanitizeName(name)

	return withSession(config, async (base, sid) => {
		const before = await readPortNames(base, sid)

		const names = { input: [...before.inputNames], output: [...before.outputNames] }
		if (port < 1 || port > names[kind].length) {
			throw new Error(`the matrix has no ${kind} ${port}`)
		}
		names[kind][port - 1] = clean

		const form = new URLSearchParams()
		names.input.forEach((value, index) => form.set(nameField('input', index + 1), value))
		names.output.forEach((value, index) => form.set(nameField('output', index + 1), value))
		await request(`${base}${SAVE_NAMES_PATH}?SID=${sid}`, { method: 'POST', body: form })

		const after = await readPortNames(base, sid)
		const stored = after[`${kind}Names`][port - 1]
		if (stored !== clean) {
			throw new Error(`the matrix refused "${clean}" and kept "${stored}"`)
		}

		return { ...after, appliedName: stored }
	})
}
