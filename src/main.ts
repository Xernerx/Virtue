/** @format */

import { XernerxCommands } from '@xernerx/commands';
import { XernerxClient } from '@xernerx/framework';
import { XernerxStats } from '@xernerx/stats';
import { XernerxWebsocket } from '@xernerx/websocket';
import { config } from 'dotenv';
import fs from 'fs';
import { getApiUrl, getWsUrl, isCanaryTarget, isProductionTarget } from './lib/endpoints.js';

config({ quiet: true });

if (!process.env.API_URL?.trim() && isCanaryTarget()) {
	process.env.API_URL = 'https://api.canary.xernerx.com';
}

export class WebSocket extends XernerxWebsocket {
	constructor() {
		super({
			token: (process.env.WS_TOKEN || process.env.API_TOKEN)!,
			url: getWsUrl(),
		});
	}

	override async connect() {
		const rawWs = (this as any).ws;
		if (rawWs && rawWs.readyState !== 1 && rawWs.readyState !== 0) {
			(this as any).ready = false;
			(this as any).connecting = null;
		}
		if ((this as any).ready && rawWs?.readyState === 1) {
			return;
		}
		return super.connect();
	}
}

export const websocket = new WebSocket();

export class Client extends XernerxClient {
	declare public websocket: WebSocket;

	constructor() {
		super({
			intents: ['Guilds', 'GuildMessages', 'GuildVoiceStates'],
			token: process.env.TOKEN as string,
			guildId: process.env.GUILD_ID || '784094726432489522',
			owners: process.env.OWNER_ID || '482513687417061376',
			global: isProductionTarget(),
		});

		this.modules.eventHandler.loadEvents({
			directory: 'dist/events',
		});

		this.modules.commandHandler.loadSlashCommands({
			directory: 'dist/commands/slash',
		});

		this.modules.commandHandler.loadContextCommands({
			directory: 'dist/commands/context',
		});

		fs.mkdirSync('dist/commands/message', { recursive: true });

		this.modules.commandHandler.loadMessageCommands({
			directory: 'dist/commands/message',
			handleEdits: true,
			handleDeletions: true,
		});

		const apiUrl = getApiUrl();

		this.modules.extensionHandler.loadExtensions(
			new XernerxCommands(this, {
				token: process.env.API_TOKEN!,
				url: apiUrl,
			}),
			new XernerxStats(this, {
				token: process.env.API_TOKEN!,
				url: apiUrl,
			})
		);

		this.websocket = websocket;

		this.connect();
	}
}

await websocket.connect().catch(() => null);

export const client = new Client();
