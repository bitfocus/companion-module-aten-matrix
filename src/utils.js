// Every matrix size the module offers, with the ATEN models known to have it. The matrix
// reports its own model when logging in ("Connection to VM0808HB is established"), so this
// table drives both the config dropdown and the automatic size detection - keeping them
// from drifting apart. A model missing here just means the size stays whatever was picked.
export const MATRIX_SIZES = [
	{ id: '2x2', models: ['VM0202H', 'VM0202HB'] },
	{
		id: '4x4',
		models: ['VM0404H', 'VM0404HA', 'VM0404HB', 'VM3404H', 'VM5404H', 'VM5404HA', 'VM6404H', 'VM6404HB'],
	},
	{ id: '8x8', models: ['VM0808H', 'VM0808HA', 'VM0808HB', 'VM5808H', 'VM5808HA'] },
	{ id: '8x9', models: ['VM6809H'] },
	{ id: '9x9', models: ['VM3909H'] },
	{ id: '16x16', models: ['VM51616H', 'VM1600', 'VM1600A'] },
	{ id: '32x32', models: ['VM3200', 'VM3250'] },
]

export function getMatrixSizeChoices() {
	return MATRIX_SIZES.map(({ id, models }) => {
		const [inputs, outputs] = id.split('x')
		return { id, label: `${inputs} IN / ${outputs} OUT Matrix (like ${models.join(', ')})` }
	})
}

// The matrix size for a model name the device reported, or undefined if we don't know it
export function getSizeIdForModel(model) {
	const wanted = String(model).trim().toUpperCase()
	return MATRIX_SIZES.find((size) => size.models.some((m) => m.toUpperCase() === wanted))?.id
}

// The 'device' config value is either a plain number (legacy, pre-asymmetric-matrix
// configs, upgraded to "NxN" by the upgrade script) or an "inputs x outputs" string
// such as "8x4". This normalizes either form into the actual port counts.
export function getDeviceSize(config) {
	let device = String(config.device ?? '')
	let [inputs, outputs] = device.split('x').map((n) => parseInt(n, 10))

	// The size dropdown is hidden while the matrix is identifying itself, so the config can
	// legitimately have no size yet. Fall back to the most common one rather than handing
	// NaN to everything; the real size is applied as soon as the matrix reports its model.
	if (isNaN(inputs)) {
		inputs = 8
	}
	if (isNaN(outputs)) {
		outputs = inputs
	}

	return { inputs, outputs }
}

// Builds "Input 1", or "Input 1 - Camera left" once the matrix has told us what the port
// is actually called. nameFor returns '' for ports without a name of their own.
function numberedChoices(count, label, nameFor) {
	const choices = []
	for (let i = 1; i <= count; i++) {
		const name = nameFor?.(i) ?? ''
		choices.push({ id: i, label: name === '' ? `${label} ${i}` : `${label} ${i} - ${name}` })
	}
	return choices
}

// Stands for "whatever the take workflow currently has selected" wherever a port is
// referred to. Zero is never a real port, and it is what the route feedback already used.
export const SELECTED_PORT = 0

const SELECTED_HINT = 'In expression mode: the word "selected", or a port number.'
const NUMBER_HINT = 'In expression mode: a port number.'

// A dropdown checks its value against the choices, and anything that is not in the list
// makes Companion skip the whole action or feedback. The number comparison is a loose one,
// so an expression returning "3" still matches port 3 - but the word "selected" matches
// nothing, since that entry's id is the number 0. allowCustom lets a value through that
// the list does not hold, and the regex keeps that to what resolvePort() can make sense of.
const PORT_PATTERN = '/^(selected|\\d+)$/i'
const NUMBER_PATTERN = '/^\\d+$/'

function portField(choices, { id, label, withSelected, hint, regex }) {
	return {
		type: 'dropdown',
		label,
		id,
		default: withSelected ? SELECTED_PORT : 1,
		choices,
		allowCustom: true,
		regex,
		tooltip: hint,
	}
}

export function inputField(instance, { id = 'input', label = 'Input', withSelected = false } = {}) {
	return portField(getInputChoices(instance, { withSelected }), {
		id,
		label,
		withSelected,
		hint: withSelected ? SELECTED_HINT : NUMBER_HINT,
		regex: withSelected ? PORT_PATTERN : NUMBER_PATTERN,
	})
}

export function outputField(instance, { id = 'output', label = 'Output', withSelected = false } = {}) {
	return portField(getOutputChoices(instance, { withSelected }), {
		id,
		label,
		withSelected,
		hint: withSelected ? SELECTED_HINT : NUMBER_HINT,
		regex: withSelected ? PORT_PATTERN : NUMBER_PATTERN,
	})
}

export function presetField(instance, { id = 'preset', label = 'Preset' } = {}) {
	return portField(getPresetChoices(instance), {
		id,
		label,
		withSelected: false,
		hint: 'In expression mode: a preset number.',
		regex: NUMBER_PATTERN,
	})
}

export function getInputChoices(instance, { withSelected = false } = {}) {
	const choices = numberedChoices(getDeviceSize(instance.config).inputs, 'Input', (port) =>
		instance.getCustomPortName('input', port),
	)
	return withSelected ? [{ id: SELECTED_PORT, label: 'Selected source' }, ...choices] : choices
}

export function getOutputChoices(instance, { withSelected = false } = {}) {
	const choices = numberedChoices(getDeviceSize(instance.config).outputs, 'Output', (port) =>
		instance.getCustomPortName('output', port),
	)
	return withSelected ? [{ id: SELECTED_PORT, label: 'Selected destination' }, ...choices] : choices
}

// The matrix numbers its profiles P1..P(inputs+outputs): the input pushbuttons map to
// the first half, the output pushbuttons to the second half.
export function getPresetChoices(instance) {
	let { inputs, outputs } = getDeviceSize(instance.config)
	return numberedChoices(inputs + outputs, 'Preset', (preset) => instance.getCustomPresetName(preset))
}

// The matrix expects port and profile numbers as two-digit, zero-padded strings.
export function pad2(n) {
	return String(n).padStart(2, '0')
}
