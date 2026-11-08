/** @format */

import { XernerxUser } from '@xernerx/framework';
import { syncDynamicGuildRoles } from './dynamicRoles.js';

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

export function resolveUnifiedServerProgress(member: any, text?: any, voice?: any): { level: number; xp: number } {
	const safeMember = isServicesDisabledDoc(member) ? null : member;
	const safeText = isServicesDisabledDoc(text) ? null : text;
	const safeVoice = isServicesDisabledDoc(voice) ? null : voice;
	const candidates = [
		{ level: Number(safeMember?.level) || 0, xp: Number(safeMember?.xp) || 0 },
		{ level: Number(safeText?.level) || 0, xp: Number(safeText?.xp) || 0 },
		{ level: Number(safeVoice?.level) || 0, xp: Number(safeVoice?.xp) || 0 },
	];
	candidates.sort((a, b) => b.level - a.level || b.xp - a.xp);
	return candidates[0] || { level: 0, xp: 0 };
}

export const REVIEW_XP_BONUS = 0.05;
export const VOTE_XP_BONUS = 0.1;
export const PREMIUM_PASS_XP_BONUS = 0.5;
export const PREMIUM_PASS_XP_MULTIPLIER = 1.5;
export const VOICE_STREAMING_XP_MULTIPLIER = 1.25;

const VIRTUE_OR_ULTRA_IDS = new Set([
	'ultra',
	'bot-virtue',
	'discord_virtue',
	'virtue',
	'credit_trial_ultra',
	'credit_trial_bot-virtue',
	'staff_infinite_sub',
	'prod_V0pD5uXoTQkrYS',
	'price_1UAA6hH0UrDYoToMPWTsgJjD',
	'price_1U0ncoH0UrDYoToMQ6aTtz1G',
	'price_1U0nbeH0UrDYoToM58B2ZmMf',
	'price_1U0no9H0UrDYoToMv1buQ3KM',
	'price_1U0nmvH0UrDYoToM1yWyPkEz',
	'price_1U0oO5Ha7VTBTnBRaUwYmdkk',
]);

export function hasVirtueOrUltraPass(xUser: any, subDoc?: any, now = Date.now()): boolean {
	if (!xUser && !subDoc) return false;
	if (xUser?.staffSubscription === true) return true;

	const rawSubs: any[] = [
		...(Array.isArray(xUser?.subscriptions) ? xUser.subscriptions : []),
		...(Array.isArray(xUser?.billing?.subscriptions) ? xUser.billing.subscriptions : []),
		...(Array.isArray(subDoc) ? subDoc : subDoc && typeof subDoc === 'object' ? [subDoc] : []),
	];

	return rawSubs.some((sub) => {
		if (!sub || (sub.status !== 'active' && sub.status !== 'trialing')) return false;
		if (sub.currentPeriodEnd) {
			const endMs = new Date(sub.currentPeriodEnd).getTime();
			if (!Number.isNaN(endMs) && endMs <= now) return false;
		}
		const priceId = String(sub.priceId || '').trim();
		const subId = String(sub.stripeSubscriptionId || '').trim();
		const lowerPrice = priceId.toLowerCase();
		const lowerSub = subId.toLowerCase();
		return (
			VIRTUE_OR_ULTRA_IDS.has(priceId) || VIRTUE_OR_ULTRA_IDS.has(subId) || lowerPrice.includes('ultra') || lowerPrice.includes('virtue') || lowerSub.includes('ultra') || lowerSub.includes('virtue')
		);
	});
}

export interface UserServicesCheckResult {
	allowed: boolean;
	services: boolean;
	blacklisted: boolean;
	hasPremiumPass: boolean;
	voted: boolean;
	nextVoteAt: string | null;
	reviewed: boolean;
	rating: number | null;
	xpMultiplier: number;
	userDoc: any;
	virtueUserDoc: any;
}

const userServicesCache = new Map<string, { expiresAtMs: number; state: UserServicesCheckResult }>();
const USER_SERVICES_TTL_MS = 15_000;

export function isServicesDisabledDoc(doc: any): boolean {
	if (!doc || typeof doc !== 'object') return false;
	return doc.services === false || doc.servicesDisabled === true || doc.blacklisted === true;
}

export function computePersonalXpMultiplier(flags: { hasPremiumPass?: boolean; voted?: boolean; reviewed?: boolean }): number {
	const bonus = (flags.hasPremiumPass ? PREMIUM_PASS_XP_BONUS : 0) + (flags.voted ? VOTE_XP_BONUS : 0) + (flags.reviewed ? REVIEW_XP_BONUS : 0);
	return Number((1 + bonus).toFixed(2));
}

