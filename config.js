import { Regex } from '@companion-module/base'

export const ConfigFields = [
	{
		type: 'static-text',
		id:   'info',
		width: 12,
		label: 'Information',
		value: 'Control an ATEN HDMI Matrix via telnet. Ensure account details are correct and telnet is enabled on Web UI'
	},
	{
		type: 'textinput',
		id:   'host',
		label: 'Target IP',
		default: '',
		width: 6,
		regex: Regex.IP
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
		default: 'password'
	},
	{
		type: 'dropdown',
		id: 'device',
		label: 'Device Type',
		width: 6,
		default: '8',
		choices: [
			{ id: '4',  label: 'VM0404HA (4x4)'   },
			{ id: '8',  label: 'VM0808HA (8x8)'   },
			{ id: '16', label: 'VM51616H (16x16)' }
		]
	}
]
