// Pre-2.2.0 configs stored the matrix size as a plain number (e.g. "8"), assuming a
// square matrix. Rewrite it to the "inputs x outputs" format (e.g. "8x8") the current
// config dropdown uses, now that asymmetric matrix sizes are supported.
function migrateDeviceSizeToInputsOutputs(_context, props) {
	let updatedConfig = null

	if (props.config && typeof props.config.device === 'string' && !props.config.device.includes('x')) {
		updatedConfig = {
			...props.config,
			device: `${props.config.device}x${props.config.device}`,
		}
	}

	return {
		updatedConfig,
		updatedActions: [],
		updatedFeedbacks: [],
	}
}

// The original action ids were the raw protocol commands (SS, LO) and the only feedback
// was called output_bg. Move existing buttons over to the current ids and option names.
function migrateActionAndFeedbackIds(_context, props) {
	const updatedActions = []
	const updatedFeedbacks = []

	for (const action of props.actions) {
		if (action.actionId === 'SS') {
			action.actionId = 'xpt'
			action.options = { input: action.options.src, output: action.options.dst }
			updatedActions.push(action)
		} else if (action.actionId === 'LO') {
			action.actionId = 'preset'
			action.options = { preset: action.options.num }
			updatedActions.push(action)
		}
	}

	for (const feedback of props.feedbacks) {
		if (feedback.feedbackId === 'output_bg') {
			feedback.feedbackId = 'route'
			updatedFeedbacks.push(feedback)
		}
	}

	return {
		updatedConfig: null,
		updatedActions,
		updatedFeedbacks,
	}
}

export const UpgradeScripts = [
	migrateDeviceSizeToInputsOutputs,
	migrateActionAndFeedbackIds,
	/*
	 * Place further upgrade scripts here
	 * Remember that once it has been added it cannot be removed!
	 */
]
