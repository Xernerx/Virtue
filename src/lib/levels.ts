/** @format */

const factors = {
	easy: { a: 1, b: 20 },
	casual: { a: 3, b: 40 },
	balanced: { a: 5, b: 50 },
	hard: { a: 8, b: 60 },
	extreme: { a: 12, b: 100 },
};

const ranges = {
	easy: { min: 15, max: 25 },
	casual: { min: 10, max: 18 },
	balanced: { min: 7, max: 13 },
	hard: { min: 5, max: 10 },
	extreme: { min: 3, max: 7 },
};

export function calculateLevel(factor: keyof typeof factors, level: number) {
	const { a, b } = factors[factor];
	return a * (level + 1) * (level + 1) + b * (level + 1);
}

export function calculateExperience(range: keyof typeof ranges) {
	const { min, max } = ranges[range];
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Calculates credit rewards for reaching `newLevel` on either the unified Server track or Global track.
 * Uses square-root progression with hard caps so high levels feel rewarding without runaway inflation.
 * - Server Level 1: 3–5 credits -> Level 200+: capped at 13–22 credits
 * - Global Level 1: 5–25 credits -> Level 200+: capped at 30–80 credits
 */
export function calculateLevelUpCredits(scope: 'server' | 'global', newLevel: number): number {
	const lvl = Math.max(1, Math.floor(Number(newLevel) || 1));
	const root = Math.sqrt(lvl - 1);
	const isMilestone = lvl % 10 === 0;

	if (scope === 'global') {
		const min = 5 + Math.min(25, Math.floor(root * 1.5));
		const max = 25 + Math.min(50, Math.floor(root * 3.2));
		const roll = Math.floor(Math.random() * (max - min + 1)) + min;
		return Math.min(80, roll + (isMilestone ? 5 : 0));
	}

	const min = 3 + Math.min(10, Math.floor(root * 0.6));
	const max = 5 + Math.min(15, Math.floor(root * 1.0));
	const roll = Math.floor(Math.random() * (max - min + 1)) + min;
	return Math.min(22, roll + (isMilestone ? 2 : 0));
}

export type LevelRoleTrack = 'server' | 'text' | 'voice';

export interface GuildLevelRoleEntry {
	level: number;
	roleId: string;
	track: LevelRoleTrack;
}

export function normalizeRoleTrack(rawTrack?: string | null): LevelRoleTrack {
	const t = String(rawTrack || '')
		.trim()
		.toLowerCase();
	if (t === 'text') return 'text';
	if (t === 'voice') return 'voice';
	return 'server';
}

export function extractGuildLevelRoles(guild: any): GuildLevelRoleEntry[] {
	if (!guild || typeof guild !== 'object') return [];

	const combined: GuildLevelRoleEntry[] = [];
	const pushEntries = (arr: any, fallbackTrack: LevelRoleTrack) => {
		if (!Array.isArray(arr)) return;
		for (const item of arr) {
			const roleId = String(item?.roleId || item?.id || '').trim();
			const level = Number(item?.level);
			if (!roleId || !Number.isFinite(level) || level <= 0) continue;
			const track = item?.track || item?.type ? normalizeRoleTrack(item.track || item.type) : fallbackTrack;
			combined.push({ level, roleId, track });
		}
	};

	const mainRoles = Array.isArray(guild.levelRoles) && guild.levelRoles.length > 0 ? guild.levelRoles : guild.roles?.levels;
	const textRoles = Array.isArray(guild.textLevelRoles) && guild.textLevelRoles.length > 0 ? guild.textLevelRoles : guild.roles?.textLevels;
	const voiceRoles = Array.isArray(guild.voiceLevelRoles) && guild.voiceLevelRoles.length > 0 ? guild.voiceLevelRoles : guild.roles?.voiceLevels;

	pushEntries(mainRoles, 'server');
	pushEntries(textRoles, 'text');
	pushEntries(voiceRoles, 'voice');

	const seen = new Set<string>();
	return combined
		.filter((entry) => {
			const key = `${entry.track}:${entry.level}:${entry.roleId}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		})
		.sort((a, b) => a.level - b.level);
}

export interface GlobalXpMultiplierState {
	active: boolean;
	scheduled?: boolean | undefined;
	multiplier: number;
	scope: 'global_and_servers' | 'global_only' | 'everything';
	label: string;
	startsAt?: string | null | undefined;
	expiresAt?: string | null | undefined;
}

let cachedGlobalXp: { expiresAtMs: number; state: GlobalXpMultiplierState } | null = null;

export async function resolveGlobalXpMultiplier(ws: any): Promise<GlobalXpMultiplierState> {
	const now = Date.now();
	if (cachedGlobalXp && cachedGlobalXp.expiresAtMs > now) {
		return cachedGlobalXp.state;
	}

	const defaultState: GlobalXpMultiplierState = {
		active: false,
		multiplier: 1,
		scope: 'global_and_servers',
		label: 'Standard XP',
	};

	if (!ws) return defaultState;

	try {
		let rawValue: any = null;
		const settingDoc = await ws.get('xernerx', 'settings', { id: 'virtue_global_xp' }).catch(() => null);
		if (settingDoc && settingDoc.value !== undefined) {
			rawValue = settingDoc.value;
		} else {
			const fallbackGuild = await ws.get('virtue', 'guilds', { id: '__global__' }).catch(() => null);
			if (fallbackGuild?.levelMessage && String(fallbackGuild.levelMessage).trim().startsWith('{')) {
				rawValue = fallbackGuild.levelMessage;
			} else if (Number(fallbackGuild?.xpMultiplier) > 1) {
				rawValue = { enabled: true, multiplier: Number(fallbackGuild.xpMultiplier), scope: 'global_and_servers', label: 'Global XP Boost' };
			}
		}

		if (rawValue) {
			const parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
			const enabled = Boolean(parsed?.enabled);
			const mult = Math.min(10, Math.max(1, Number(parsed?.multiplier) || 1));
			const startMs = parsed?.startsAt ? new Date(parsed.startsAt).getTime() : null;
			const expMs = parsed?.expiresAt ? new Date(parsed.expiresAt).getTime() : null;
			const hasStarted = !startMs || Number.isNaN(startMs) || startMs <= now;
			const notExpired = !expMs || Number.isNaN(expMs) || expMs > now;
			const scheduled = enabled && !hasStarted && notExpired && mult > 1;
			const active = enabled && hasStarted && notExpired && mult > 1;
			const scope = (['global_and_servers', 'global_only', 'everything'].includes(parsed?.scope) ? parsed.scope : 'global_and_servers') as GlobalXpMultiplierState['scope'];

			const state: GlobalXpMultiplierState = {
				active,
				scheduled,
				multiplier: active ? mult : 1,
				scope,
				label: String(parsed?.label || 'Global XP Boost'),
				startsAt: parsed?.startsAt || null,
				expiresAt: parsed?.expiresAt || null,
			};
			cachedGlobalXp = { expiresAtMs: now + 30_000, state };
			return state;
		}
	} catch {}

	cachedGlobalXp = { expiresAtMs: now + 30_000, state: defaultState };
	return defaultState;
}

export function isChannelFilteredOut(guild: any, channelId?: string | null, parentId?: string | null): boolean {
	if (!guild || !channelId) return false;
	const ignored: string[] = [
		...(Array.isArray(guild.channels?.ignored) ? guild.channels.ignored.map(String) : []),
		...(Array.isArray(guild.ignored?.channels) ? guild.ignored.channels.map(String) : []),
	];
	if (ignored.includes(String(channelId)) || (parentId && ignored.includes(String(parentId)))) {
		return true;
	}

	const tracked: string[] = Array.isArray(guild.channels?.tracked) ? guild.channels.tracked.map(String).filter(Boolean) : [];
	if (tracked.length > 0 && !tracked.includes(String(channelId)) && (!parentId || !tracked.includes(String(parentId)))) {
		return true;
	}

	return false;
}

export function getMemberServerMultiplier(member: any, guildDoc: any, globalState: GlobalXpMultiplierState): number {
	let mult = Math.max(1, Number(guildDoc?.xpMultiplier) || 1);

	const boosterMult = Math.max(1, Number(guildDoc?.boosterMultiplier) || 1);
	if (boosterMult > 1 && member) {
		const premiumRoleId = member.guild?.roles?.premiumSubscriberRole?.id;
		const isBooster = Boolean(member.premiumSince) || Boolean(premiumRoleId && member.roles?.cache?.has(premiumRoleId));
		if (isBooster) {
			mult *= boosterMult;
		}
	}

	if (globalState.active && (globalState.scope === 'global_and_servers' || globalState.scope === 'everything')) {
		mult *= globalState.multiplier;
	}

	return mult;
}

export async function syncMemberLevelRoles(member: any, guildDoc: any, levels: { server: number; text?: number; voice?: number }, activeTracks: LevelRoleTrack[] = ['server', 'text', 'voice']) {
	if (!member?.roles?.cache) return;
	const levelRoles = extractGuildLevelRoles(guildDoc);
	if (levelRoles.length === 0) return;

	const stackRoles = guildDoc?.stackRoles !== false;
	const toAdd = new Set<string>();
	const toRemove = new Set<string>();

	const getTrackLevel = (track: LevelRoleTrack) => {
		if (track === 'text') return levels.text ?? 0;
		if (track === 'voice') return levels.voice ?? 0;
		return levels.server ?? 0;
	};

	for (const track of activeTracks) {
		const trackEntries = levelRoles.filter((lr) => lr.track === track && lr.roleId && lr.level > 0);
		if (trackEntries.length === 0) continue;

		const currentLvl = getTrackLevel(track);
		const unlocked = trackEntries.filter((lr) => lr.level <= currentLvl);

		if (stackRoles) {
			for (const lr of unlocked) {
				if (!member.roles.cache.has(lr.roleId)) {
					toAdd.add(lr.roleId);
				}
			}
		} else {
			const highest = unlocked[unlocked.length - 1];
			if (highest && !member.roles.cache.has(highest.roleId)) {
				toAdd.add(highest.roleId);
			}
			for (const lr of trackEntries) {
				if ((!highest || lr.roleId !== highest.roleId) && member.roles.cache.has(lr.roleId)) {
					toRemove.add(lr.roleId);
				}
			}
		}
	}

	for (const id of toAdd) {
		toRemove.delete(id);
	}

	if (toAdd.size > 0) {
		await member.roles.add(Array.from(toAdd)).catch(() => null);
	}
	if (toRemove.size > 0) {
		await member.roles.remove(Array.from(toRemove)).catch(() => null);
	}
}
