/** @format */

import { XernerxClient } from '@xernerx/framework';
import { XernerxStats } from '@xernerx/stats';
import { XernerxWebsocket } from '@xernerx/websocket';
import { config } from 'dotenv';

config({ quiet: true });

export class WebSocket extends XernerxWebsocket {
	constructor() {
		super({
			token: process.env.WS_TOKEN!,
		});
	}
}

export const websocket = new WebSocket();

export class Client extends XernerxClient {
	declare public websocket;

	constructor() {
		super({
			intents: ['Guilds', 'GuildMessages'],
			token: process.env.TOKEN as string,
			guildId: '784094726432489522',
			global: process.env.NODE_ENV != 'DEVELOPMENT',
		});

		this.modules.eventHandler.loadEvents({
			directory: 'dist/events',
		});

		this.modules.commandHandler.loadSlashCommands({
			directory: 'dist/commands/slash',
		});

		this.websocket = websocket;

		this.connect();
	}
}

await websocket.connect();

export const client = new Client();

new XernerxStats(client as any, { token: process.env.API_TOKEN! });
