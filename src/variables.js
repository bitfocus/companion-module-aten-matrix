import { getDeviceSize } from './utils.js'

export function getVariableDefinitions(instance) {
	let { inputs, outputs } = getDeviceSize(instance.config)

	const variables = {
		model: { name: 'Matrix model reported on login' },
		last_preset: { name: 'Last preset recalled via Companion' },
		firmware_version: { name: 'Matrix software version' },
		selected_source: { name: 'Input selected for take' },
		selected_destination: { name: 'Output selected for take' },
		selected_source_name: { name: 'Name of the input selected for take' },
		selected_destination_name: { name: 'Name of the output selected for take' },
	}
	for (let input = 1; input <= inputs; input++) {
		variables[`input_${input}_name`] = { name: `Name of input ${input}` }
	}
	for (let output = 1; output <= outputs; output++) {
		variables[`output_${output}_name`] = { name: `Name of output ${output}` }
		variables[`output_${output}_source`] = { name: `Input routed to output ${output}` }
		variables[`output_${output}_sinkactive`] = { name: `Whether output ${output} has a display connected` }
	}
	// Only the profile slots the matrix has something saved in - an empty slot has no name
	// worth publishing, and a variable for it would just read as if a profile were there.
	for (const preset of instance.getPresetNumbers()) {
		variables[`preset_${preset}_name`] = { name: `Name of preset ${preset}` }
	}
	return variables
}

export function getVariableValues(instance) {
	let { inputs, outputs } = getDeviceSize(instance.config)

	const values = {
		model: instance.detectedModel ?? '',
		last_preset: instance.lastPreset ?? '',
		firmware_version: instance.firmwareVersion ?? '',
		selected_source: instance.state.selectedSource ?? '',
		selected_destination: instance.state.selectedDestination ?? '',
		// Nothing selected means no name either - looking one up through the port number,
		// as in $(input_$(selected_source)_name), would ask for a variable that does not
		// exist and render as "$NA" on the button.
		selected_source_name:
			instance.state.selectedSource === undefined ? '' : instance.getPortName('input', instance.state.selectedSource),
		selected_destination_name:
			instance.state.selectedDestination === undefined
				? ''
				: instance.getPortName('output', instance.state.selectedDestination),
	}
	for (let input = 1; input <= inputs; input++) {
		values[`input_${input}_name`] = instance.getPortName('input', input)
	}
	for (let output = 1; output <= outputs; output++) {
		values[`output_${output}_name`] = instance.getPortName('output', output)
		values[`output_${output}_source`] = instance.outputs[output] ?? ''
		// Empty rather than "false" while the web interface has not been reached yet, so a
		// button cannot claim a display is missing when the module simply does not know
		const sink = instance.getSinkActive(output)
		values[`output_${output}_sinkactive`] = sink === undefined ? '' : String(sink)
	}
	for (const preset of instance.getPresetNumbers()) {
		values[`preset_${preset}_name`] = instance.getPresetName(preset)
	}
	return values
}
