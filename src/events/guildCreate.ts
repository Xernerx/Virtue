/** @format */

import { EventBuilder } from '@xernerx/framework';
import type { Guild } from 'discord.js';

export default class GuildCreateEvent extends EventBuilder {
	constructor() {
		super('guildCreate', {
			name: 'guildCreate',
			emitter: 'client',
			once: false,
		});
	}

	override async run(guild: Guild) {
		if (!guild?.id) return;

		const ws = (this.client as any).websocket;

		const existing = await ws.get('virtue', 'guilds', { id: guild.id }).catch(() => null);

		if (!existing) {
			await ws.create('virtue', 'guilds', { id: guild.id }).catch(() => null);
		}
	}
}
