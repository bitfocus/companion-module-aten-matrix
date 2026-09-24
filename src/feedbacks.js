import { combineRgb } from '@companion-module/base'
import { inputField, outputField, presetField } from './utils.js'

export function getFeedbacks(instance) {
	return {
		route: {
			name: 'Route',
			type: 'boolean',
			description: 'Shows if an input is routed to an output',
			defaultStyle: {
				color: combineRgb(0, 0, 0),
				bgcolor: combineRgb(255, 0, 0),
			},
			options: [inputField(instance, { withSelected: true }), outputField(instance, { withSelected: true })],
			callback: (feedback) => {
				const input = instance.resolveInput(feedback.options.input)
				const output = instance.resolveOutput(feedback.options.output)
				if (input === undefined || output === undefined) return false

				return instance.outputs[output] === input
			},
		},
		sourceSelected: {
			name: 'Source selected',
			type: 'boolean',
			description: 'Shows if an input is selected for routing',
			defaultStyle: {
				color: combineRgb(0, 0, 0),
				bgcolor: combineRgb(0, 255, 0),
			},
			options: [inputField(instance, { id: 'port' })],
			callback: (feedback) => {
				return instance.state.selectedSource === Number(feedback.options.port)
			},
		},
		destinationSelected: {
			name: 'Destination selected',
			type: 'boolean',
			description: 'Shows if an output is selected for routing',
			defaultStyle: {
				color: combineRgb(0, 0, 0),
				bgcolor: combineRgb(0, 255, 0),
			},
			options: [outputField(instance, { id: 'port' })],
			callback: (feedback) => {
				return instance.state.selectedDestination === Number(feedback.options.port)
			},
		},
		sinkConnected: {
			name: 'Display connected',
			type: 'boolean',
			description:
				'Shows whether anything is plugged into the given output. This comes from the web interface, so it stays ' +
				'false while that cannot be reached.',
			defaultStyle: {
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(0, 102, 0),
			},
			options: [outputField(instance, { id: 'port' })],
			callback: (feedback) => {
				return instance.getSinkActive(Number(feedback.options.port)) === true
			},
		},
		presetRecalled: {
			name: 'Preset recalled',
			type: 'boolean',
			description:
				'Shows if the given preset was the last one recalled via Companion. Presets recalled from the front panel, web UI or another controller are not reflected.',
			defaultStyle: {
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(0, 102, 204),
			},
			options: [presetField(instance)],
			callback: (feedback) => {
				return instance.lastPreset === Number(feedback.options.preset)
			},
		},
		connected: {
			name: 'Connected',
			type: 'boolean',
			description: 'Shows if the module has an active, logged-in Telnet session with the matrix',
			defaultStyle: {
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(0, 204, 0),
			},
			options: [],
			callback: () => {
				return instance.login === true
			},
		},
	}
}
