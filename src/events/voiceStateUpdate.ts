/** @format */

import { EventBuilder } from '@xernerx/framework';
import type { VoiceState } from 'discord.js';
import {
	calculateExperience,
	calculateLevel,
	calculateLevelUpCredits,
	extractGuildLevelRoles,
	getMemberServerMultiplier,
	isChannelFilteredOut,
	resolveGlobalXpMultiplier,
	syncMemberLevelRoles,
} from '../lib/levels.js';

const cooldowns = {
	easy: 30,
	casual: 45,
	balanced: 60,
	hard: 120,
	extreme: 300,
} as const;

interface VoiceSession {
	userId: string;
	guildId: string;
	channelId: string;
	lastSyncedAt: number;
}

export default class VoiceStateUpdateEvent extends EventBuilder {
	private sessions = new Map<string, VoiceSession>();
	private globalCooldowns = new Map<string, number>();
	private guildCooldowns = new Map<string, number>();
	private tickerStarted = false;

	constructor() {
		super('voiceStateUpdate', {
			name: 'voiceStateUpdate',
			emitter: 'client',
			once: false,
		});
	}

	private isEligible(state: VoiceState) {
		return Boolean(state?.channelId && state.guild && state.member && !state.member.user.bot && state.channelId !== state.guild.afkChannelId && !state.deaf && !state.selfDeaf);
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

	private startTicker() {
		if (this.tickerStarted) return;
		this.tickerStarted = true;

		setInterval(async () => {
			const now = Date.now();

			for (const [key, session] of this.sessions.entries()) {
				const guild = this.client.guilds.cache.get(session.guildId);
				const voiceState = guild?.voiceStates?.cache?.get(session.userId);

				if (!voiceState || !this.isEligible(voiceState)) {
					this.sessions.delete(key);
					continue;
				}

				const elapsed = Math.floor((now - session.lastSyncedAt) / 1000);
				if (elapsed < 30) continue;

				session.lastSyncedAt = now;
				await this.recordProgress(voiceState, elapsed);
			}
		}, 60000);
	}

	private async recordProgress(state: VoiceState, elapsedSeconds: number) {
		if (elapsedSeconds <= 0 || !state.guild || !state.member || state.member.user.bot) return;

		const userId = state.member.id;
		const guildId = state.guild.id;
		const ws = (this.client as any).websocket;

		const [user, member, voice, rawGuild, , globalXpState] = await Promise.all([
			this.getOrCreate('xernerx', 'levels', {
				ownerId: userId,
			}),
			this.getOrCreate('virtue', 'levels', {
				id: userId,
				guild: guildId,
			}),
			this.getOrCreate('virtue', 'voice', {
				id: userId,
				guild: guildId,
			}),
			this.getOrCreate('virtue', 'guilds', {
				id: guildId,
			}),
			this.getOrCreate('virtue', 'users', {
				id: userId,
			}),
			resolveGlobalXpMultiplier(ws),
		]);

		if (!user && !member && !voice) return;

		const guild = rawGuild || { id: guildId, mode: 'balanced', levelUp: true };

		const mode = guild.mode || 'balanced';
		const cooldown = cooldowns[mode as keyof typeof cooldowns] || cooldowns.balanced;
		const globalCooldown = cooldowns.balanced * 2;

		const globalKey = `${userId}`;
		const guildKey = `${guildId}:${userId}`;

		const memberRoles = state.member.roles?.cache;
		const isIgnored = Array.isArray(guild.roles?.ignored) && guild.roles.ignored.length > 0 && memberRoles?.some((r: any) => guild.roles.ignored.includes(r.id));
		const isUntracked = Array.isArray(guild.roles?.tracked) && guild.roles.tracked.length > 0 && !memberRoles?.some((r: any) => guild.roles.tracked.includes(r.id));
		const isChannelIgnored = isChannelFilteredOut(guild, state.channelId, state.channel?.parentId);

		const bypassGlobal = this.hasCooldown(globalKey, globalCooldown, this.globalCooldowns);
		const bypassGuild = isIgnored || isUntracked || isChannelIgnored || this.hasCooldown(guildKey, cooldown, this.guildCooldowns);

		const rawGlobalXpGain = calculateExperience('balanced');
		const rawGuildXpGain = calculateExperience(mode);
		const globalXpGain = globalXpState.active ? Math.max(1, Math.round(rawGlobalXpGain * globalXpState.multiplier)) : rawGlobalXpGain;
		const serverMultiplier = getMemberServerMultiplier(state.member, guild, globalXpState);
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

				const profile = await ws.get('xernerx', 'users', { id: userId }).catch(() => null);

				if (profile?.notifications?.virtue?.levelup?.discord) {
					state.member.user.send(`You went level up! You are now level ${userLevel} (+${globalCredits} credits)`).catch(() => null);
				}
			}
		}

		// ===== GUILD LEVEL (UNIFIED) & VOICE LEVEL =====
		const effectiveMember = member || voice;
		let memberLevel = effectiveMember?.level ?? 0;
		let memberXp = effectiveMember?.xp ?? 0;

