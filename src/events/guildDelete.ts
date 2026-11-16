/** @format */

import { EventBuilder } from '@xernerx/framework';
import type { Guild } from 'discord.js';
import { deleteGuildProfile } from '../lib/guildSync.js';

export default class GuildDeleteEvent extends EventBuilder {
	constructor() {
		super('guildDelete', {
			name: 'guildDelete',
			emitter: 'client',
			once: false,
		});
	}

	override async run(guild: Guild) {
		if (!guild?.id) return;

		const ws = (this.client as any).websocket;
		await deleteGuildProfile(ws, guild.id);
	}
}
