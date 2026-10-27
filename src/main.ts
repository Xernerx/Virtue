/** @format */

import { XernerxCommands } from '@xernerx/commands';
import { XernerxClient } from '@xernerx/framework';
import { XernerxStats } from '@xernerx/stats';
import { XernerxWebsocket } from '@xernerx/websocket';
import { config } from 'dotenv';

config({ quiet: true });

export const isDev = process.env.NODE_ENV?.toUpperCase() === 'DEVELOPMENT' || process.env.ENVIRONMENT?.toUpperCase() === 'DEVELOPMENT';

export class WebSocket extends XernerxWebsocket {
	constructor() {
		super({
			token: (process.env.WS_TOKEN || process.env.API_TOKEN)!,
			dev: isDev,
		});
	}

	override async connect() {
		const rawWs = (this as any).ws;
		if (rawWs && rawWs.readyState !== 1 && rawWs.readyState !== 0) {
			(this as any).ready = false;
			(this as any).connecting = null;
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
			guildId: '784094726432489522',
			owners: '482513687417061376',
			global: process.env.NODE_ENV != 'DEVELOPMENT',
		});

		this.modules.eventHandler.loadEvents({
			directory: 'dist/events',
		});

		this.modules.commandHandler.loadSlashCommands({
			directory: 'dist/commands/slash',
		});

		this.modules.extensionHandler.loadExtensions(
			new XernerxCommands(this, {
				token: process.env.API_TOKEN!,
			})
		);

		this.websocket = websocket;

		this.connect();
	}
}

await websocket.connect().catch(() => null);

export const client = new Client();

new XernerxStats(client, { token: process.env.API_TOKEN! });
