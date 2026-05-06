/** @format */

import { EventBuilder } from '@xernerx/framework';
import { ActivityType, type PresenceStatusData } from 'discord.js';

export default class ClientReadyEvent extends EventBuilder {
	constructor() {
		super('clientReady', {
			name: 'clientReady',
			emitter: 'client',
			once: true, // ← fix this
		});
	}

	override async run() {
		const client = this.client;

		async function connect() {
			const status = await fetch(`${process.env.API_URL}/status`)
				.then((res) => res.json())
				.catch((error) => error.message);

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

			if (typeof status == 'string') {
				presence.status = 'dnd' as PresenceStatusData;
				activity.name = 'Services Unavailable';
				activity.type = ActivityType.Streaming;
				activity.state = 'Connection to the Xernerx WS has been lost, some features may not work as intended.';
			} else {
				presence.status = 'online' as PresenceStatusData;
				activity.name = 'Watching you level!';
				activity.type = ActivityType.Custom;
				activity.state = `Keeping track of your activeness! | ${client.guilds.cache.size} servers!`;
			}

			client.user?.setPresence(presence);

			setTimeout(connect, 60000);
		}

		connect();
	}
}
