import { CronJob } from 'cron';
import { BigNumber, ethers, utils } from "ethers";
import {
	ICronJobs,
	INode, 
    INodeData, 
    INodeParams, 
    NodeType,
} from '../../src/Interface';
import { returnNodeExecutionData } from '../../src/utils';
import EventEmitter from 'events';
import { 
	PolygonNetworks,
	networkExplorers, 
	polygonNetworkProviders,
	getPolygonMainnetProvider,
	getPolygonTestnetProvider,
	getCustomRPCProvider,
	getCustomWebsocketProvider
} from '../../src/ChainNetwork';

class MATICBalanceTrigger extends EventEmitter implements INode {
	
	label: string;
    name: string;
    type: NodeType;
    description?: string;
    version: number;
	icon?: string;
    incoming: number;
	outgoing: number;
	networks?: INodeParams[];
    credentials?: INodeParams[];
    inputParameters?: INodeParams[];
	cronJobs: ICronJobs;

	constructor() {
		super();
		this.label = 'MATIC Balance Trigger';
		this.name = 'MATICBalanceTrigger';
		this.icon = 'polygon.svg';
		this.type = 'trigger';
		this.version = 1.0;
		this.description = 'Start workflow whenever MATIC balance in wallet changes';
		this.incoming = 0;
		this.outgoing = 1;
		this.cronJobs = {};
		this.networks = [
			{
				label: 'Network',
				name: 'network',
				type: 'options',
				options: [
					...PolygonNetworks,
				],
				default: 'homestead',
			},
			{
				label: 'Network Provider',
				name: 'networkProvider',
				type: 'options',
				options: [
					...polygonNetworkProviders
				],
				default: 'polygon',
			},
			{
				label: 'RPC Endpoint',
				name: 'jsonRPC',
				type: 'string',
				default: '',
				show: {
					'networks.networkProvider': ['customRPC']
				}
			},
			{
				label: 'Websocket Endpoint',
				name: 'websocketRPC',
				type: 'string',
				default: '',
				show: {
					'networks.networkProvider': ['customWebsocket']
				}
			},
			
		] as INodeParams[];
		this.credentials = [
			{
				label: 'Credential Method',
				name: 'credentialMethod',
				type: 'options',
				options: [
					{
						label: 'Alchemy API Key',
						name: 'alchemyApi',
						show: {
							'networks.networkProvider': ['alchemy']
						}
					},
					{
						label: 'Infura API Key',
						name: 'infuraApi',
						show: {
							'networks.networkProvider': ['infura']
						}
					},
				],
				default: '',
				show: {
					'networks.networkProvider': ['infura', 'alchemy']
				}
			},
		] as INodeParams[];
		this.inputParameters = [
			{
				label: 'Wallet Address',
				name: 'address',
				type: 'string',
				default: '',
			},
			{
				label: 'Trigger Condition',
				name: 'triggerCondition',
				type: 'options',
				options: [
					{
						label: 'When balance increased',
						name: 'increase',
					},
					{
						label: 'When balance decreased',
						name: 'decrease',
					},
				],
				default: 'increase'
			},
			{
				label: 'Polling Time',
				name: 'pollTime',
				type: 'options',
				options: [
					{
						label: 'Every 15 secs',
						name: '15s',
					},
					{
						label: 'Every 30 secs',
						name: '30s',
					},
					{
						label: 'Every 1 min',
						name: '1min',
					},
					{
						label: 'Every 5 min',
						name: '5min',
					}, 
					{
						label: 'Every 10 min',
						name: '10min',
					},
				],
				default: '30s',
			},
		] as INodeParams[];
	};

