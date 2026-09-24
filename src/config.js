import { Regex } from '@companion-module/base'
import { getDeviceSize, getMatrixSizeChoices, getSizeIdForModel } from './utils.js'

// Takes the model the matrix reported on its last login, if it has been seen, so the
// config can show what it is actually talking to.
export function getConfigFields(detectedModel) {
	return [
		{
			type: 'static-text',
			id: 'info',
			width: 12,
			label: 'Information',
			value:
				'Control an ATEN HDMI Matrix via telnet. Ensure account details are correct and telnet is enabled on Web UI',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Target IP',
			default: '',
			width: 6,
			regex: Regex.IP,
		},
		{
			type: 'textinput',
			id: 'user',
			label: 'Username',
			width: 6,
			default: 'administrator',
		},
		{
			type: 'textinput',
			id: 'pass',
			label: 'Password',
			width: 6,
			default: 'password',
		},
		{
			type: 'checkbox',
			id: 'autoSetPassword',
			label: 'Automatically change to selected password if factory default password is active',
			width: 12,
			default: false,
			description:
				'A factory-fresh or factory-reset matrix still uses its default password and forces a change on the first ' +
				'login. With this enabled, the module logs in with the default and sets the password above on the device.',
		},
		...matrixSizeFields(detectedModel),
	]
}

// The matrix reports its own model on login, so the size only has to be asked for when that
// model is one this module doesn't know. Until then there is nothing useful to choose from.
function matrixSizeFields(detectedModel) {
	const knownSize = detectedModel ? getSizeIdForModel(detectedModel) : undefined

	if (knownSize !== undefined) {
		const { inputs, outputs } = getDeviceSize({ device: knownSize })
		return [
			{
				type: 'static-text',
				id: 'detectedModel',
				width: 12,
				label: 'Matrix model',
				value: `Detected <b>${detectedModel}</b>, so this is treated as a ${inputs} in / ${outputs} out matrix.`,
			},
		]
	}

	return [
		{
			type: 'static-text',
			id: 'detectedModel',
			width: 12,
			label: 'Matrix model',
			value: detectedModel
				? `The matrix reports <b>${detectedModel}</b>, which this module does not know yet. Pick the entry ` +
					'below whose number of inputs and outputs matches it.'
				: 'Not known yet - the matrix reports its model when the module logs in, and the size is taken from ' +
					'it. Only if the model is unknown does a size have to be picked here.',
		},
		...(detectedModel
			? [
					{
						type: 'dropdown',
						id: 'device',
						label: 'Matrix Size',
						width: 6,
						default: '8x8',
						choices: getMatrixSizeChoices(),
					},
				]
			: []),
	]
}
