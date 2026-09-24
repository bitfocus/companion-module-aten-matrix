import { inputField, outputField, pad2, presetField } from './utils.js'
import { MAX_NAME_LENGTH, sanitizeName } from './http.js'

export function getActions(instance) {
	return {
		xpt: {
			name: 'Route Input directly to Output',
			options: [inputField(instance, { withSelected: true }), outputField(instance, { withSelected: true })],
			callback: async (action) => {
				const input = instance.resolveInput(action.options.input)
				const output = instance.resolveOutput(action.options.output)

				if (input === undefined || output === undefined) {
					instance.log('warn', 'Route Input directly to Output: no source and/or destination selected')
					return
				}
				instance.route(input, output)
			},
		},
		selectSource: {
			name: 'Select source for take',
			options: [inputField(instance, { id: 'port' })],
			callback: async (action) => {
				instance.state.selectedSource = Number(action.options.port)
				instance.checkFeedbacks('sourceSelected', 'route')
				instance.updateVariableValues()
			},
		},
		selectDestination: {
			name: 'Select destination for take',
			options: [outputField(instance, { id: 'port' })],
			callback: async (action) => {
				instance.state.selectedDestination = Number(action.options.port)
				instance.checkFeedbacks('destinationSelected', 'route')
				instance.updateVariableValues()
			},
		},
		takeSalvo: {
			name: 'Take - route the selected source to the selected destination',
			options: [],
			callback: async () => {
				const { selectedSource, selectedDestination } = instance.state
				if (selectedSource === undefined || selectedDestination === undefined) {
					instance.log('warn', 'Take: no source and/or destination selected')
					return
				}
				instance.route(selectedSource, selectedDestination)
			},
		},
		preset: {
			name: 'Recall Preset',
			options: [presetField(instance)],
			callback: async (action) => {
				instance.sendCmd(`LO ${pad2(action.options.preset)}`)

				instance.lastPreset = Number(action.options.preset)
				instance.checkFeedbacks('presetRecalled')
				instance.updateVariableValues()
			},
		},
		savePreset: {
			name: 'Save Preset',
			options: [presetField(instance)],
			callback: async (action) => {
				instance.sendCmd(`SV ${pad2(action.options.preset)}`)
			},
		},
		refresh: {
			name: 'Refresh routing status',
			options: [],
			callback: async () => {
				instance.pollOutputs()
			},
		},
		refreshPortNames: {
			name: 'Refresh port and preset names',
			description:
				"Re-reads the port and preset names, and which preset slots are in use, from the matrix's web interface. The matrix does not announce a rename, so " +
				'use this after renaming a port anywhere but here.',
			options: [],
			callback: async () => {
				await instance.refreshNames()
			},
		},
		renamePort: {
			name: 'Rename port',
			description:
				`Renames an input or output on the matrix itself, exactly as its web interface would, and re-reads the ` +
				`names afterwards. Letters, digits, spaces and ! # $ % - . ^ _ \` { } ~ are fine, up to ` +
				`${MAX_NAME_LENGTH} characters; the characters " & ' ( ) * + , / : ; < = > ? @ [ \\ ] | are dropped, ` +
				`since the matrix refuses a name containing them.`,
			options: [
				{
					type: 'dropdown',
					label: 'Port type',
					id: 'kind',
					default: 'input',
					choices: [
						{ id: 'input', label: 'Input' },
						{ id: 'output', label: 'Output' },
					],
					// isVisibleExpression may only refer to fields that cannot be expressions
					disableAutoExpression: true,
				},
				{ ...inputField(instance), isVisibleExpression: '$(options:kind) == "input"' },
				{ ...outputField(instance), isVisibleExpression: '$(options:kind) == "output"' },
				{
					type: 'textinput',
					label: 'New name',
					id: 'name',
					default: '',
					useVariables: true,
				},
			],
			callback: async (action, context) => {
				const kind = action.options.kind === 'output' ? 'output' : 'input'
				const port = Number(action.options[kind])
				const name = await context.parseVariablesInString(action.options.name)

				if (sanitizeName(name) === '') {
					instance.log('warn', `Rename port: "${name}" leaves no name the matrix would accept`)
					return
				}
				await instance.renamePort(kind, port, name)
			},
		},
		factoryReset: {
			name: 'Factory reset device',
			description:
				'DANGER: resets the matrix to its factory defaults, erasing all custom settings - including its IP address, ' +
				'login credentials and saved profiles/crosspoints. This cannot be undone, and will very likely disconnect ' +
				'this module until it is reconfigured to match. Only usable once the confirmation checkbox below is ticked.',
			options: [
				{
					type: 'checkbox',
					label: 'I understand this permanently erases all settings on the device',
					id: 'confirm',
					default: false,
				},
			],
			callback: async (action) => {
				if (!action.options.confirm) {
					instance.log(
						'warn',
						"Factory reset was triggered without the confirmation checkbox ticked in the action's options - ignoring it.",
					)
					return
				}

				instance.log('warn', 'Sending factory reset command to matrix - this erases all of its settings')
				instance.sendCmd('reset')
			},
		},
	}
}
