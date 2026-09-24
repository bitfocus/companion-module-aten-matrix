import { combineRgb } from '@companion-module/base'
import { getDeviceSize } from './utils.js'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const DARK_GREY = combineRgb(36, 36, 36)
const MID_GREY = combineRgb(110, 110, 110)
const GREEN = combineRgb(0, 204, 0)
const LIVE_GREEN = combineRgb(0, 102, 0)
const CONNECTED_GREEN = combineRgb(0, 204, 0)
const DISCONNECTED_RED = combineRgb(204, 0, 0)
const YELLOW = combineRgb(255, 255, 0)
const BLUE = combineRgb(0, 102, 204)
const OUTLINE = 4278190080 // opaque black, what the button editor uses by default

// The port buttons are one definition each, turned into a button per port by a template
// group: the only thing that differs between them is the local variable holding the port
// number. Everything the button draws or acts on refers back to that one variable.
const INPUT_VARIABLE = 'input'
const OUTPUT_VARIABLE = 'output'
const PRESET_VARIABLE = 'preset'

const canvas = { decoration: 'default', showStatusIcons: 'default' }

// A style override's value may be a plain value or an { isExpression, value } pair. Plain
// values are dropped by Companion 5.1 when it imports a layered preset - and a feedback
// left with no overrides is dropped with them, so the preset arrives with no feedbacks at
// all. Wrapping every value keeps them, and is what Companion would have done itself.
function override(elementId, elementProperty, value) {
	return { elementId, elementProperty, override: { isExpression: false, value } }
}

function text(id, name, bounds, properties) {
	return {
		id,
		name,
		type: 'text',
		opacity: 100,
		rotation: 0,
		color: WHITE,
		halign: 'center',
		valign: 'center',
		fontsize: 100,
		fontsizeAllowShrink: true,
		font: 'companion-sans',
		weight: 'normal',
		styles: [],
		outlineColor: OUTLINE,
		...bounds,
		...properties,
	}
}

function box(id, name, bounds, properties) {
	return {
		id,
		name,
		type: 'box',
		opacity: 100,
		rotation: 0,
		cornerRadius: 0,
		borderWidth: 0,
		borderColor: BLACK,
		borderPosition: 'inside',
		...bounds,
		...properties,
	}
}

// One button per value, all from a single definition: the only thing that differs between
// the generated buttons is the local variable the definition refers to throughout.
function templateGroup(id, name, variableName, values, nameFor) {
	return {
		id,
		type: 'template',
		name,
		presetId: id,
		templateVariableName: variableName,
		templateValues: values.map((value) => ({ name: nameFor(value), value })),
	}
}

function range(count) {
	return Array.from({ length: count }, (_, index) => index + 1)
}

