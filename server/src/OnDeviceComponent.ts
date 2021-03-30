import * as http from 'http';
import * as udp from 'dgram';
import * as express from 'express';
import * as portfinder from 'portfinder';

import { getStackTrace } from 'get-stack-trace';

import { RokuDevice } from './RokuDevice';
import { ConfigOptions } from './types/ConfigOptions';
import { utils } from './utils';
import { ODC } from '.';

export class OnDeviceComponent {
	public device: RokuDevice;
	// TODO pull from package.json
	private static readonly version = '1.0.0';
	private defaultTimeout = 10000;
	private callbackListenPort?: number;
	private storedDeviceRegistry?: {};
	private config?: ConfigOptions;
	private sentRequests: { [key: string]: ODC.Request } = {};
	private app = this.setupExpress();
	private server?: http.Server;

	constructor(device: RokuDevice, config?: ConfigOptions) {
		this.config = config;
		this.device = device;
	}

	public getConfig() {
		if (!this.config) {
			const config = utils.getOptionalConfigFromEnvironment();
			utils.validateRTAConfigSchema(config);
			this.config = config;
		}
		return this.config?.OnDeviceComponent;
	}

	public async callFunc(args: ODC.CallFuncArgs, options: ODC.RequestOptions = {}): Promise<{
		value: any;
		timeTaken: number;
	}> {
		const result = await this.sendRequest('callFunc', args, options);
		return result.body;
	}

	public async getFocusedNode(args: ODC.GetFocusedNodeArgs = {}, options: ODC.RequestOptions = {}) {
		const result = await this.sendRequest('getFocusedNode', args, options);
		return result.body.node as ODC.NodeRepresentation;
	}

	public async getValueAtKeyPath(args: ODC.GetValueAtKeyPathArgs, options: ODC.RequestOptions = {}): Promise<{
		found: boolean;
		value: any;
		timeTaken: number;
	}> {
		const result = await this.sendRequest('getValueAtKeyPath', args, options);
		return result.body;
	}

	public async getValuesAtKeyPaths(args: ODC.GetValuesAtKeyPathsArgs, options: ODC.RequestOptions = {}): Promise<{
		[key: string]: any;
		found: boolean;
		timeTaken: number;
	}> {
		const result = await this.sendRequest('getValuesAtKeyPaths', args, options);
		return result.body;
	}

	public async hasFocus(args: ODC.HasFocusArgs, options: ODC.RequestOptions = {}): Promise<boolean> {
		const result = await this.sendRequest('hasFocus', args, options);
		return result.body.hasFocus;
	}

	public async isInFocusChain(args: ODC.IsInFocusChainArgs, options: ODC.RequestOptions = {}): Promise<boolean> {
		const result = await this.sendRequest('isInFocusChain', args, options);
		return result.body.isInFocusChain;
	}

	public async observeField(args: ODC.ObserveFieldArgs, options: ODC.RequestOptions = {}): Promise<{
		/** If a match value was provided and already equaled the requested value the observer won't get fired. This lets you be able to check if that occurred or not  */
		observerFired: boolean;
		value: any;
		timeTaken: number;
	}> {
		let match = args.match;
		if (match !== undefined) {
			// Check if it's an object. Also have to check constructor as array is also an instanceof Object, make sure it has the keyPath key
			if (!((match instanceof Object) && (match.constructor.name === 'Object') && ('keyPath' in match))) {
				args.match = {
					base: args.base,
					keyPath: args.keyPath,
					value: (match as any)
				};
			}
		}

		if (!args.retryInterval) args.retryInterval = 100;

		const deviceConfig = this.device.getCurrentDeviceConfig();
		let retryTimeout: number;

		if (args.retryTimeout !== undefined) {
			retryTimeout = args.retryTimeout;
			// Adding a reasonable amount of time so that we get a more specific error message instead of the generic timeout
			options.timeout = retryTimeout + 200;
		} else {
			retryTimeout = options.timeout ?? deviceConfig.defaultTimeout ?? this.defaultTimeout;
			retryTimeout -= 200;
		}

		const multiplier = deviceConfig.timeoutMultiplier ?? 1;
		retryTimeout *= multiplier;

		args.retryTimeout = retryTimeout;

		const result = await this.sendRequest('observeField', this.breakOutFieldFromKeyPath(args), options);
		return result.body;
	}

	public async setValueAtKeyPath(args: ODC.SetValueAtKeyPathArgs, options: ODC.RequestOptions = {}): Promise<{
		timeTaken: number;
	}> {
		const result = await this.sendRequest('setValueAtKeyPath', this.breakOutFieldFromKeyPath(args), options);
		return result.body;
	}

	public async readRegistry(args: ODC.ReadRegistryArgs = {}, options: ODC.RequestOptions = {}): Promise<{
		values: {
			[section: string]: {[sectionItemKey: string]: string}
		}
	}> {
		const result = await this.sendRequest('readRegistry', args, options);
		return result.body;
	}

	public async writeRegistry(args: ODC.WriteRegistryArgs, options: ODC.RequestOptions = {}): Promise<{}> {
		const result = await this.sendRequest('writeRegistry', args, options);
		return result.body;
	}

	public async deleteRegistrySections(args: ODC.DeleteRegistrySectionsArgs, options: ODC.RequestOptions = {}): Promise<{}> {
		const result = await this.sendRequest('deleteRegistrySections', args, options);
		return result.body;
	}

	public async deleteEntireRegistry(args: ODC.DeleteEntireRegistrySectionsArgs = {}, options: ODC.RequestOptions = {}): Promise<{}> {
		const deleteSectionsArgs: ODC.DeleteRegistrySectionsArgs = {
			sections: [],
			allowEntireRegistryDelete: true
		};
		return await this.deleteRegistrySections(deleteSectionsArgs, options);
	}

