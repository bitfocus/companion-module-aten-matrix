import { combineRgb } from '@companion-module/base'

export function getFeedbacks(instance) {
	const feedbackDefinitions = {
		output_bg: {
			name: 'Crosspoint set',
			type: 'boolean',
			description: 'Triggers if the input specified is in use by the output specified.',
			defaultStyle: {
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(255, 0, 0)
			},
			options: [
				{
					type: 'number',
					label: 'Input',
					id: 'input',
					default: 1,
					min: 0,
					max: instance.config.device
				}, 
				{
					type: 'number',
					label: 'Output',
					id: 'output',
					default: 1,
					min: 1,
					max: instance.config.device
				}
			],
			callback: (feedback) => {
				if (instance.outputs[feedback.options.output] == feedback.options.input) {
					return true
				} else {
					return false
				}
			}
		}
	}
	return feedbackDefinitions
}
