/** @format */

import { EventBuilder } from '@xernerx/framework';
import { calculateExperience, calculateLevel } from '../lib/levels.js';

const cooldowns = {
	easy: 30,
	casual: 45,
	balanced: 60,
	hard: 120,
	extreme: 300,
} as const;

export default class MessageCreateEvent extends EventBuilder {
	private globalCooldowns = new Map<string, number>();
	private guildCooldowns = new Map<string, number>();

	constructor() {
		super('messageCreate', {
			name: 'messageCreate',
			emitter: 'client',
			once: false,
		});
	}

	private async getOrCreate(service: string, action: string, query: any) {
		const ws = (this.client as any).websocket;

		let getFailed = false;
		let data = await ws.get(service, action, query).catch((err: unknown) => {
			getFailed = true;
			console.error(`[WS] GET ${service}/${action} failed:`, (err as Error)?.message || err);
			return null;
		});

		if (!data) {
			data = await ws.create(service, action, query).catch((err: unknown) => {
				console.error(`[WS] POST ${service}/${action} failed:`, (err as Error)?.message || err);
				return null;
			});
		}

		if (!data && !getFailed) {
			data = await ws.update(service, action, query).catch(() => null);
		}

		return data ?? null;
	}

	private hasCooldown(key: string, duration: number, cache: Map<string, number>) {
		const now = Date.now();
		const expires = cache.get(key);

		if (expires && expires > now) return true;

		cache.set(key, now + duration * 1000);

		return false;
	}