		let voiceLevel = voice?.level ?? 0;
		let voiceXp = voice?.xp ?? 0;
		const timeSpent = (voice?.timeSpent ?? 0) + elapsedSeconds;

		const levelRoles = extractGuildLevelRoles(guild);

		if (!bypassGuild) {
			if (effectiveMember) memberXp += guildXpGain;
			if (voice) voiceXp += guildXpGain;

			if (voice) {
				while (voiceXp >= calculateLevel(mode, voiceLevel)) {
					voiceXp -= calculateLevel(mode, voiceLevel);
					voiceLevel++;
				}
			}

			if (effectiveMember) {
				while (memberXp >= calculateLevel(mode, memberLevel)) {
					memberXp -= calculateLevel(mode, memberLevel);
					memberLevel++;
					const serverCredits = Math.max(1, Math.round(calculateLevelUpCredits('server', memberLevel) * creditMultiplier));
					creditsEarned += serverCredits;

					if (guild.levelUp && guild.levelChannel) {
						const unlockedAtLevel = levelRoles.filter((lr) => lr?.roleId && ((lr.track === 'server' && Number(lr.level) === memberLevel) || (lr.track === 'voice' && Number(lr.level) === voiceLevel)));
						const highestUnlocked = [...levelRoles]
							.filter((lr) => lr?.roleId && ((lr.track === 'server' && Number(lr.level) <= memberLevel) || (lr.track === 'voice' && Number(lr.level) <= voiceLevel)))
							.sort((a, b) => Number(b.level) - Number(a.level))[0];
						const roleMention = unlockedAtLevel.length > 0 ? unlockedAtLevel.map((lr) => `<@&${lr.roleId}>`).join(', ') : highestUnlocked ? `<@&${highestUnlocked.roleId}>` : '';

						const msg = (guild.levelMessage || '[@mention] reached level [@level] :tada:!')
							.replace(/\[@mention\]|\{user\}/gi, `${state.member.user}`)
							.replace(/\[@username\]/gi, state.member.user.globalName || state.member.user.username)
							.replace(/\[@nickname\]/gi, state.member.nickname || state.member.user.globalName || state.member.user.username)
							.replace(/\[@level\]|\{level\}/gi, String(memberLevel))
							.replace(/\[@role\]|\{role\}/gi, roleMention)
							.replace(/\[@credits\]|\{credits\}/gi, String(serverCredits))
							.replace(/\[@server\]/gi, state.guild.name);

						await this.client.channels
							.fetch(guild.levelChannel)
							.then((c: any) => c?.send(msg))
							.catch(() => null);
					}
				}
			}
		}

		if (!isIgnored && !isUntracked && !isChannelIgnored && levelRoles.length > 0 && state.member.roles) {
			await syncMemberLevelRoles(
				state.member,
				guild,
				{
					server: memberLevel,
					voice: voiceLevel,
				},
				['server', 'voice']
			);
		}

		const updates: Promise<any>[] = [];

		if (creditsEarned > 0) {
			updates.push(
				(async () => {
					const creditDoc = await this.getOrCreate('xernerx', 'credits', {
						ownerId: userId,
					});
					const prevBalance = Number(creditDoc?.balance) || 0;
					return ws
						.update('xernerx', 'credits', {
							ownerId: userId,
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
						ownerId: userId,
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
						id: userId,
						guild: guildId,
						level: memberLevel,
						xp: memberXp,
					})
					.catch((err: unknown) => {
						console.error('[WS] PATCH virtue/levels failed:', (err as Error)?.message || err);
						return null;
					})
			);
		}

		if (voice) {
			updates.push(
				ws
					.update('virtue', 'voice', {
						id: userId,
						guild: guildId,
						level: voiceLevel,
						xp: voiceXp,
						timeSpent,
					})
					.catch((err: unknown) => {
						console.error('[WS] PATCH virtue/voice failed:', (err as Error)?.message || err);
						return null;
					})
			);
		}

		await Promise.all(updates);
	}

	override async run(oldState: VoiceState, newState: VoiceState) {
		this.startTicker();

		const state = newState?.guild ? newState : oldState;
		if (!state?.guild || !state.member || state.member.user.bot) return;

		const key = `${state.guild.id}:${state.member.id}`;
		const now = Date.now();
		const existing = this.sessions.get(key);
		const eligibleNow = this.isEligible(newState);

		if (existing && !eligibleNow) {
			this.sessions.delete(key);
			const elapsed = Math.floor((now - existing.lastSyncedAt) / 1000);
			if (elapsed > 0) {
				await this.recordProgress(oldState, elapsed);
			}
			return;
		}

		if (!existing && eligibleNow && newState.channelId) {
			this.sessions.set(key, {
				userId: state.member.id,
				guildId: state.guild.id,
				channelId: newState.channelId,
				lastSyncedAt: now,
			});
			return;
		}

		if (existing && eligibleNow && newState.channelId) {
			existing.channelId = newState.channelId;
		}
	}
}
