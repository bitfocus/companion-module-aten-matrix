var telnet = require('../../telnet');
var instance_skel = require('../../instance_skel');

var actions  = require('./actions')
var feedback = require('./feedback')
var debug;
var log;

class instance extends instance_skel {

	constructor(system,id,config){
		super(system,id,config);
		
		Object.assign(this, {
			...feedback,
			...actions,
		});
		
		this.outputs = []; //index is output number, value is input roted to it
		this.login = false;
		this.heartbeatTime = 60;
		this.heartbeatInterval = null;

		this.actions();
	}

	//Setup the actions
	actions(system) {

		this.setActions(this.getActions());
	}

	//Execute provided action
	action(action) {
		let opt = action.options;
		let cmd = '';
		
		switch (action.action) {

			case 'LO':
				let num = (opt.num > 9 ? '' : '0') + opt.num;
				cmd = `LO ${num}`;
				break;

			case 'SS':
				let src = (opt.src > 9 ? '' : '0') + opt.src;
				let dst = (opt.dst > 9 ? '' : '0') + opt.dst;
				cmd = `SS ${src},${dst}`;
				break;
		}
		if (cmd != undefined && cmd != ''){
			
			this.socket.write(cmd + '\r\n');
		}
	}

	//Define configuration fields for web config
	config_fields() {
		return [
			{
				type: 'text',
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
				regex: this.REGEX_IP
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
	}

	//Clean up intance before it is destroyed
	destroy() {
		if (this.socket !== undefined) {
			this.socket.destroy();
		}
		
		if (this.heartbeatInterval !== undefined) {
			clearInterval(this.heartbeatInterval);
		}

		this.debug('DESTROY', this.id)
	}

	//Main init function called on start
	init() {
		debug = this.debug;
		log = this.log;

		this.initFeedbacks();
		this.initTCP();
	}

	//Initialise the Telnet socket
	initTCP() {
		var receivebuffer = '';

		if(this.socket !== undefined) {
			this.socket.destroy();
			delete this.socket;

			this.login == false;
		}

		if(this.heartbeatInterval !== undefined){
			clearInterval(this.heartbeatInterval);
		}

		if (this.config.port === undefined){
			this.config.port = 23;
		}

		if (this.config.host) {
			this.socket = new telnet(this.config.host,this.config.port);

			this.socket.on('status_change', (status, message) => {
				if(status !== this.STATUS_OK) {
					this.status(status, message);
				}
			});
			
			this.socket.on('error', (err) => {
				this.debug("Network error", err);
				this.log('error',"Network error: " + err.message);
				this.login = false;
			});
			
			this.socket.on('connect', () => {
				this.debug("Connected");
				this.login = false;
			});
			
			this.socket.on('end', () => {
				this.debug("Disconnected")
				if (this.heartbeatInterval !== undefined){
					clearInterval(this.heartbeatInterval);
				}
				this.debug("Heart Destroyed");
				this.login = false;
			});

			this.socket.on('data', (chunk) => {
				var i = 0, line = '', offset = 0;
				receivebuffer += chunk;

				// Split up Lines with new line and Process
				while ( (i = receivebuffer.indexOf('\r\n', offset)) !== -1) {
					line = receivebuffer.substr(offset, i - offset);
					offset = i + 1;
					this.processLine(line.toString("utf8"));
				}
				receivebuffer = receivebuffer.substr(offset);

				// Handle Login Prompts
				if (receivebuffer.match(/Enter Username:/)){

					this.login = false;
					this.status(this.STATUS_WARNING,'Logging in');
					this.socket.write(this.config.user + '\r\n');
				} 
				if (this.login === false && receivebuffer.match(/Password:/)){

					this.socket.write(this.config.pass + '\r\n');
				}
			});
		}
	}

	//Processes lines recieved
	processLine(data){
		
		if (this.login === false && data.match(/is established/)){
			//Successful Login
			this.login = true;
			this.status(this.STATUS_OK);
			this.log('info', 'ATEN Logged in')
			this.pollOutputs();

			this.heartbeatInterval = setInterval(
				this.sendHeartbeatCommand.bind(this),
				(this.heartbeatTime*1000)
			);
		} else if (data.match(/Incorrect/) || data.match(/User login fail/)){
			
			this.login = false;
			this.status(this.STATUS_ERROR, 'Incorrect user/pass');
			this.log('error', 'Incorrect username or password');

		} else if (data.match(/Switch/)){
			//Matrix Informing after Switch event
			this.processSwitch(data);

		} else if (data.match(/connected to Output/)){
			//Matrix Informing after query
			this.processRoute(data);

		} else if (data.match(/Load/)){
			//Matrix informing after Load Profile
			this.pollOutputs();
		}
	}

	//Processes response from Matrix after a switch has been made
	processSwitch(data) {
		
		var regex = /Switch input (\d*) to output (\d*)/gm;
		var result = regex.exec(data);

		if (result.length >= 3) {

			let src = parseInt(result[1], 10);
			let dst = parseInt(result[2], 10);
			this.outputs[dst] = src;
			this.checkFeedbacks('output_bg');

		} else {

			this.debug('Unknown in processSwitch Regex got: ' + result);
		}
	}

	//Process response from Matrix after polling
	processRoute(data) {

		var regex = /Input Port (\d*) is connected to Output Port (\d*)/gm;
		var result = regex.exec(data);

		if (result.length >= 3) {

			let src = parseInt(result[1], 10);
			let dst = parseInt(result[2], 10);
			this.outputs[dst] = src;
			this.checkFeedbacks('output_bg');

		} else {
			this.debug('Unknown in processRoute Regex got: ' + result);
		}
	}

	//Poll the matrix for all routes to outputs
	pollOutputs () {

		for (let i = 1; i <= this.config.device; i++) {
			this.socket.write(`RO ${i}\r\n`);
		}
		this.checkFeedbacks('output_bg')
	}

	//Send new line to keep connection alive
	sendHeartbeatCommand() {
		this.debug('HEARTBEAT');
		this.socket.write("\n");
	}
	
	//Define feedbacks
	initFeedbacks() {
		var feedbacks = this.getFeedbacks();
		this.setFeedbackDefinitions(feedbacks);
	}

	//On Config changes apply new config
	updateConfig(config) {
		var resetConnection = false;

		if (this.config != config) {
			resetConnection = true;
		}

		this.config = config;

		this.outputs = [];
		this.actions();
		this.initFeedbacks();

		if (resetConnection === true || this.socket === undefined) {
			this.login = false;
			this.initTCP();
		}
	}
}

exports = module.exports = instance;