	async runTrigger(nodeData: INodeData): Promise<void> {

		const networksData = nodeData.networks;
		const credentials = nodeData.credentials;
		const inputParametersData = nodeData.inputParameters;

        if (networksData === undefined || inputParametersData === undefined) {
            throw new Error('Required data missing');
        }

		const networkProvider = networksData.networkProvider as string;
		const network = networksData.network as string;

		if (credentials === undefined && networkProvider !== 'customRPC'
		 && networkProvider !== 'customWebsocket' && networkProvider !== 'cloudfare') {
			throw new Error('Missing credentials');
		}

		let provider: any;

		if (networkProvider === 'alchemy') {
			provider = new ethers.providers.AlchemyProvider(network, credentials!.apiKey);

		} else if (networkProvider === 'infura') {
			provider = new ethers.providers.InfuraProvider(network, {
				apiKey: credentials!.apiKey,
				secretKey: credentials!.secretKey
			});

		} else if (networkProvider === 'polygon') {
			if (network === 'matic') provider = await getPolygonMainnetProvider();
			else if (network === 'maticmum') provider = await getPolygonTestnetProvider();

		} else if (networkProvider === 'customRPC') {
			provider = getCustomRPCProvider(networksData.jsonRPC as string);
		
		} else if (networkProvider === 'customWebsocket') {
			provider = getCustomWebsocketProvider(networksData.websocketRPC as string);
		}

		const emitEventKey = nodeData.emitEventKey as string;
		const address = inputParametersData.address as string || '';
		const pollTime = inputParametersData.pollTime as string || '30s';
		const triggerCondition = inputParametersData.triggerCondition as string || 'increase';
		const cronTimes: string[] = [];

		if (pollTime === '15s') {
			cronTimes.push(`*/15 * * * * *`);
		} else if (pollTime === '30s') {
			cronTimes.push(`*/30 * * * * *`);
		} else if (pollTime === '1min') {
			cronTimes.push(`*/1 * * * *`);
		} else if (pollTime === '5min') {
			cronTimes.push(`*/5 * * * *`);
		} else if (pollTime === '10min') {
			cronTimes.push(`*/10 * * * *`);
		}
				
		let lastBalance: BigNumber = await provider.getBalance(address);

		const executeTrigger = async() => {
			let newBalance: BigNumber = await provider.getBalance(address);
			
			if (!newBalance.eq(lastBalance)) {
				if (triggerCondition === 'increase' && (newBalance.gt(lastBalance))) {
					const balanceInMATIC = utils.formatEther(BigNumber.from(newBalance.toString()));
					const diffInMATIC = newBalance.sub(lastBalance);
					const returnItem = {
						newBalance: `${balanceInMATIC} MATIC`,
						lastBalance: `${utils.formatEther(BigNumber.from(lastBalance.toString()))} MATIC`,
						difference: `${utils.formatEther(BigNumber.from(diffInMATIC.toString()))} MATIC`,
						explorerLink: `${networkExplorers[network]}/address/${address}`,
						triggerCondition: 'MATIC balance increase'
					};
					lastBalance = newBalance;
					this.emit(emitEventKey, returnNodeExecutionData(returnItem));
				} else if (triggerCondition === 'decrease' && (newBalance.lt(lastBalance))) {
					const balanceInMATIC = utils.formatEther(BigNumber.from(newBalance.toString()));
					const diffInMATIC = lastBalance.sub(newBalance);
					const returnItem = {
						newBalance: `${balanceInMATIC} MATIC`,
						lastBalance: `${utils.formatEther(BigNumber.from(lastBalance.toString()))} MATIC`,
						difference: `${utils.formatEther(BigNumber.from(diffInMATIC.toString()))} MATIC`,
						explorerLink: `${networkExplorers[network]}/address/${address}`,
						triggerCondition: 'MATIC balance decrease'
					};
					lastBalance = newBalance;
					this.emit(emitEventKey, returnNodeExecutionData(returnItem));
				} else {
					lastBalance = newBalance;
				}
			}
		};

		// Start the cron-jobs
		if (Object.prototype.hasOwnProperty.call(this.cronJobs, emitEventKey)) {
			for (const cronTime of cronTimes) {
				// Automatically start the cron job
				this.cronJobs[emitEventKey].push(new CronJob(cronTime, executeTrigger, undefined, true));
			}
		} else {
			for (const cronTime of cronTimes) {
				// Automatically start the cron job
				this.cronJobs[emitEventKey] = [new CronJob(cronTime, executeTrigger, undefined, true)];
			}
		}
	}

	async removeTrigger(nodeData: INodeData): Promise<void> {
		const emitEventKey = nodeData.emitEventKey as string;
		
		if (Object.prototype.hasOwnProperty.call(this.cronJobs, emitEventKey)) {
			const cronJobs = this.cronJobs[emitEventKey];
			for (const cronJob of cronJobs) {
				cronJob.stop();
			}
			this.removeAllListeners(emitEventKey);
		}
	}
}

module.exports = { nodeClass: MATICBalanceTrigger }