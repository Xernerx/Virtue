/** @format */

import { EventBuilder } from '@xernerx/framework';
import {
	calculateExperience,
	calculateLevel,
	calculateLevelUpCredits,
	checkUserServices,
	extractGuildLevelRoles,
	getMemberServerMultiplier,
	isChannelFilteredOut,
	isServicesDisabledDoc,
	markUserServicesCache,
	resolveGlobalXpMultiplier,
	resolveUnifiedServerProgress,
	syncMemberLevelRoles,
} from '../lib/levels.js';

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
		const isUserScoped = !(service === 'virtue' && action === 'guilds');
		const targetUserId = isUserScoped ? String(query?.ownerId || query?.id || '') : '';

		let getFailed = false;
		let data = await ws.get(service, action, query).catch((err: unknown) => {
			getFailed = true;
			console.error(`[WS] GET ${service}/${action} failed:`, (err as Error)?.message || err);
			return null;
		});

		if (isUserScoped && isServicesDisabledDoc(data)) {
			if (targetUserId) {
				markUserServicesCache(targetUserId, {
					services: data.services !== false && !data.servicesDisabled,
					blacklisted: Boolean(data.blacklisted),
				});
			}
			return null;
		}

		if (!data) {
			data = await ws.create(service, action, query).catch((err: unknown) => {
				console.error(`[WS] POST ${service}/${action} failed:`, (err as Error)?.message || err);
				return null;
			});
		}

		if (isUserScoped && isServicesDisabledDoc(data)) {
			if (targetUserId) {
				markUserServicesCache(targetUserId, {
					services: data.services !== false && !data.servicesDisabled,
					blacklisted: Boolean(data.blacklisted),
				});
			}
			return null;
		}

		if (!data && !getFailed) {
			data = await ws.update(service, action, query).catch(() => null);
		}

		if (isUserScoped && isServicesDisabledDoc(data)) {
			if (targetUserId) {
				markUserServicesCache(targetUserId, {
					services: data.services !== false && !data.servicesDisabled,
					blacklisted: Boolean(data.blacklisted),
				});
			}
			return null;
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

		const ws = (this.client as any).websocket;

		const serviceCheck = await checkUserServices(ws, message.author.id, message.user || message.author);
		if (!serviceCheck.allowed) return;

		const [user, member, text, rawGuild, virtueUser, globalXpState] = await Promise.all([
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
			resolveGlobalXpMultiplier(ws),
		]);

		if (isServicesDisabledDoc(user) || isServicesDisabledDoc(member) || isServicesDisabledDoc(text) || isServicesDisabledDoc(virtueUser)) return;
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
		const isChannelIgnored = isChannelFilteredOut(guild, message.channel?.id, message.channel?.parentId);

		const bypassGlobal = this.hasCooldown(globalKey, globalCooldown, this.globalCooldowns);
		const bypassGuild = isIgnored || isUntracked || isChannelIgnored || this.hasCooldown(guildKey, cooldown, this.guildCooldowns);

		const rawGlobalXpGain = calculateExperience('balanced');
		const rawGuildXpGain = calculateExperience(mode);
		const globalXpGain = globalXpState.active ? Math.max(1, Math.round(rawGlobalXpGain * globalXpState.multiplier)) : rawGlobalXpGain;
		const serverMultiplier = getMemberServerMultiplier(message.member, guild, globalXpState);
		const guildXpGain = Math.max(1, Math.round(rawGuildXpGain * serverMultiplier));
		const creditMultiplier = globalXpState.active && globalXpState.scope === 'everything' ? globalXpState.multiplier : 1;

		// ===== GLOBAL =====
		let userLevel = user?.level ?? 0;
		let userXp = user?.xp ?? 0;
		let creditsEarned = 0;

		if (user && !bypassGlobal) {
			userXp += globalXpGain;

			while (userXp >= calculateLevel('balanced', userLevel)) {
				userXp -= calculateLevel('balanced', userLevel);
				userLevel++;
				const globalCredits = Math.max(1, Math.round(calculateLevelUpCredits('global', userLevel) * creditMultiplier));
				creditsEarned += globalCredits;

				const profile = serviceCheck.userDoc || (await ws.get('xernerx', 'users', { id: message.author.id }).catch(() => null));
				if (isServicesDisabledDoc(profile)) return;

				if (profile?.notifications?.virtue?.levelup?.discord) {
					message.author.send(`You went level up! You are now level ${userLevel} (+${globalCredits} credits)`).catch(() => null);
				}
			}
		}

		// ===== GUILD LEVEL (UNIFIED) & TEXT LEVEL =====
		const effectiveMember = member || text;
		const resolvedServer = resolveUnifiedServerProgress(member, text);
		let memberLevel = resolvedServer.level;
		let memberXp = resolvedServer.xp;

		let textLevel = text?.level ?? 0;
		let textXp = text?.xp ?? 0;
		const textMessages = (text?.messages ?? 0) + 1;

		const levelRoles = extractGuildLevelRoles(guild);

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
					const serverCredits = Math.max(1, Math.round(calculateLevelUpCredits('server', memberLevel) * creditMultiplier));
					creditsEarned += serverCredits;

					if (guild.levelUp) {
						const unlockedAtLevel = levelRoles.filter((lr) => lr?.roleId && ((lr.track === 'server' && Number(lr.level) === memberLevel) || (lr.track === 'text' && Number(lr.level) === textLevel)));
						const highestUnlocked = [...levelRoles]
							.filter((lr) => lr?.roleId && ((lr.track === 'server' && Number(lr.level) <= memberLevel) || (lr.track === 'text' && Number(lr.level) <= textLevel)))
							.sort((a, b) => Number(b.level) - Number(a.level))[0];
						const roleMention = unlockedAtLevel.length > 0 ? unlockedAtLevel.map((lr) => `<@&${lr.roleId}>`).join(', ') : highestUnlocked ? `<@&${highestUnlocked.roleId}>` : '';

						const msg = (guild.levelMessage || '[@mention] reached level [@level] :tada:!')
							.replace(/\[@mention\]|\{user\}/gi, `${message.author}`)
							.replace(/\[@username\]/gi, message.author.globalName || message.author.username)
							.replace(/\[@nickname\]/gi, message.member?.nickname || message.author.globalName || message.author.username)
							.replace(/\[@level\]|\{level\}/gi, String(memberLevel))
							.replace(/\[@role\]|\{role\}/gi, roleMention)
							.replace(/\[@credits\]|\{credits\}/gi, String(serverCredits))
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

		if (!isIgnored && !isUntracked && !isChannelIgnored && levelRoles.length > 0 && message.member?.roles) {
			await syncMemberLevelRoles(
				message.member,
				guild,
				{
					server: memberLevel,
					text: textLevel,
				},
				['server', 'text']
			);
		}

		const updates: Promise<any>[] = [];

		if (creditsEarned > 0) {
			updates.push(
				(async () => {
					const creditDoc = await this.getOrCreate('xernerx', 'credits', {
						ownerId: message.author.id,
					});
					if (!creditDoc || isServicesDisabledDoc(creditDoc)) return null;
					const prevBalance = Number(creditDoc?.balance) || 0;
					return ws
						.update('xernerx', 'credits', {
							ownerId: message.author.id,
							balance: prevBalance + creditsEarned,
						})
						.catch((err: unknown) => {
							console.error('[WS] PATCH xernerx/credits failed:', (err as Error)?.message || err);
							return null;
						});
				})()
			);
		}

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