export function markUserServicesCache(
	userId: string,
	partial: {
		services?: boolean;
		blacklisted?: boolean;
		hasPremiumPass?: boolean;
		voted?: boolean;
		nextVoteAt?: string | null;
		reviewed?: boolean;
		rating?: number | null;
		userDoc?: any;
		virtueUserDoc?: any;
	}
) {
	if (!userId) return;
	const existing = userServicesCache.get(String(userId))?.state;
	const services = partial.services !== false;
	const blacklisted = Boolean(partial.blacklisted);
	const hasPremiumPass = partial.hasPremiumPass ?? existing?.hasPremiumPass ?? hasVirtueOrUltraPass(partial.userDoc ?? existing?.userDoc);
	const voted = partial.voted ?? existing?.voted ?? false;
	const nextVoteAt = partial.nextVoteAt !== undefined ? partial.nextVoteAt : (existing?.nextVoteAt ?? null);
	const reviewed = partial.reviewed ?? existing?.reviewed ?? false;
	const rating = partial.rating !== undefined ? partial.rating : (existing?.rating ?? null);
	const state: UserServicesCheckResult = {
		allowed: services && !blacklisted,
		services,
		blacklisted,
		hasPremiumPass,
		voted,
		nextVoteAt,
		reviewed,
		rating,
		xpMultiplier: computePersonalXpMultiplier({ hasPremiumPass, voted, reviewed }),
		userDoc: partial.userDoc ?? existing?.userDoc ?? null,
		virtueUserDoc: partial.virtueUserDoc ?? existing?.virtueUserDoc ?? null,
	};
	userServicesCache.set(String(userId), {
		expiresAtMs: Date.now() + USER_SERVICES_TTL_MS,
		state,
	});
}

/**
 * Checks whether automated Xernerx/Virtue actions (auto profile creation, guild profile creation,
 * XP/level progression, role rewards, credit rewards) are enabled for a user (`XernerxUser.services !== false`),
 * and resolves whether the user holds an active Virtue Pass or Ultra subscription, vote boost, or review boost (`xpMultiplier`).
 * Users without a Xernerx account (`xUser === null` and no opt-out tombstone in `virtue/users`) are always allowed (`services: true`).
 */
