/** @format */

import { EmbedBuilder, GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel, GuildScheduledEventStatus } from 'discord.js';
import { pruneDynamicRolesOnCycleReset } from './dynamicRoles.js';
import { DEFAULT_XERNERX_COLOR } from './levelCard.js';
import { checkGuildPremium } from './levels.js';

function getIsoWeekKey(date: Date): string {
	const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function getCyclePeriodKeys(now = new Date()) {
	const yyyy = now.getUTCFullYear();
	const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
	const dd = String(now.getUTCDate()).padStart(2, '0');

	return {
		daily: `${yyyy}-${mm}-${dd}`,
		weekly: getIsoWeekKey(now),
		monthly: `${yyyy}-${mm}`,
	};
}

function unwrapEntries(raw: any): any[] {
	if (Array.isArray(raw)) return raw;
	if (Array.isArray(raw?.entries)) return raw.entries;
	if (raw && typeof raw === 'object') {
		if (raw.id || raw.ownerId) return [raw];
		return Object.values(raw);
	}
	return [];
}

let lastCycleCheckMs = 0;
let lastSyncedEventSignature = '';

async function syncGlobalXpScheduledEvent(client: any) {
	const ws = client?.websocket;
	if (!ws || !client?.guilds?.cache) return;

	try {
		const [globalGuildDoc, settingDoc, adminServerDoc] = await Promise.all([
			ws.get('virtue', 'guilds', { id: '__global__' }).catch(() => null),
			ws.get('xernerx', 'settings', { id: 'virtue_global_xp' }).catch(() => null),
			ws.get('xernerx', 'settings', { id: 'admin_server_id' }).catch(() => null),
		]);

		const rawVal = settingDoc?.value ?? globalGuildDoc?.levelMessage;
		if (!rawVal) return;

		const parsed = typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal;
		if (!parsed || typeof parsed !== 'object') return;

		if (globalGuildDoc?.levelMessage && typeof globalGuildDoc.levelMessage === 'string' && globalGuildDoc.levelMessage.trim().startsWith('{')) {
			try {
				const fallbackParsed = JSON.parse(globalGuildDoc.levelMessage);
				if (!parsed.discordEventId && fallbackParsed?.discordEventId) {
					parsed.discordEventId = fallbackParsed.discordEventId;
				}
				if (!parsed.targetGuildId && fallbackParsed?.targetGuildId) {
					parsed.targetGuildId = fallbackParsed.targetGuildId;
				}
				if (!parsed.discordEventGuildId && fallbackParsed?.discordEventGuildId) {
					parsed.discordEventGuildId = fallbackParsed.discordEventGuildId;
				}
			} catch {}
		}

		const canonicalTargetGuildId = String(parsed.targetGuildId || adminServerDoc?.value || parsed.discordEventGuildId || '').trim();
		if (!canonicalTargetGuildId) return;

		// Never fall back to client.guilds.cache.first() — if this bot instance (e.g. Virtue Beta) is not in the target server,
		// falling back to another server creates an event in the wrong guild and causes both bots to ping-pong duplicate events.
		const discordGuild = client.guilds.cache.get(canonicalTargetGuildId);
		if (!discordGuild?.scheduledEvents) return;

		const now = Date.now();
		const expMs = parsed.expiresAt ? new Date(parsed.expiresAt).getTime() : NaN;
		const isAlreadyExpired = !Number.isNaN(expMs) && expMs <= now;
		const syncDiscordEvent = parsed.syncDiscordEvent !== false;

		const isMatchingXpEvent = (ev: any, targetName?: string) => {
			if (!ev) return false;
			if (ev.entityMetadata?.location === 'https://app.xernerx.com/leaderboard') return true;
			if (targetName && ev.name === targetName) return true;
			return typeof ev.name === 'string' && ev.name.startsWith('⚡ ') && ev.name.includes('XP)');
		};

		if (!parsed.enabled || !syncDiscordEvent || isAlreadyExpired) {
			const allEvents = await discordGuild.scheduledEvents.fetch().catch(() => null);
			if (allEvents) {
				for (const [, ev] of allEvents) {
					if (ev.id === parsed.discordEventId || isMatchingXpEvent(ev)) {
						await discordGuild.scheduledEvents.delete(ev.id).catch(() => null);
					}
				}
			} else if (parsed.discordEventId) {
				await discordGuild.scheduledEvents.delete(parsed.discordEventId).catch(() => null);
			}

			if (parsed.discordEventId || parsed.discordEventGuildId) {
				parsed.discordEventId = null;
				parsed.discordEventGuildId = null;
				const nextRaw = JSON.stringify(parsed);
				await Promise.all([
					ws.update('virtue', 'guilds', { id: '__global__', levelMessage: nextRaw, xpMultiplier: 1 }).catch(() => null),
					ws.update('xernerx', 'settings', { id: 'virtue_global_xp', value: nextRaw }).catch(() => null),
				]);
			}
			return;
		}

		const rawStartMs = parsed.startsAt ? new Date(parsed.startsAt).getTime() : NaN;
		const isImmediate = Number.isNaN(rawStartMs) || rawStartMs <= now + 30_000;
		const scheduledStartMs = isImmediate ? now + 60_000 : rawStartMs;
		const scheduledEndMs = !Number.isNaN(expMs) && expMs > scheduledStartMs + 60_000 ? expMs : scheduledStartMs + 24 * 3600 * 1000;
		const mult = Math.min(10, Math.max(1, Number(parsed.multiplier) || 2));
		const scopeDesc = parsed.scope === 'everything' ? 'all Virtue servers, Global XP, and Level-Up Credits' : parsed.scope === 'global_only' ? 'Global Xernerx XP' : 'Global XP & all Virtue servers';

		const eventName = `⚡ ${parsed.label || 'Double XP Event'} (${mult}x XP)`.slice(0, 100);
		const eventDesc = `Earn ${mult}x XP across ${scopeDesc}! Chat or hang out in voice channels to level up faster.`;
		const sig = `${discordGuild.id}:${parsed.discordEventId || 'none'}:${eventName}:${parsed.startsAt || 'now'}:${parsed.expiresAt || 'none'}:${isImmediate ? 'active' : 'sched'}`;
		if (sig === lastSyncedEventSignature && parsed.discordEventId) return;

		let eventId: string | null = parsed.discordEventId || null;
		let existing: any = null;

		const allEvents = await discordGuild.scheduledEvents.fetch().catch(() => null);
		if (allEvents) {
			const matchingEvents = (Array.from(allEvents.values()) as any[])
				.filter((ev: any) => ev.id === eventId || isMatchingXpEvent(ev, eventName))
				.sort((a: any, b: any) => (a.createdTimestamp || 0) - (b.createdTimestamp || 0));

			if (eventId && allEvents.has(eventId)) {
				existing = allEvents.get(eventId);
			} else if (matchingEvents.length > 0) {
				existing = matchingEvents[0];
				eventId = existing.id;
			}

			// Prune any duplicate XP events in the guild
			for (const dup of matchingEvents) {
				if (existing && dup.id !== existing.id) {
					await discordGuild.scheduledEvents.delete(dup.id).catch(() => null);
				}
			}
		} else if (eventId) {
			existing = await discordGuild.scheduledEvents.fetch(eventId).catch(() => null);
			if (!existing) {
				eventId = null;
			}
		}

		if (existing) {
			const existingEndMs = existing.scheduledEndTimestamp ?? (existing.scheduledEndTime ? new Date(existing.scheduledEndTime).getTime() : 0);
			const endChanged = Math.abs(existingEndMs - scheduledEndMs) > 10_000;
			const statusNeedsActive = existing.status === GuildScheduledEventStatus.Scheduled && isImmediate;
			const nameOrDescChanged = existing.name !== eventName || existing.description !== eventDesc;

			if (nameOrDescChanged || endChanged || statusNeedsActive) {
				await existing
					.edit({
						name: eventName,
						description: eventDesc,
						scheduledEndTime: new Date(scheduledEndMs),
						...(existing.status === GuildScheduledEventStatus.Scheduled && !isImmediate ? { scheduledStartTime: new Date(scheduledStartMs) } : {}),
						...(statusNeedsActive ? { status: GuildScheduledEventStatus.Active } : {}),
					})
					.catch(() => null);
			}
		}

		if (!eventId) {
			const created = await discordGuild.scheduledEvents
				.create({
					name: eventName,
					description: eventDesc,
					scheduledStartTime: new Date(scheduledStartMs),
					scheduledEndTime: new Date(scheduledEndMs),
					privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
					entityType: GuildScheduledEventEntityType.External,
					entityMetadata: { location: 'https://app.xernerx.com/leaderboard' },
				})
				.catch(() => null);

			if (created) {
				eventId = created.id;
				if (isImmediate) {
					await created.setStatus(GuildScheduledEventStatus.Active).catch(() => null);
				}
			}
		}

		if (eventId && (eventId !== parsed.discordEventId || discordGuild.id !== parsed.discordEventGuildId || canonicalTargetGuildId !== parsed.targetGuildId)) {
			parsed.discordEventId = eventId;
			parsed.discordEventGuildId = discordGuild.id;
			parsed.targetGuildId = canonicalTargetGuildId;
			const nextRaw = JSON.stringify(parsed);
			await Promise.all([
				ws.update('virtue', 'guilds', { id: '__global__', levelMessage: nextRaw, xpMultiplier: mult }).catch(() => null),
				ws.update('xernerx', 'settings', { id: 'virtue_global_xp', value: nextRaw }).catch(() => null),
			]);
		}

		lastSyncedEventSignature = `${discordGuild.id}:${eventId || 'none'}:${eventName}:${parsed.startsAt || 'now'}:${parsed.expiresAt || 'none'}:${isImmediate ? 'active' : 'sched'}`;
	} catch {}
}

export async function runCycleChecks(client: any) {
	await syncGlobalXpScheduledEvent(client);

	const nowMs = Date.now();
	if (nowMs - lastCycleCheckMs < 15 * 60 * 1000) return;
	lastCycleCheckMs = nowMs;

	const ws = client?.websocket;
	if (!ws || !client?.guilds?.cache) return;

	const keys = getCyclePeriodKeys(new Date());

	for (const [guildId, discordGuild] of client.guilds.cache) {
		try {
			const guildDoc = await ws.get('virtue', 'guilds', { id: guildId }).catch(() => null);
			if (!guildDoc?.cycles) continue;

			const { daily, weekly, monthly } = guildDoc.cycles;
			if (!daily && !weekly && !monthly) continue;

			const isGuildPremium = await checkGuildPremium(discordGuild);
			if (!isGuildPremium) continue;

			const prevState = guildDoc.cycleState || {};
			const nextState = {
				lastDailyReset: prevState.lastDailyReset || null,
				lastWeeklyReset: prevState.lastWeeklyReset || null,
				lastMonthlyReset: prevState.lastMonthlyReset || null,
			};

			const triggered: Array<'Daily' | 'Weekly' | 'Monthly'> = [];
			let stateChanged = false;

			if (daily) {
				if (!nextState.lastDailyReset) {
					nextState.lastDailyReset = keys.daily;
					stateChanged = true;
				} else if (nextState.lastDailyReset !== keys.daily) {
					nextState.lastDailyReset = keys.daily;
					triggered.push('Daily');
					stateChanged = true;
				}
			}

			if (weekly) {
				if (!nextState.lastWeeklyReset) {
					nextState.lastWeeklyReset = keys.weekly;
					stateChanged = true;
				} else if (nextState.lastWeeklyReset !== keys.weekly) {
					nextState.lastWeeklyReset = keys.weekly;
					triggered.push('Weekly');
					stateChanged = true;
				}
			}

			if (monthly) {
				if (!nextState.lastMonthlyReset) {
					nextState.lastMonthlyReset = keys.monthly;
					stateChanged = true;
				} else if (nextState.lastMonthlyReset !== keys.monthly) {
					nextState.lastMonthlyReset = keys.monthly;
					triggered.push('Monthly');
					stateChanged = true;
				}
			}

			if (!stateChanged) continue;

			if (triggered.length > 0) {
				const rawTop = await ws.get('virtue', 'levels', { guild: guildId, limit: 100 }).catch(() => []);
				const sorted = unwrapEntries(rawTop)
					.filter((doc) => doc && typeof doc === 'object' && doc.id && (Number(doc.level) > 0 || Number(doc.xp) > 0))
					.sort((a, b) => Number(b.level || 0) - Number(a.level || 0) || Number(b.xp || 0) - Number(a.xp || 0));

				const topThree = sorted.slice(0, 3);

				const bulkRes = await ws.update('virtue', 'levels', { guild: guildId, resetGuild: true }).catch(() => null);
				await ws.update('virtue', 'text', { guild: guildId, resetGuild: true }).catch(() => null);
				await ws.update('virtue', 'voice', { guild: guildId, resetGuild: true }).catch(() => null);
				await pruneDynamicRolesOnCycleReset(discordGuild, guildDoc, ws).catch(() => null);

				if (!bulkRes?.success && sorted.length > 0) {
					await Promise.all(
						sorted.map((doc) =>
							Promise.all([
								ws.update('virtue', 'levels', { id: doc.id, guild: guildId, level: 0, xp: 0 }).catch(() => null),
								ws.update('virtue', 'text', { id: doc.id, guild: guildId, level: 0, xp: 0, messages: 0 }).catch(() => null),
								ws.update('virtue', 'voice', { id: doc.id, guild: guildId, level: 0, xp: 0, timeSpent: 0 }).catch(() => null),
							])
						)
					);
				}

				if (guildDoc.levelUp !== false && guildDoc.levelChannel && topThree.length > 0) {
					const medals = ['🥇', '🥈', '🥉'];
					const lines = topThree.map((doc, i) => `${medals[i] || `#${i + 1}`} <@${doc.id}> — **Level ${doc.level || 0}** (${Number(doc.xp || 0).toLocaleString()} XP)`);
					const cycleLabel = triggered.join(' & ');
					const botUser = client.user;
					const botAvatar = botUser?.displayAvatarURL();

					const embed = new EmbedBuilder()
						.setColor(DEFAULT_XERNERX_COLOR)
						.setAuthor({
							name: `${discordGuild.name} • ${cycleLabel} Cycle Reset`,
							...(discordGuild.iconURL() ? { iconURL: discordGuild.iconURL()! } : {}),
						})
						.setDescription(`The **${cycleLabel} Level Cycle** has concluded and server progression has been reset for the new cycle!\n\n**Top Standings:**\n${lines.join('\n')}`)
						.setFooter({
							text: `${botUser?.username || 'Virtue'}`,
							...(botAvatar ? { iconURL: botAvatar } : {}),
						})
						.setTimestamp();

					await client.channels
						.fetch(guildDoc.levelChannel)
						.then((ch: any) => ch?.send({ embeds: [embed] }))
						.catch(() => null);
				}
			}

			await ws
				.update('virtue', 'guilds', {
					id: guildId,
					cycleState: nextState,
				})
				.catch(() => null);
		} catch {}
	}
}
