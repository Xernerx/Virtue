/** @format */

import { EventBuilder } from '@xernerx/framework';
import { ActivityType, type PresenceStatusData } from 'discord.js';

export default class ClientReadyEvent extends EventBuilder {
	private guildsSynced = false;

	constructor() {
		super('clientReady', {
			name: 'clientReady',
			emitter: 'client',
			once: true,
		});
	}

	private async syncGuilds() {
		if (this.guildsSynced) return;

		const ws = (this.client as any).websocket;

		for (const [, guild] of this.client.guilds.cache) {
			const existing = await ws.get('virtue', 'guilds', { id: guild.id }).catch(() => null);

			if (!existing) {
				await ws.create('virtue', 'guilds', { id: guild.id }).catch(() => null);
			}
		}

		this.guildsSynced = true;
	}

	override async run() {
		const client = this.client;
		const ws = (client as any).websocket;
		const healthUrl = process.env.NODE_ENV == 'DEVELOPMENT' ? 'https://ws.dev.xernerx.com/health' : 'https://ws.xernerx.com/health';

		const connect = async () => {
			const healthy = await fetch(healthUrl)
				.then((res) => res.ok)
				.catch(() => false);

			const connected = healthy
				? await ws
						.connect()
						.then(() => true)
						.catch(() => false)
				: false;

			const activity = {
				name: 'Xernerx WS',
				type: ActivityType.Streaming,
				state: 'Connecting to the Xernerx WS',
				url: 'https://app.xernerx.com',
			};

			const presence = {
				status: 'idle' as PresenceStatusData,
				activities: [activity],
			};

			if (!connected) {
				presence.status = 'dnd' as PresenceStatusData;
				activity.name = 'Services Unavailable';
				activity.type = ActivityType.Streaming;
				activity.state = 'Connection to the Xernerx WS has been lost, some features may not work as intended.';
			} else {
				presence.status = 'online' as PresenceStatusData;
				activity.name = 'Watching you level!';
				activity.type = ActivityType.Custom;
				activity.state = `Keeping track of your activeness! | ${client.guilds.cache.size} servers!`;

				await this.syncGuilds();

				if (client.user?.id) {
					await ws
						.update('xernerx', 'bots', {
							id: client.user.id,
							status: presence.status,
							statusUpdatedAt: new Date(),
							activity: activity.state || activity.name,
						})
						.catch(() => null);
				}
			}

			client.user?.setPresence(presence);

			setTimeout(connect, 60000);
		};

		connect();
	}
}
