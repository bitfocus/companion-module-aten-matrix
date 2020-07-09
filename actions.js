module.exports = {
	getActions () {

		maxIO = this.config.device;
		maxProf = this.config.device * 2;

		var actions = {
			'LO': {
				label: 'Load Profile',
				options: [
					{
						type: 'number',
						label: 'Profile',
						id: 'num',
						default: 1,
						min: 1,
						max: maxProf
					}
				]
			},
			'SS': {
				label: 'Set Crosspoint',
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
				]
			}
		};
		return actions;
	}
}