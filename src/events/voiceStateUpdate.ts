/** @format */

import { EventBuilder, XernerxUser } from '@xernerx/framework';
import type { VoiceState } from 'discord.js';
import {
	calculateExperience,
	calculateLevel,
	calculateLevelUpCredits,
	checkGuildPremium,
	checkUserServices,
	extractGuildLevelRoles,
	getMemberServerMultiplier,
	isChannelFilteredOut,
	isServicesDisabledDoc,
	markUserServicesCache,
	resolveGlobalXpMultiplier,
	resolveUnifiedServerProgress,
	syncMemberLevelRoles,
	VOICE_STREAMING_XP_MULTIPLIER,
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

	private isMemberEligible(state: VoiceState) {
		return Boolean(state?.channelId && state.guild && state.member && !state.member.user.bot && state.channelId !== state.guild.afkChannelId && !state.deaf && !state.selfDeaf);
	}

	private getEligibleChannelMemberCount(state: VoiceState) {
		if (!state?.channelId || !state.guild) return 0;

		let count = 0;
		for (const [, voiceState] of state.guild.voiceStates.cache) {
			if (voiceState.channelId === state.channelId && this.isMemberEligible(voiceState)) {
				count++;
			}
		}

		return count;
	}

	private isEligible(state: VoiceState) {
		return this.isMemberEligible(state) && this.getEligibleChannelMemberCount(state) >= 2;
	}

	private async syncChannelPeers(guild: VoiceState['guild'], channelId: string | null, excludeUserId: string, now: number) {
		if (!guild || !channelId || channelId === guild.afkChannelId) return;

		const ws = (this.client as any).websocket;

		for (const [, peerState] of guild.voiceStates.cache) {
			if (peerState.channelId !== channelId || !peerState.member || peerState.member.user.bot || peerState.member.id === excludeUserId) {
				continue;
			}

			const peerId = peerState.member.id;
			const peerKey = `${guild.id}:${peerId}`;
			const existingPeer = this.sessions.get(peerKey);
			const peerEligible = this.isEligible(peerState);

			if (existingPeer && !peerEligible) {
				this.sessions.delete(peerKey);
				const elapsed = Math.floor((now - existingPeer.lastSyncedAt) / 1000);
				if (elapsed > 0) {
					await this.recordProgress(peerState, elapsed);
				}
				continue;
			}

			if (!existingPeer && peerEligible && peerState.channelId) {
				const peerXUser = new XernerxUser(this.client as any, peerState.member.user);
				const peerServiceCheck = await checkUserServices(ws, peerId, peerXUser);
				if (!peerServiceCheck.allowed) continue;

				this.sessions.set(peerKey, {
					userId: peerId,
					guildId: guild.id,
					channelId: peerState.channelId,
					lastSyncedAt: now,
				});
			}
		}
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
		const xUser = new XernerxUser(this.client as any, state.member.user);

		const serviceCheck = await checkUserServices(ws, userId, xUser);
		if (!serviceCheck.allowed) {
			this.sessions.delete(`${guildId}:${userId}`);
			return;
		}

		const [user, member, voice, text, rawGuild, virtueUser, globalXpState, isGuildPremium] = await Promise.all([
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
			ws.get('virtue', 'text', { id: userId, guild: guildId }).catch(() => null),
			this.getOrCreate('virtue', 'guilds', {
				id: guildId,
			}),
			this.getOrCreate('virtue', 'users', {
				id: userId,
			}),
			resolveGlobalXpMultiplier(ws),
			checkGuildPremium(state.guild),
		]);

		if (isServicesDisabledDoc(user) || isServicesDisabledDoc(member) || isServicesDisabledDoc(voice) || isServicesDisabledDoc(virtueUser)) {
			this.sessions.delete(`${guildId}:${userId}`);
			return;
		}
		if (!user && !member && !voice) return;

		const guild = rawGuild || { id: guildId, mode: 'balanced', levelUp: true };

		const mode = isGuildPremium ? guild.mode || 'balanced' : 'balanced';
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
		const passMultiplier = serviceCheck.xpMultiplier || 1;
		const streamingMultiplier = state.streaming ? VOICE_STREAMING_XP_MULTIPLIER : 1;
		const userVoiceMultiplier = passMultiplier * streamingMultiplier;
		const globalMult = (globalXpState.active ? globalXpState.multiplier : 1) * userVoiceMultiplier;
		const globalXpGain = Math.max(1, Math.round(rawGlobalXpGain * globalMult));
		const serverMultiplier = getMemberServerMultiplier(state.member, guild, globalXpState, isGuildPremium) * userVoiceMultiplier;
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

				const profile = serviceCheck.userDoc || (await ws.get('xernerx', 'users', { id: userId }).catch(() => null));
				if (isServicesDisabledDoc(profile)) return;

				if (profile?.notifications?.virtue?.levelup?.discord) {
					state.member.user.send(`You went level up! You are now level ${userLevel} (+${globalCredits} credits)`).catch(() => null);
				}
			}
		}

		// ===== GUILD LEVEL (UNIFIED) & VOICE LEVEL =====
		const effectiveMember = member || voice;
		const resolvedServer = resolveUnifiedServerProgress(member, text, voice);
		let memberLevel = resolvedServer.level;
		let memberXp = resolvedServer.xp;

		let voiceLevel = voice?.level ?? 0;
		let voiceXp = voice?.xp ?? 0;
		const textLevel = isServicesDisabledDoc(text) ? 0 : (text?.level ?? 0);
		const timeSpent = (voice?.timeSpent ?? 0) + elapsedSeconds;

		const levelRoles = extractGuildLevelRoles(guild);
		const hasDynamicRoles = Boolean(guild?.dynamicRoles?.enabled && guild?.dynamicRoles?.anchorRoleId);
		const leveledUpSteps: Array<{ level: number; credits: number }> = [];

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
					leveledUpSteps.push({ level: memberLevel, credits: serverCredits });
				}
			}
		}

		if (!isIgnored && !isUntracked && !isChannelIgnored && (levelRoles.length > 0 || hasDynamicRoles) && state.member.roles) {
			await syncMemberLevelRoles(
				state.member,
				guild,
				{
					server: memberLevel,
					text: textLevel,
					voice: voiceLevel,
				},
				['server', 'text', 'voice'],
				{ ws, isGuildPremium }
			);
		}

		if (leveledUpSteps.length > 0 && guild.levelUp && guild.levelChannel) {
			const activeLevelRoles = extractGuildLevelRoles(guild);
			for (const step of leveledUpSteps) {
				const unlockedAtLevel = activeLevelRoles.filter(
					(lr) => lr?.roleId && ((lr.track === 'server' && Number(lr.level) === step.level) || (lr.track === 'voice' && Number(lr.level) === voiceLevel))
				);
				const highestUnlocked = [...activeLevelRoles]
					.filter((lr) => lr?.roleId && ((lr.track === 'server' && Number(lr.level) <= step.level) || (lr.track === 'voice' && Number(lr.level) <= voiceLevel)))
					.sort((a, b) => Number(b.level) - Number(a.level))[0];
				const roleMention = unlockedAtLevel.length > 0 ? unlockedAtLevel.map((lr) => `<@&${lr.roleId}>`).join(', ') : highestUnlocked ? `<@&${highestUnlocked.roleId}>` : '';

				const msg = (guild.levelMessage || '[@mention] reached level [@level] :tada:!')
					.replace(/\[@mention\]|\{user\}/gi, `${state.member.user}`)
					.replace(/\[@username\]/gi, state.member.user.globalName || state.member.user.username)
					.replace(/\[@nickname\]/gi, state.member.nickname || state.member.user.globalName || state.member.user.username)
					.replace(/\[@level\]|\{level\}/gi, String(step.level))
					.replace(/\[@role\]|\{role\}/gi, roleMention)
					.replace(/\[@credits\]|\{credits\}/gi, String(step.credits))
					.replace(/\[@server\]/gi, state.guild.name);

				await this.client.channels
					.fetch(guild.levelChannel)
					.then((c: any) => c?.send(msg))
					.catch(() => null);
			}
		}

		const updates: Promise<any>[] = [];

		if (creditsEarned > 0) {
			updates.push(
				(async () => {
					const creditDoc = await this.getOrCreate('xernerx', 'credits', {
						ownerId: userId,
					});
					if (!creditDoc || isServicesDisabledDoc(creditDoc)) return null;
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

		const now = Date.now();
		const key = `${state.guild.id}:${state.member.id}`;
		const ws = (this.client as any).websocket;
		const xUser = new XernerxUser(this.client as any, state.member.user);
		const serviceCheck = await checkUserServices(ws, state.member.id, xUser);

		if (!serviceCheck.allowed) {
			this.sessions.delete(key);
		} else {
			const existing = this.sessions.get(key);
			const eligibleNow = this.isEligible(newState);

			if (existing && !eligibleNow) {
				this.sessions.delete(key);
				const elapsed = Math.floor((now - existing.lastSyncedAt) / 1000);
				if (elapsed > 0) {
					await this.recordProgress(oldState, elapsed);
				}
			} else if (!existing && eligibleNow && newState.channelId) {
				this.sessions.set(key, {
					userId: state.member.id,
					guildId: state.guild.id,
					channelId: newState.channelId,
					lastSyncedAt: now,
				});
			} else if (existing && eligibleNow && newState.channelId) {
				const channelChanged = Boolean(oldState.channelId && oldState.channelId !== newState.channelId);
				const streamingToggled = Boolean(oldState.streaming) !== Boolean(newState.streaming);
				if (channelChanged || streamingToggled) {
					const elapsed = Math.floor((now - existing.lastSyncedAt) / 1000);
					existing.channelId = newState.channelId;
					existing.lastSyncedAt = now;
					if (elapsed > 0) {
						await this.recordProgress(oldState, elapsed);
					}
				} else {
					existing.channelId = newState.channelId;
				}
			}
		}

		if (oldState.channelId) {
			await this.syncChannelPeers(state.guild, oldState.channelId, state.member.id, now);
		}
		if (newState.channelId && newState.channelId !== oldState.channelId) {
			await this.syncChannelPeers(state.guild, newState.channelId, state.member.id, now);
		}
	}
}
