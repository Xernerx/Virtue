/** @format */

import { XernerxCommands } from '@xernerx/commands';
import { XernerxClient } from '@xernerx/framework';
import { XernerxStats } from '@xernerx/stats';
import { XernerxWebsocket } from '@xernerx/websocket';
import { config } from 'dotenv';

config({ quiet: true });

export class WebSocket extends XernerxWebsocket {
	constructor() {
		super({
			token: process.env.WS_TOKEN!,
			dev: process.env.NODE_ENV == 'DEVELOPMENT',
		});
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
			owners: ['438029970371837962', '482513687417061376'],
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