export async function checkUserServices(ws: any, userId: string, userObj?: any, options?: { forceRefresh?: boolean }): Promise<UserServicesCheckResult> {
	const id = String(userId || userObj?.id || '').trim();
	if (!id) {
		return {
			allowed: true,
			services: true,
			blacklisted: false,
			hasPremiumPass: false,
			voted: false,
			nextVoteAt: null,
			reviewed: false,
			rating: null,
			xpMultiplier: 1,
			userDoc: null,
			virtueUserDoc: null,
		};
	}

	const now = Date.now();
	const cached = !options?.forceRefresh ? userServicesCache.get(id) : null;
	if (cached && cached.expiresAtMs > now) {
		return cached.state;
	}

	if (!ws) {
		if (typeof userObj?.fetchEngagement === 'function') {
			await userObj.fetchEngagement(Boolean(options?.forceRefresh)).catch(() => null);
		}
		const hasAccountOnObj = Boolean(userObj?.xernerxAccount || userObj?.hasAccount);
		const blacklisted = Boolean(userObj?.blacklisted);
		const services = hasAccountOnObj ? userObj?.services !== false : true;
		const voted = Boolean(userObj?.voted);
		const nextVoteAt = userObj?.nextVoteAt ?? null;
		const reviewed = Boolean(userObj?.reviewed);
		const rating = userObj?.rating ?? null;
		let hasPremiumPass = false;
		if (typeof userObj?.premium === 'function') {
			hasPremiumPass = Boolean(await userObj.premium().catch(() => false));
		}
		return {
			allowed: services && !blacklisted,
			services,
			blacklisted,
			hasPremiumPass,
			voted,
			nextVoteAt,
			reviewed,
			rating,
			xpMultiplier: computePersonalXpMultiplier({ hasPremiumPass, voted, reviewed }),
			userDoc: null,
			virtueUserDoc: null,
		};
	}

	try {
		const [xUser, vUser, subDoc] = await Promise.all([
			ws.get('xernerx', 'users', { id }).catch(() => null),
			ws.get('virtue', 'users', { id }).catch(() => null),
			ws.get('xernerx', 'subscriptions', { ownerId: id }).catch(() => null),
			typeof userObj?.fetchEngagement === 'function' ? userObj.fetchEngagement(Boolean(options?.forceRefresh)).catch(() => null) : Promise.resolve(null),
		]);

		let hasPremiumPass = hasVirtueOrUltraPass(xUser, subDoc, now);
		if (!hasPremiumPass && typeof userObj?.premium === 'function') {
			hasPremiumPass = Boolean(await userObj.premium().catch(() => false));
		}
		const voted = Boolean(userObj?.voted);
		const nextVoteAt = userObj?.nextVoteAt ?? null;
		const reviewed = Boolean(userObj?.reviewed);
		const rating = userObj?.rating ?? null;
		const xpMultiplier = computePersonalXpMultiplier({ hasPremiumPass, voted, reviewed });

		// If the user has no Xernerx account and no Virtue opt-out tombstone, they are never locked out.
		if (!xUser && !vUser) {
			const state: UserServicesCheckResult = {
				allowed: true,
				services: true,
				blacklisted: false,
				hasPremiumPass,
				voted,
				nextVoteAt,
				reviewed,
				rating,
				xpMultiplier,
				userDoc: null,
				virtueUserDoc: null,
			};
			userServicesCache.set(id, {
				expiresAtMs: now + USER_SERVICES_TTL_MS,
				state,
			});
			return state;
		}

		const blacklisted = Boolean(xUser?.blacklisted || vUser?.blacklisted);
		const xServicesAllowed = xUser ? xUser.services !== false && !xUser.servicesDisabled : true;
		const vServicesAllowed = vUser ? vUser.services !== false && !vUser.servicesDisabled : true;
		const objServicesAllowed = xUser && userObj && typeof userObj.services === 'boolean' ? userObj.services !== false : true;
		const services = xServicesAllowed && vServicesAllowed && objServicesAllowed;

		const state: UserServicesCheckResult = {
			allowed: services && !blacklisted,
			services,
			blacklisted,
			hasPremiumPass,
			voted,
			nextVoteAt,
			reviewed,
			rating,
			xpMultiplier,
			userDoc: xUser || null,
			virtueUserDoc: vUser || null,
		};

		userServicesCache.set(id, {
			expiresAtMs: now + USER_SERVICES_TTL_MS,
			state,
		});
		return state;
	} catch {
		return {
			allowed: true,
			services: true,
			blacklisted: false,
			hasPremiumPass: false,
			voted: false,
			nextVoteAt: null,
			reviewed: false,
			rating: null,
			xpMultiplier: 1,
			userDoc: null,
			virtueUserDoc: null,
		};
	}
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

	if (guild.dynamicRoles?.enabled && guild.dynamicRoles?.anchorRoleId) {
		const dynTrack = normalizeRoleTrack(guild.dynamicRoles.track);
		const anchorRoleId = String(guild.dynamicRoles.anchorRoleId).trim();
		const dynEntries: GuildLevelRoleEntry[] = [{ level: 1, roleId: anchorRoleId, track: dynTrack }];
		if (Array.isArray(guild.dynamicRoles.managed)) {
			for (const item of guild.dynamicRoles.managed) {
				const roleId = String(item?.roleId || '').trim();
				const level = Number(item?.level);
				if (!roleId || !Number.isFinite(level) || level <= 0) continue;
				dynEntries.push({ level, roleId, track: dynTrack });
			}
		}
		const seenDyn = new Set<string>();
		return dynEntries
			.filter((entry) => {
				const key = `${entry.track}:${entry.level}`;
				if (seenDyn.has(key)) return false;
				seenDyn.add(key);
				return true;
			})
			.sort((a, b) => a.level - b.level);
	}

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

const guildPremiumCache = new Map<string, { expiresAtMs: number; premium: boolean }>();
const GUILD_PREMIUM_TTL_MS = 60_000;

export async function checkGuildPremium(discordGuild: any): Promise<boolean> {
	const guildId = String(discordGuild?.id || '').trim();
	const ownerId = String(discordGuild?.ownerId || '').trim();
	if (!guildId || !ownerId || !discordGuild?.client) return false;

	const now = Date.now();
	const cached = guildPremiumCache.get(guildId);
	if (cached && cached.expiresAtMs > now) {
		return cached.premium;
	}

	try {
		const ws = (discordGuild.client as any).websocket;
		const xOwner = new XernerxUser(discordGuild.client as any, { id: ownerId } as any);
		const ownerCheck = await checkUserServices(ws, ownerId, xOwner);
		let premium = Boolean(ownerCheck.hasPremiumPass);
		if (!premium) {
			premium = Boolean(await xOwner.premium().catch(() => false));
		}
		guildPremiumCache.set(guildId, { expiresAtMs: now + GUILD_PREMIUM_TTL_MS, premium });
		return premium;
	} catch {
		return false;
	}
}

export function getMemberServerMultiplier(member: any, guildDoc: any, globalState: GlobalXpMultiplierState, isGuildPremium = false): number {
	let mult = Math.max(1, Number(guildDoc?.xpMultiplier) || 1);

	const boosterMult = isGuildPremium ? Math.max(1, Number(guildDoc?.boosterMultiplier) || 1) : 1;
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

export async function syncMemberLevelRoles(
	member: any,
	guildDoc: any,
	levels: { server: number; text?: number; voice?: number },
	activeTracks: LevelRoleTrack[] = ['server', 'text', 'voice'],
	options?: { ws?: any; isGuildPremium?: boolean }
) {
	if (!member?.roles?.cache) return;

	if (guildDoc?.dynamicRoles?.enabled && guildDoc?.dynamicRoles?.anchorRoleId) {
		await syncDynamicGuildRoles({
			member,
			guildDoc,
			levels,
			ws: options?.ws,
			isGuildPremium: Boolean(options?.isGuildPremium),
		});
		return;
	}

	const levelRoles = extractGuildLevelRoles(guildDoc);
	if (levelRoles.length === 0) return;

	const stackRoles = guildDoc?.stackRoles !== false;

	const getTrackLevel = (track: LevelRoleTrack) => {
		if (track === 'text') return levels.text ?? 0;
		if (track === 'voice') return levels.voice ?? 0;
		return levels.server ?? 0;
	};

	const computeDiff = (targetMember: any) => {
		const toAdd = new Set<string>();
		const toRemove = new Set<string>();
		const shouldKeep = new Set<string>();

		for (const track of activeTracks) {
			const trackEntries = levelRoles.filter((lr) => lr.track === track && lr.roleId && lr.level > 0);
			if (trackEntries.length === 0) continue;

			const currentLvl = getTrackLevel(track);
			const unlocked = trackEntries.filter((lr) => lr.level <= currentLvl);

			if (stackRoles) {
				for (const lr of unlocked) {
					shouldKeep.add(lr.roleId);
					if (!targetMember.roles.cache.has(lr.roleId)) {
						toAdd.add(lr.roleId);
					}
				}
			} else {
				const highestLevel = unlocked[unlocked.length - 1]?.level;
				const highestEntries = highestLevel !== undefined ? unlocked.filter((lr) => lr.level === highestLevel) : [];
				for (const lr of highestEntries) {
					shouldKeep.add(lr.roleId);
					if (!targetMember.roles.cache.has(lr.roleId)) {
						toAdd.add(lr.roleId);
					}
				}
				for (const lr of trackEntries) {
					if (!shouldKeep.has(lr.roleId) && targetMember.roles.cache.has(lr.roleId)) {
						toRemove.add(lr.roleId);
					}
				}
			}
		}

		for (const id of shouldKeep) {
			toRemove.delete(id);
		}

		return { toAdd, toRemove };
	};

	let { toAdd, toRemove } = computeDiff(member);
	if (toAdd.size === 0 && toRemove.size === 0) return;

	// Refresh member from Discord API before mutating roles since GuildMembers intent is not enabled
	// and cached voiceState/message member._roles may be stale.
	const freshMember = typeof member.fetch === 'function' ? await member.fetch(true).catch(() => member) : member;
	if (freshMember && Array.isArray(freshMember._roles) && Array.isArray(member._roles)) {
		member._roles = [...freshMember._roles];
	}

	({ toAdd, toRemove } = computeDiff(freshMember || member));
	if (toAdd.size === 0 && toRemove.size === 0) return;

	const target = freshMember || member;

	// Use single-role add/remove calls so Discord's atomic PUT/DELETE role endpoints are used
	// rather than PATCHing the entire member roles array with potentially stale cache state.
	for (const roleId of toAdd) {
		const res = await target.roles.add(roleId).catch(() => null);
		if (res) {
			if (Array.isArray(target._roles) && !target._roles.includes(roleId)) target._roles.push(roleId);
			if (Array.isArray(member._roles) && !member._roles.includes(roleId)) member._roles.push(roleId);
		}
	}

	for (const roleId of toRemove) {
		const res = await target.roles.remove(roleId).catch(() => null);
		if (res) {
			if (Array.isArray(target._roles)) target._roles = target._roles.filter((id: string) => id !== roleId);
			if (Array.isArray(member._roles)) member._roles = member._roles.filter((id: string) => id !== roleId);
		}
	}
}
