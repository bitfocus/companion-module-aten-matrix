module.exports = {

	getFeedbacks() {
		var feedbacks = {
			'output_bg': {
				label: 'Change background colour by output',
				description: 'If the input specified is in use by the output specified, change background color of the bank',
				options: [{
					type: 'colorpicker',
					label: 'Foreground color',
					id: 'fg',
					default: this.rgb(255, 255, 255)
				}, {
					type: 'colorpicker',
					label: 'Background color',
					id: 'bg',
					default: this.rgb(255, 0, 0)
				}, {
					type: 'number',
					label: 'Input',
					id: 'input',
					default: 1,
					min: 1,
					max: this.config.device
				}, {
					type: 'number',
					label: 'Output',
					id: 'output',
					default: 1,
					min: 1,
					max: this.config.device
				}],
				callback: (feedback, bank) => {
					if (this.outputs[feedback.options.output] == feedback.options.input) {
						return {
							color: feedback.options.fg,
							bgcolor: feedback.options.bg
						};
					}
				}
			}
		}
		return feedbacks
	}
}