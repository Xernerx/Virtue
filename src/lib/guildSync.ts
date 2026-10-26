/** @format */

import type { Guild } from 'discord.js';

export async function syncGuildMetadata(ws: any, guild: Guild) {
	if (!ws || !guild?.id) return;

	const rolesCollection = await guild.roles.fetch().catch(() => guild.roles.cache);
	const serverRoles = Array.from(rolesCollection?.values?.() || [])
		.filter((r: any) => r && r.id && r.id !== guild.id && !r.managed)
		.sort((a: any, b: any) => (b.position || 0) - (a.position || 0))
		.map((r: any) => ({
			id: String(r.id),
			name: String(r.name),
			color: Number(r.color) || 0,
			position: Number(r.position) || 0,
			managed: Boolean(r.managed),
		}));

	const channelsCollection = await guild.channels.fetch().catch(() => guild.channels.cache);
	const serverChannels = Array.from(channelsCollection?.values?.() || [])
		.filter((c: any) => c && c.id && (c.type === 0 || c.type === 5))
		.sort((a: any, b: any) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0))
		.map((c: any) => ({
			id: String(c.id),
			name: String(c.name),
			type: Number(c.type) || 0,
		}));

	await ws
		.update('virtue', 'guilds', {
			id: guild.id,
			serverRoles,
			serverChannels,
		})
		.catch(() => null);
}