export function getPresetDefinitions(instance) {
	let { inputs, outputs } = getDeviceSize(instance.config)
	let label = instance.label

	const presets = {}

	// Select Input: names the input, and shows a bar along the bottom while that input is
	// the one feeding the currently selected output.
	presets.select_input = {
		type: 'layered',
		name: 'Select Input',
		canvas,
		elements: [
			box('box0', 'Background', { x: 0, y: 0, width: 100, height: 100 }, { enabled: true, color: DARK_GREY }),
			box(
				'routed_bar',
				'Input is routed to selected output',
				{ x: 0, y: 79.7, width: 100, height: 20.3 },
				{ enabled: false, color: YELLOW },
			),
			text(
				'routed_text',
				'Routed',
				{ x: 0, y: 79.7, width: 100, height: 20.3 },
				{ enabled: false, weight: 'bold', color: BLACK, text: `ROUTED TO OUT $(${label}:selected_destination)` },
			),
			text(
				'text0',
				'Input Name',
				{ x: 0, y: 25, width: 100, height: 55 },
				{ enabled: true, text: `$(${label}:input_$(local:${INPUT_VARIABLE})_name)` },
			),
			text(
				'port_number',
				'Top Input #',
				{ x: 0, y: 0, width: 100, height: 28.1 },
				{ enabled: true, text: `Input $(local:${INPUT_VARIABLE}):` },
			),
		],
		localVariables: [
			{
				variableType: 'simple',
				variableName: INPUT_VARIABLE,
				startupValue: 1,
				headline: 'The input this button selects',
			},
		],
		steps: [
			{
				down: [
					{
						actionId: 'selectSource',
						options: { port: { isExpression: true, value: `$(local:${INPUT_VARIABLE})` } },
					},
				],
				up: [],
			},
		],
		feedbacks: [
			{
				feedbackId: 'sourceSelected',
				options: { port: { isExpression: true, value: `$(local:${INPUT_VARIABLE})` } },
				styleOverrides: [override('box0', 'color', GREEN)],
			},
			{
				// Darker still once the selection is not just pending but live: this input is the
				// selected source, and it is what the selected output is actually being fed.
				feedbackId: 'internal:checkExpression',
				options: {
					expression:
						`if ($(${label}:selected_source) == $(local:${INPUT_VARIABLE})){\n` +
						`    if (parseVariables("$(${label}:output_$(${label}:selected_destination)_source)")==$(local:${INPUT_VARIABLE}))\n` +
						`    {\n` +
						`        return true\n` +
						`    }\n` +
						`}\n`,
				},
				styleOverrides: [override('box0', 'color', LIVE_GREEN), override('text0', 'color', WHITE)],
			},
			{
				feedbackId: 'route',
				options: { input: { isExpression: true, value: `$(local:${INPUT_VARIABLE})` }, output: 0 },
				styleOverrides: [override('routed_bar', 'enabled', true), override('routed_text', 'enabled', true)],
			},
		],
	}

	// Select Output: names the output and always shows which input feeds it
	presets.select_output = {
		type: 'layered',
		name: 'Select Output',
		canvas,
		elements: [
			box('box0', 'Background', { x: 0, y: 0, width: 100, height: 100 }, { enabled: true, color: DARK_GREY }),
			box(
				'source_bar',
				'Current Source',
				{ x: 0, y: 54.1, width: 100, height: 45.9 },
				{ enabled: true, color: YELLOW },
			),
			text(
				'source_text',
				'Routed',
				{ x: 0, y: 54.1, width: 100, height: 45.9 },
				{
					enabled: true,
					weight: 'bold',
					color: BLACK,
					text:
						`Source: IN$(${label}:output_$(${label}:output_$(local:${OUTPUT_VARIABLE})_source)_source) ` +
						`($(${label}:input_$(${label}:output_$(local:${OUTPUT_VARIABLE})_source)_name))`,
				},
			),
			text(
				'text0',
				'Output Name',
				{ x: 0, y: 25, width: 100, height: 31.7 },
				{ enabled: true, text: `$(${label}:output_$(local:${OUTPUT_VARIABLE})_name)` },
			),
			text(
				'port_number',
				'Top Output #',
				{ x: 0, y: 0, width: 100, height: 28.1 },
				{ enabled: true, fontsize: 85, text: `Output $(local:${OUTPUT_VARIABLE}):` },
			),
		],
		localVariables: [
			{
				variableType: 'simple',
				variableName: OUTPUT_VARIABLE,
				startupValue: 1,
				headline: 'The output this button selects',
			},
		],
		steps: [
			{
				down: [
					{
						actionId: 'selectDestination',
						options: { port: { isExpression: true, value: `$(local:${OUTPUT_VARIABLE})` } },
					},
				],
				up: [],
			},
		],
		feedbacks: [
			{
				feedbackId: 'destinationSelected',
				options: { port: { isExpression: true, value: `$(local:${OUTPUT_VARIABLE})` } },
				styleOverrides: [override('box0', 'color', GREEN)],
			},
			{
				// The mirror of the input button: darker once this output is the selected
				// destination and already carries the selected source.
				feedbackId: 'internal:checkExpression',
				options: {
					expression:
						`if ($(local:${OUTPUT_VARIABLE})== $(${label}:selected_destination)) {\n\n` +
						`    if (parseVariables("$(${label}:output_$(local:${OUTPUT_VARIABLE})_source)") == $(${label}:selected_source))\n` +
						`    {\n` +
						`        return true\n` +
						`    }\n` +
						`}\n` +
						`return false`,
				},
				styleOverrides: [override('box0', 'color', LIVE_GREEN)],
			},
		],
	}

	// Take: spells out the pending route, then makes it
	presets.take = {
		type: 'layered',
		name: 'Take',
		canvas,
		elements: [
			box('box0', 'Background', { x: 0, y: 0, width: 100, height: 100 }, { enabled: true, color: MID_GREY }),
			text(
				'text0',
				'selected routing',
				{ x: 0, y: 25, width: 100, height: 75 },
				{
					enabled: true,
					// The port names come from their own variables rather than being looked up
					// through the selected port number: with nothing selected that inner lookup
					// asks for a variable that does not exist, and the button reads "$NA".
					text:
						`IN$(${label}:selected_source) ($(${label}:selected_source_name))\nto\n` +
						`OUT$(${label}:selected_destination) ($(${label}:selected_destination_name))`,
				},
			),
			text('take_label', 'TAKE', { x: 0, y: 0, width: 100, height: 30 }, { enabled: true, text: 'TAKE' }),
		],
		steps: [{ down: [{ actionId: 'takeSalvo', options: {} }], up: [] }],
		feedbacks: [],
	}

	// Recall Preset: the slot number and the name the matrix gave that profile
	presets.recall_preset = {
		type: 'layered',
		name: 'Recall Preset',
		canvas,
		elements: [
			box('box0', 'Background', { x: 0, y: 0, width: 100, height: 100 }, { enabled: true, color: DARK_GREY }),
			text(
				'text0',
				'Text',
				{ x: 0, y: 0, width: 100, height: 100 },
				{
					enabled: true,
					fontsize: 30,
					fontsizeAllowShrink: false,
					text: `Preset\n$(local:${PRESET_VARIABLE})\n$(${label}:preset_$(local:${PRESET_VARIABLE})_name)`,
				},
			),
		],
		localVariables: [
			{
				variableType: 'simple',
				variableName: PRESET_VARIABLE,
				startupValue: 1,
				headline: 'The preset this button recalls',
			},
		],
		steps: [
			{
				down: [
					{
						actionId: 'preset',
						options: { preset: { isExpression: true, value: `$(local:${PRESET_VARIABLE})` } },
					},
				],
				up: [],
			},
		],
		feedbacks: [
			{
				feedbackId: 'presetRecalled',
				options: { preset: { isExpression: true, value: `$(local:${PRESET_VARIABLE})` } },
				styleOverrides: [override('text0', 'color', WHITE), override('box0', 'color', BLUE)],
			},
		],
	}

	presets.connected = {
		type: 'simple',
		name: 'Connected',
		style: {
			text: 'Connected',
			size: '14',
			color: WHITE,
			bgcolor: DISCONNECTED_RED,
		},
		steps: [{ down: [], up: [] }],
		feedbacks: [
			{
				feedbackId: 'connected',
				options: {},
				style: { bgcolor: CONNECTED_GREEN, color: BLACK },
			},
		],
	}

	const sections = [
		{
			id: 'inputs',
			name: 'Select Input',
			definitions: [
				templateGroup('select_input', 'Select Input', INPUT_VARIABLE, range(inputs), (port) =>
					instance.getPortName('input', port),
				),
			],
		},
		{
			id: 'outputs',
			name: 'Select Output',
			definitions: [
				templateGroup('select_output', 'Select Output', OUTPUT_VARIABLE, range(outputs), (port) =>
					instance.getPortName('output', port),
				),
			],
		},
		{ id: 'take', name: 'Take', definitions: ['take'] },
		{
			id: 'presets',
			name: 'Presets',
			// Only the profile slots the matrix actually has a profile in - a button for an
			// empty slot would recall nothing
			definitions: [
				templateGroup(
					'recall_preset',
					'Recall Preset',
					PRESET_VARIABLE,
					instance.getPresetNumbers(),
					(preset) => `Preset ${preset} - ${instance.getPresetName(preset)}`,
				),
			],
		},
		{ id: 'status', name: 'Status', definitions: ['connected'] },
	]

	return { sections, presets }
}
