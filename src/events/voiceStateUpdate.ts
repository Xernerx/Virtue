/** @format */

import { EventBuilder } from '@xernerx/framework';
import type { VoiceState } from 'discord.js';
import { calculateExperience, calculateLevel } from '../lib/levels.js';

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

		let data = await ws.get(service, action, query).catch(() => null);

		if (!data) {
			data = await ws.create(service, action, query).catch(() => null);
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

		const [user, voice, guild] = await Promise.all([
			this.getOrCreate('xernerx', 'levels', {
				ownerId: userId,
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
		]);

		if (!user || !voice || !guild) return;

		const mode = guild.mode || 'balanced';
		const cooldown = cooldowns[mode as keyof typeof cooldowns] || cooldowns.balanced;
		const globalCooldown = cooldown * 2;

		const globalKey = `${userId}`;
		const guildKey = `${guildId}:${userId}`;

		const memberRoles = state.member.roles?.cache;
		const isIgnored = Array.isArray(guild.roles?.ignored) && guild.roles.ignored.length > 0 && memberRoles?.some((r: any) => guild.roles.ignored.includes(r.id));
		const isUntracked = Array.isArray(guild.roles?.tracked) && guild.roles.tracked.length > 0 && !memberRoles?.some((r: any) => guild.roles.tracked.includes(r.id));

		const bypassGlobal = this.hasCooldown(globalKey, globalCooldown, this.globalCooldowns);
		const bypassGuild = isIgnored || isUntracked || this.hasCooldown(guildKey, cooldown, this.guildCooldowns);

		const xpGain = calculateExperience(mode);
		const ws = (this.client as any).websocket;

		// ===== GLOBAL =====
		let userLevel = user.level ?? 0;
		let userXp = user.xp ?? 0;

		if (!bypassGlobal) {
			userXp += xpGain;

			while (userXp >= calculateLevel('balanced', userLevel)) {
				userXp -= calculateLevel('balanced', userLevel);
				userLevel++;

				const profile = await ws.get('xernerx', 'users', { id: userId }).catch(() => null);

				if (profile?.notifications?.virtue?.levelup?.discord) {
					state.member.user.send(`You went level up! You are now level ${userLevel}`).catch(() => null);
				}
			}
		}

		// ===== LOCAL VOICE =====
		let voiceLevel = voice.level ?? 0;
		let voiceXp = voice.xp ?? 0;
		const timeSpent = (voice.timeSpent ?? 0) + elapsedSeconds;

		const levelRoles: Array<{ level: number; roleId: string }> =
			Array.isArray(guild.levelRoles) && guild.levelRoles.length > 0 ? guild.levelRoles : Array.isArray(guild.roles?.levels) ? guild.roles.levels : [];

		if (!bypassGuild) {
			voiceXp += xpGain;

			while (voiceXp >= calculateLevel(mode, voiceLevel)) {
				voiceXp -= calculateLevel(mode, voiceLevel);
				voiceLevel++;

				if (guild.levelUp && guild.levelChannel) {
					const unlockedAtLevel = levelRoles.filter((lr) => Number(lr?.level) === voiceLevel && lr?.roleId);
					const highestUnlocked = [...levelRoles].filter((lr) => Number(lr?.level) <= voiceLevel && lr?.roleId).sort((a, b) => Number(b.level) - Number(a.level))[0];
					const roleMention = unlockedAtLevel.length > 0 ? unlockedAtLevel.map((lr) => `<@&${lr.roleId}>`).join(', ') : highestUnlocked ? `<@&${highestUnlocked.roleId}>` : '';

					const msg = (guild.levelMessage || '[@mention] reached level [@level] :tada:!')
						.replace(/\[@mention\]|\{user\}/gi, `${state.member.user}`)
						.replace(/\[@username\]/gi, state.member.user.globalName || state.member.user.username)
						.replace(/\[@nickname\]/gi, state.member.nickname || state.member.user.globalName || state.member.user.username)
						.replace(/\[@level\]|\{level\}/gi, String(voiceLevel))
						.replace(/\[@role\]|\{role\}/gi, roleMention)
						.replace(/\[@server\]/gi, state.guild.name);

					await this.client.channels
						.fetch(guild.levelChannel)
						.then((c: any) => c?.send(msg))
						.catch(() => null);
				}
			}
		}

		if (!isIgnored && !isUntracked && levelRoles.length > 0 && state.member.roles) {
			const missingRoleIds = Array.from(
				new Set(
					levelRoles
						.filter((lr) => lr?.roleId && Number(lr.level) > 0 && Number(lr.level) <= voiceLevel)
						.map((lr) => String(lr.roleId).trim())
						.filter((roleId) => roleId && !state.member!.roles.cache.has(roleId))
				)
			);

			if (missingRoleIds.length > 0) {
				await state.member.roles.add(missingRoleIds).catch(() => null);
			}
		}

		await Promise.all([
			ws
				.update('xernerx', 'levels', {
					ownerId: userId,
					level: userLevel,
					xp: userXp,
				})
				.catch(() => null),
			ws
				.update('virtue', 'voice', {
					id: userId,
					guild: guildId,
					level: voiceLevel,
					xp: voiceXp,
					timeSpent,
				})
				.catch(() => null),
		]);
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
