export function getActions(instance) {

	let maxIO = instance.config.device;
	let maxProf = instance.config.device * 2;
	
	return {
		'LO': {
			name: 'Load Profile',
			options: [
				{
					type: 'number',
					label: 'Profile',
					id: 'num',
					default: 1,
					min: 1,
					max: maxProf
				}
			],
			callback: async(action) => {
				let opt = action.options
				let num = (opt.num > 9 ? '' : '0') + opt.num
				let cmd = `LO ${num}`

				instance.sendCmd(cmd)
			}
		},
		'SS': {
			name: 'Set Crosspoint',
			options: [
				{
					type: 'number',
					label: 'Input (Source)',
					id: 'src',
					default: 1,
					min: 1,
					max: maxIO
				},
				{
					type: 'number',
					label: 'Output (Destination)',
					id: 'dst',
					default: 1,
					min: 1,
					max: maxIO
				}
			],
			callback: async(action) => {
				let opt = action.options
				let src = (opt.src > 9 ? '' : '0') + opt.src
				let dst = (opt.dst > 9 ? '' : '0') + opt.dst
				let cmd = `SS ${src},${dst}`

				instance.sendCmd(cmd)
			}
		}
	}
}