	override async run(message: any) {
		if (!message.guild || message.author.bot || message.system) return;

		const [user, member, text, rawGuild] = await Promise.all([
			this.getOrCreate('xernerx', 'levels', {
				ownerId: message.author.id,
			}),
			this.getOrCreate('virtue', 'levels', {
				id: message.author.id,
				guild: message.guild.id,
			}),
			this.getOrCreate('virtue', 'text', {
				id: message.author.id,
				guild: message.guild.id,
			}),
			this.getOrCreate('virtue', 'guilds', {
				id: message.guild.id,
			}),
			this.getOrCreate('virtue', 'users', {
				id: message.author.id,
			}),
		]);

		if (!user && !member && !text) return;

		const guild = rawGuild || { id: message.guild.id, mode: 'balanced', levelUp: true };

		const mode = guild.mode || 'balanced';
		const cooldown = cooldowns[mode as keyof typeof cooldowns] || cooldowns.balanced;

		const globalCooldown = cooldowns.balanced * 2;

		const globalKey = `${message.author.id}`;
		const guildKey = `${message.guild.id}:${message.author.id}`;

		const memberRoles = message.member?.roles?.cache;
		const isIgnored = Array.isArray(guild.roles?.ignored) && guild.roles.ignored.length > 0 && memberRoles?.some((r: any) => guild.roles.ignored.includes(r.id));
		const isUntracked = Array.isArray(guild.roles?.tracked) && guild.roles.tracked.length > 0 && !memberRoles?.some((r: any) => guild.roles.tracked.includes(r.id));

		const bypassGlobal = this.hasCooldown(globalKey, globalCooldown, this.globalCooldowns);
		const bypassGuild = isIgnored || isUntracked || this.hasCooldown(guildKey, cooldown, this.guildCooldowns);

		const globalXpGain = calculateExperience('balanced');
		const guildXpGain = calculateExperience(mode);

		const ws = (this.client as any).websocket;

		// ===== GLOBAL =====
		let userLevel = user?.level ?? 0;
		let userXp = user?.xp ?? 0;

		if (user && !bypassGlobal) {
			userXp += globalXpGain;

			while (userXp >= calculateLevel('balanced', userLevel)) {
				userXp -= calculateLevel('balanced', userLevel);
				userLevel++;

				const profile = await ws.get('xernerx', 'users', { id: message.author.id }).catch(() => null);

				if (profile?.notifications?.virtue?.levelup?.discord) {
					message.author.send(`You went level up! You are now level ${userLevel}`).catch(() => null);
				}
			}
		}

		// ===== GUILD LEVEL (UNIFIED) & TEXT LEVEL =====
		const effectiveMember = member || text;
		let memberLevel = effectiveMember?.level ?? 0;
		let memberXp = effectiveMember?.xp ?? 0;

		let textLevel = text?.level ?? 0;
		let textXp = text?.xp ?? 0;
		const textMessages = (text?.messages ?? 0) + 1;

		const levelRoles: Array<{ level: number; roleId: string }> =
			Array.isArray(guild.levelRoles) && guild.levelRoles.length > 0 ? guild.levelRoles : Array.isArray(guild.roles?.levels) ? guild.roles.levels : [];

		if (!bypassGuild) {
			if (effectiveMember) memberXp += guildXpGain;
			if (text) textXp += guildXpGain;

			if (text) {
				while (textXp >= calculateLevel(mode, textLevel)) {
					textXp -= calculateLevel(mode, textLevel);
					textLevel++;
				}
			}

			if (effectiveMember) {
				while (memberXp >= calculateLevel(mode, memberLevel)) {
					memberXp -= calculateLevel(mode, memberLevel);
					memberLevel++;

					if (guild.levelUp) {
						const unlockedAtLevel = levelRoles.filter((lr) => Number(lr?.level) === memberLevel && lr?.roleId);
						const highestUnlocked = [...levelRoles].filter((lr) => Number(lr?.level) <= memberLevel && lr?.roleId).sort((a, b) => Number(b.level) - Number(a.level))[0];
						const roleMention = unlockedAtLevel.length > 0 ? unlockedAtLevel.map((lr) => `<@&${lr.roleId}>`).join(', ') : highestUnlocked ? `<@&${highestUnlocked.roleId}>` : '';

						const msg = (guild.levelMessage || '[@mention] reached level [@level] :tada:!')
							.replace(/\[@mention\]|\{user\}/gi, `${message.author}`)
							.replace(/\[@username\]/gi, message.author.globalName || message.author.username)
							.replace(/\[@nickname\]/gi, message.member?.nickname || message.author.globalName || message.author.username)
							.replace(/\[@level\]|\{level\}/gi, String(memberLevel))
							.replace(/\[@role\]|\{role\}/gi, roleMention)
							.replace(/\[@server\]/gi, message.guild.name);

						const m = guild.levelChannel
							? await message.client.channels
									.fetch(guild.levelChannel)
									.then((c: any) => c?.send(msg))
									.catch(() => null)
							: await message.reply(msg).catch(() => null);

						if (m && guild.autoDelete && !guild.levelChannel) setTimeout(() => m.delete().catch(() => true), guild.autoDelete * 1000);
					}
				}
			}
		}

		if (!isIgnored && !isUntracked && levelRoles.length > 0 && message.member?.roles) {
			const missingRoleIds = Array.from(
				new Set(
					levelRoles
						.filter((lr) => lr?.roleId && Number(lr.level) > 0 && Number(lr.level) <= memberLevel)
						.map((lr) => String(lr.roleId).trim())
						.filter((roleId) => roleId && !message.member.roles.cache.has(roleId))
				)
			);

			if (missingRoleIds.length > 0) {
				await message.member.roles.add(missingRoleIds).catch(() => null);
			}
		}

		const updates: Promise<any>[] = [];

		if (user) {
			updates.push(
				ws
					.update('xernerx', 'levels', {
						ownerId: message.author.id,
						level: userLevel,
						xp: userXp,
					})
					.catch((err: unknown) => {
						console.error('[WS] PATCH xernerx/levels failed:', (err as Error)?.message || err);
						return null;
					})
			);
		}

		if (member) {
			updates.push(
				ws
					.update('virtue', 'levels', {
						id: message.author.id,
						guild: message.guild.id,
						level: memberLevel,
						xp: memberXp,
					})
					.catch((err: unknown) => {
						console.error('[WS] PATCH virtue/levels failed:', (err as Error)?.message || err);
						return null;
					})
			);
		}

		if (text) {
			updates.push(
				ws
					.update('virtue', 'text', {
						id: message.author.id,
						guild: message.guild.id,
						level: textLevel,
						xp: textXp,
						messages: textMessages,
					})
					.catch((err: unknown) => {
						console.error('[WS] PATCH virtue/text failed:', (err as Error)?.message || err);
						return null;
					})
			);
		}

		await Promise.all(updates);
	}
}