	public async getServerHost(args: ODC.GetServerHostArgs = {}, options: ODC.RequestOptions = {}): Promise<{
		host: string
	}> {
		const result = await this.sendRequest('getServerHost', args, options);
		return result.body;
	}

	// In some cases it makes sense to break out the last key path part as `field` to simplify code on the device
	private breakOutFieldFromKeyPath(args: ODC.CallFuncArgs | ODC.ObserveFieldArgs | ODC.SetValueAtKeyPathArgs) {
		const keyPathParts = args.keyPath.split('.');
		return {...args, field: keyPathParts.pop(), keyPath: keyPathParts.join('.')};
	}

	private async sendRequest(type: ODC.RequestTypes, args: ODC.RequestArgs, options: ODC.RequestOptions = {}) {
		const stackTrace = await getStackTrace();
		await this.startServer();

		const requestId = utils.randomStringGenerator();
		const request: ODC.Request = {
			id: requestId,
			callbackPort: this.callbackListenPort!,
			type: type,
			args: args,
			settings: { logLevel: this.getConfig()?.logLevel ?? 'info' },
			version: OnDeviceComponent.version
		};
		const body = JSON.stringify(request);

		let client: udp.Socket | undefined;
		let retryInterval;
		const promise = new Promise<express.Request>((resolve, reject) => {
			request.callback = (req) => {
				const json = req.body;
				if (json?.success) {
					resolve(req);
				} else {
					const errorMessage = `${json?.error?.message} ${this.getCaller(stackTrace)}`;
					reject(new Error(errorMessage));
				}
			};

			client = udp.createSocket('udp4');
			const host = this.device.getCurrentDeviceConfig().host;
			this.debugLog(`Sending request to ${host} with body: ${body}`);

			client.on('message', function (message, remote) {
				const json = JSON.parse(message.toString());
				let receivedId = json.id;
				if (receivedId !== requestId) {
					reject(`Received id '${receivedId}' did not match request id '${requestId}'`);
				}
				clearInterval(retryInterval);
				client?.close();
				client = undefined;
			});

			this.sentRequests[requestId] = request;
			const _sendRequest = () => {
				client?.send(body, 9000, host, async (err) => {
					if (err) reject(err);
				});
			};
			retryInterval = setInterval(_sendRequest, 300);
			_sendRequest();
		});

		const deviceConfig = this.device.getCurrentDeviceConfig();
		let timeout = options?.timeout ?? deviceConfig.defaultTimeout ?? this.defaultTimeout;
		const multiplier = deviceConfig.timeoutMultiplier ?? 1;
		timeout *= multiplier;
		try {
			return await utils.promiseTimeout(promise, timeout);
		} catch(e) {
			let message: string;
			if (e.name === 'Timeout') {
				const logs = await this.device.getTelnetLog();
				message = `${request.type} request timed out after ${timeout}ms ${this.getCaller(stackTrace)}\nLog contents:\n${logs}`;
			} else {
				message = e
			}
			throw new Error(message);
		} finally {
			clearInterval(retryInterval);
			client?.close();
		}
	}

	// Starts up express server
	private async startServer() {
		if (this.server) {
			return;
		}
		const callbackListenPort = await portfinder.getPortPromise();

		this.debugLog('Starting callback server');
		this.server = this.app.listen(callbackListenPort, () => {
			this.debugLog(`Listening for callbacks on ${callbackListenPort}`);
		});
		this.callbackListenPort = callbackListenPort;

		if (this.getConfig()?.restoreRegistry) {
			this.debugLog('Storing original device registry state');
			const result = await this.readRegistry();
			this.storedDeviceRegistry = result.values;
		}
	}

	public async shutdown(waitForServerShutdown: boolean = false) {
		this.debugLog(`Shutting down`);

		return new Promise(async (resolve) => {
			if (!this.server) {
				resolve(undefined);
				return;
			}

			if (this.storedDeviceRegistry) {
				this.debugLog(`Restoring device registry to original state`);
				await this.writeRegistry({
					values: this.storedDeviceRegistry
				});
			}

			this.server.close((e) => {
				this.debugLog(`Server shutdown`);
				if (waitForServerShutdown) {
					resolve(e);
				}
			});

			this.server = undefined;
			if (!waitForServerShutdown) {
				resolve(undefined);
			}
		});
	}

	private setupExpress() {
		const app = express();

		app.use(express.json({limit: '2MB'}));

		app.post('/callback/:id', (req, res) => {
			const id = req.params.id;
			const request = this.sentRequests[id];
			if (request) {
				this.debugLog(`Server received response`, req.body);
				request.callback?.(req);
				res.send('OK');
				delete this.sentRequests[id];
			} else {
				res.statusCode = 404;
				res.send(`Request ${id} not found`);
			}
		});
		return app;
	}

	private getCaller(stackTrace?: any[]) {
		if (stackTrace) {
			for (let i = stackTrace.length - 1; i >= 0 ; i--) {
				const currentFrame = stackTrace[i];
				if (currentFrame.typeName === 'OnDeviceComponent') {
					// Go back one to get to the actual call that the user made if it exists
					let frame = stackTrace[i + 1];
					if (!frame) {
						frame = currentFrame;
					}
					return `(${frame.fileName}:${frame.lineNumber}:${frame.columnNumber})`;
				}
			}
		}
		return '';
	}

	private debugLog(message: string, ...args) {
		if (this.getConfig()?.serverDebugLogging) {
			console.log(`[ODC] ${message}`, ...args);
		}
	}
}
