/** @format */

import { isServicesDisabledDoc, normalizeRoleTrack, resolveUnifiedServerProgress, type LevelRoleTrack } from './levels.js';

export interface DynamicManagedRoleEntry {
	level: number;
	roleId: string;
}

export interface DynamicRolesConfig {
	enabled?: boolean;
	anchorRoleId?: string | null;
	nameTemplate?: string | null;
	maxRoles?: number;
	track?: LevelRoleTrack | 'unified' | string;
	gradientEnabled?: boolean;
	colorStart?: string | null;
	colorEnd?: string | null;
	managed?: DynamicManagedRoleEntry[];
}

const guildSyncLocks = new Map<string, Promise<any>>();

function parseHexToRgb(hex?: string | null): { r: number; g: number; b: number } | null {
	const cleaned = String(hex || '')
		.trim()
		.replace(/^#/, '');
	if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return null;
	const num = parseInt(cleaned, 16);
	return {
		r: (num >> 16) & 0xff,
		g: (num >> 8) & 0xff,
		b: num & 0xff,
	};
}

export function interpolateHexColor(colorStart?: string | null, colorEnd?: string | null, t = 0, fallbackColor = 0): number {
	const start = parseHexToRgb(colorStart);
	const end = parseHexToRgb(colorEnd);
	if (!start && !end) return fallbackColor;
	if (!start) return ((end!.r << 16) | (end!.g << 8) | end!.b) >>> 0;
	if (!end) return ((start.r << 16) | (start.g << 8) | start.b) >>> 0;

	const clamped = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
	const r = Math.round(start.r + (end.r - start.r) * clamped);
	const g = Math.round(start.g + (end.g - start.g) * clamped);
	const b = Math.round(start.b + (end.b - start.b) * clamped);
	const combined = ((r << 16) | (g << 8) | b) >>> 0;
	return combined === 0 && (start.r > 0 || start.g > 0 || start.b > 0 || end.r > 0 || end.g > 0 || end.b > 0) ? 0x010101 : combined;
}

export function resolveTierColor(level: number, maxLevel: number, anchorColor: number, cfg?: DynamicRolesConfig | null): number {
	if (!cfg?.gradientEnabled) {
		return Number(anchorColor) || 0;
	}
	const span = Math.max(1, maxLevel - 1);
	const t = maxLevel <= 1 ? 0 : Math.min(1, Math.max(0, (level - 1) / span));
	return interpolateHexColor(cfg.colorStart || '#7c5cff', cfg.colorEnd || '#00e5ff', t, Number(anchorColor) || 0);
}

export function formatDynamicRoleName(template?: string | null, level = 1, anchorRoleName?: string | null): string {
	const lvlStr = String(Math.max(1, Math.floor(Number(level) || 1)));
	const rawTpl = String(template || '').trim();

	if (rawTpl && (/\[@level\]/i.test(rawTpl) || /\{level\}/i.test(rawTpl))) {
		return rawTpl.replace(/\[@level\]|\{level\}/gi, lvlStr).slice(0, 100);
	}

	const anchorName = String(anchorRoleName || '').trim();
	if (anchorName && /\d+/.test(anchorName)) {
		return anchorName.replace(/\d+(?!.*\d)/, lvlStr).slice(0, 100);
	}

	if (rawTpl) {
		return `${rawTpl} ${lvlStr}`.slice(0, 100);
	}

	return `Level ${lvlStr}`;
}

function getMilestoneSignificanceWeight(level: number): number {
	if (level <= 1) return 2.0;
	if (level % 100 === 0) return 1.65;
	if (level % 50 === 0) return 1.5;
	if (level % 25 === 0) return 1.38;
	if (level % 10 === 0) return 1.26;
	if (level % 5 === 0) return 1.15;
	return 1.0;
}

/**
 * Given a map of `level -> active user count` (`level >= 1, count >= 1`) and a `maxRoles` budget (`>= 1`),
 * returns the sorted ascending list of active milestone levels to maintain in Discord.
 * - Always includes `Level 1` (the permanent anchor role).
 * - Always includes the highest occupied level when `maxRoles >= 2`.
 * - When distinct occupied levels exceed `maxRoles`, selects the most defining milestones using
 *   milestone significance (`% 100`, `% 50`, `% 25`, `% 10`, `% 5`), spacing distance, and user density.
 */
export function selectDefiningMilestones(occupiedCounts: Map<number, number>, maxRoles: number): number[] {
	const budget = Math.max(1, Math.min(250, Math.floor(Number(maxRoles) || 250)));
	const levelSet = new Set<number>([1]);

	for (const [lvl, count] of occupiedCounts.entries()) {
		const parsedLvl = Math.floor(Number(lvl) || 0);
		if (parsedLvl >= 1 && Number(count) > 0) {
			levelSet.add(parsedLvl);
		}
	}

	const allLevels = Array.from(levelSet).sort((a, b) => a - b);
	if (allLevels.length <= budget) {
		return allLevels;
	}

	if (budget === 1) {
		return [1];
	}

	const maxLevel = allLevels[allLevels.length - 1]!;
	const selected = new Set<number>([1, maxLevel]);

	const candidates = allLevels.filter((lvl) => !selected.has(lvl));

	while (selected.size < budget && candidates.length > 0) {
		let bestIdx = 0;
		let bestScore = -1;
		const selectedArr = Array.from(selected);

		for (let i = 0; i < candidates.length; i++) {
			const cand = candidates[i]!;
			let minDist = Infinity;
			for (const s of selectedArr) {
				const dist = Math.abs(cand - s);
				if (dist < minDist) minDist = dist;
			}

			const milestoneWeight = getMilestoneSignificanceWeight(cand);
			const userCount = occupiedCounts.get(cand) || 1;
			const popBonus = 1 + Math.min(0.25, Math.log2(userCount + 1) * 0.05);
			const score = minDist * milestoneWeight * popBonus;

			if (score > bestScore || (score === bestScore && cand > candidates[bestIdx]!)) {
				bestScore = score;
				bestIdx = i;
			}
		}

		const chosen = candidates.splice(bestIdx, 1)[0]!;
		selected.add(chosen);
	}

	return Array.from(selected).sort((a, b) => a - b);
}

export function resolveUserMilestoneTier(userLevel: number, sortedTiers: number[]): number {
	let best = sortedTiers[0] ?? 1;
	for (const tier of sortedTiers) {
		if (tier <= userLevel) {
			best = tier;
		} else {
			break;
		}
	}
	return best;
}

function unwrapWsArray(raw: any): any[] {
	if (Array.isArray(raw)) return raw;
	if (Array.isArray(raw?.entries)) return raw.entries;
	if (raw && typeof raw === 'object') {
		if (raw.id || raw.ownerId) return [raw];
		return Object.values(raw);
	}
	return [];
}

export interface SyncDynamicGuildRolesParams {
	member: any;
	guildDoc: any;
	levels: { server: number; text?: number; voice?: number };
	ws: any;
	isGuildPremium?: boolean;
}

export interface SyncDynamicGuildRolesResult {
	assignedRoleId: string | null;
	assignedTier: number | null;
	managed: DynamicManagedRoleEntry[];
}

export async function syncDynamicGuildRoles(params: SyncDynamicGuildRolesParams): Promise<SyncDynamicGuildRolesResult> {
	const { member, guildDoc, levels, ws, isGuildPremium } = params;
	const discordGuild = member?.guild;
	const dynCfg: DynamicRolesConfig | undefined = guildDoc?.dynamicRoles;

	if (!discordGuild || !member?.roles || !isGuildPremium || !dynCfg?.enabled || !dynCfg?.anchorRoleId) {
		return {
			assignedRoleId: null,
			assignedTier: null,
			managed: Array.isArray(dynCfg?.managed) ? dynCfg.managed : [],
		};
	}

	const guildId = String(discordGuild.id);
	const prevLock = guildSyncLocks.get(guildId) || Promise.resolve();

	const task = prevLock.catch(() => null).then(() => executeDynamicGuildRoleSync(params));

	guildSyncLocks.set(guildId, task);
	try {
		return await task;
	} finally {
		if (guildSyncLocks.get(guildId) === task) {
			guildSyncLocks.delete(guildId);
		}
	}
}

async function executeDynamicGuildRoleSync({ member, guildDoc, levels, ws }: SyncDynamicGuildRolesParams): Promise<SyncDynamicGuildRolesResult> {
	const discordGuild = member.guild;
	const guildId = String(discordGuild.id);
	const dynCfg: DynamicRolesConfig = guildDoc.dynamicRoles || {};
	const anchorRoleId = String(dynCfg.anchorRoleId || '').trim();
	const track: LevelRoleTrack = normalizeRoleTrack(dynCfg.track);

	const getLevelForTrack = (t: LevelRoleTrack, lvls: { server: number; text?: number; voice?: number }) => {
		if (t === 'text') return Math.max(0, Math.floor(Number(lvls.text) || 0));
		if (t === 'voice') return Math.max(0, Math.floor(Number(lvls.voice) || 0));
		return Math.max(0, Math.floor(Number(lvls.server) || 0));
	};

	const triggerUserLevel = getLevelForTrack(track, levels);

	// 1. Resolve Anchor Role (Level 1) in Discord
	let anchorRole = discordGuild.roles?.cache?.get(anchorRoleId) || null;
	if (!anchorRole && typeof discordGuild.roles?.fetch === 'function') {
		anchorRole = await discordGuild.roles.fetch(anchorRoleId).catch(() => null);
	}
	if (!anchorRole) {
		return {
			assignedRoleId: null,
			assignedTier: null,
			managed: Array.isArray(dynCfg.managed) ? dynCfg.managed : [],
		};
	}

	// 2. Query active user levels for the configured track in this guild
	const wsAction = track === 'text' ? 'text' : track === 'voice' ? 'voice' : 'levels';
	const rawDocs = ws ? await ws.get('virtue', wsAction, { guild: guildId, limit: 200 }).catch(() => []) : [];
	const docs = unwrapWsArray(rawDocs);

	const userLevelsById = new Map<string, number>();
	for (const doc of docs) {
		if (!doc || typeof doc !== 'object' || isServicesDisabledDoc(doc)) continue;
		const uid = String(doc.id || doc.userId || '').trim();
		if (!uid) continue;
		const lvl = track === 'server' ? resolveUnifiedServerProgress(doc).level : Math.max(0, Math.floor(Number(doc.level) || 0));
		if (lvl >= 1) {
			const prev = userLevelsById.get(uid) || 0;
			if (lvl > prev) userLevelsById.set(uid, lvl);
		}
	}

	// Override with the triggering user's latest in-memory level
	if (triggerUserLevel >= 1) {
		userLevelsById.set(String(member.id), triggerUserLevel);
	} else {
		userLevelsById.delete(String(member.id));
	}

	// Build raw occupied level counts
	const rawOccupiedCounts = new Map<number, number>();
	for (const lvl of userLevelsById.values()) {
		if (lvl >= 1) {
			rawOccupiedCounts.set(lvl, (rawOccupiedCounts.get(lvl) || 0) + 1);
		}
	}

	// 3. Compute effective maxRoles budget respecting Discord's 250 guild role cap
	const existingManagedRaw: DynamicManagedRoleEntry[] = Array.isArray(dynCfg.managed) ? dynCfg.managed : [];
	const managedRoleIdSet = new Set<string>([anchorRoleId]);
	for (const item of existingManagedRaw) {
		if (item?.roleId) managedRoleIdSet.add(String(item.roleId));
	}

	const totalGuildRoles = discordGuild.roles?.cache?.size || 0;
	const nonManagedRoleCount = Math.max(0, totalGuildRoles - managedRoleIdSet.size);
	const availableDiscordSlots = Math.max(1, 245 - nonManagedRoleCount);
	const configuredMax = Math.min(250, Math.max(2, Math.floor(Number(dynCfg.maxRoles) || 250)));
	const effectiveMaxRoles = Math.min(configuredMax, availableDiscordSlots);

	// 4. Select candidate milestone tiers and filter out any tier > 1 with 0 mapped users
	const candidateTiers = selectDefiningMilestones(rawOccupiedCounts, effectiveMaxRoles);
	const mappedTierCounts = new Map<number, number>();
	mappedTierCounts.set(1, rawOccupiedCounts.get(1) || 0);

	for (const lvl of userLevelsById.values()) {
		const mappedTier = resolveUserMilestoneTier(lvl, candidateTiers);
		mappedTierCounts.set(mappedTier, (mappedTierCounts.get(mappedTier) || 0) + 1);
	}

	const activeTiers = candidateTiers.filter((tier) => tier === 1 || (mappedTierCounts.get(tier) || 0) > 0);
	const maxActiveLevel = activeTiers[activeTiers.length - 1] || 1;

	// 5. Partition existing managed roles into kept vs obsolete (0 users)
	const currentManagedByLevel = new Map<number, string>();
	currentManagedByLevel.set(1, anchorRoleId);

	for (const entry of existingManagedRaw) {
		const lvl = Math.floor(Number(entry?.level) || 0);
		const rId = String(entry?.roleId || '').trim();
		if (lvl <= 1 || !rId || rId === anchorRoleId) continue;
		if (discordGuild.roles.cache.has(rId)) {
			currentManagedByLevel.set(lvl, rId);
		}
	}

	const keptRoles = new Map<number, string>();
	const obsoleteRoles: DynamicManagedRoleEntry[] = [];

	for (const [lvl, rId] of currentManagedByLevel.entries()) {
		if (lvl === 1 || activeTiers.includes(lvl)) {
			keptRoles.set(lvl, rId);
		} else {
			obsoleteRoles.push({ level: lvl, roleId: rId });
		}
	}

	const missingTiers = activeTiers.filter((lvl) => lvl > 1 && !keptRoles.has(lvl));

	obsoleteRoles.sort((a, b) => a.level - b.level);
	missingTiers.sort((a, b) => a - b);

	const botHighestPos = discordGuild.members?.me?.roles?.highest?.position ?? 250;

	// 6. In-Place Promotion: reuse obsolete roles for missing tiers by renaming & recoloring
	while (obsoleteRoles.length > 0 && missingTiers.length > 0) {
		const obsolete = obsoleteRoles.shift()!;
		const targetLvl = missingTiers.shift()!;
		const roleObj = discordGuild.roles.cache.get(obsolete.roleId);

		if (roleObj && roleObj.id !== anchorRoleId) {
			const desiredName = formatDynamicRoleName(dynCfg.nameTemplate, targetLvl, anchorRole.name);
			const desiredColor = resolveTierColor(targetLvl, maxActiveLevel, anchorRole.color, dynCfg);
			const edited = await roleObj
				.edit({
					name: desiredName,
					color: desiredColor,
					hoist: Boolean(anchorRole.hoist),
				})
				.catch(() => null);

			if (edited) {
				keptRoles.set(targetLvl, roleObj.id);
				continue;
			}
		}

		// If editing failed, put targetLvl back so it gets created fresh
		missingTiers.unshift(targetLvl);
	}

	// 7. Create roles for any remaining missing tiers
	for (const targetLvl of missingTiers) {
		const desiredName = formatDynamicRoleName(dynCfg.nameTemplate, targetLvl, anchorRole.name);
		const desiredColor = resolveTierColor(targetLvl, maxActiveLevel, anchorRole.color, dynCfg);
		const targetPosition = Math.max(1, Math.min(botHighestPos - 1, (Number(anchorRole.position) || 1) + 1));

		const created = await discordGuild.roles
			.create({
				name: desiredName,
				color: desiredColor,
				hoist: Boolean(anchorRole.hoist),
				permissions: 0n,
				position: targetPosition,
				reason: `Virtue Dynamic Level Role (Level ${targetLvl})`,
			})
			.catch(() => null);

		if (created?.id) {
			keptRoles.set(targetLvl, created.id);
		}
	}

	// 8. Delete any remaining obsolete roles with 0 users (never deleting anchorRoleId)
	for (const obsolete of obsoleteRoles) {
		if (obsolete.roleId && obsolete.roleId !== anchorRoleId) {
			const roleObj = discordGuild.roles.cache.get(obsolete.roleId);
			if (roleObj) {
				await roleObj.delete(`Virtue Dynamic Level Role (Level ${obsolete.level} reached 0 users)`).catch(() => null);
			}
		}
	}

	// 9. Sync colors, names & hoist on existing kept roles (including Level 1 gradient start color)
	const sortedFinalTiers = Array.from(keptRoles.keys()).sort((a, b) => a - b);
	for (const tierLvl of sortedFinalTiers) {
		const rId = keptRoles.get(tierLvl)!;
		const roleObj = discordGuild.roles.cache.get(rId);
		if (!roleObj || roleObj.position >= botHighestPos) continue;

		const desiredColor = resolveTierColor(tierLvl, maxActiveLevel, anchorRole.color, dynCfg);
		if (tierLvl === 1) {
			if (dynCfg.gradientEnabled && roleObj.color !== desiredColor) {
				await roleObj.edit({ color: desiredColor }).catch(() => null);
			}
			continue;
		}

		const desiredName = formatDynamicRoleName(dynCfg.nameTemplate, tierLvl, anchorRole.name);
		const desiredHoist = Boolean(anchorRole.hoist);
		if (roleObj.name !== desiredName || roleObj.color !== desiredColor || Boolean(roleObj.hoist) !== desiredHoist) {
			await roleObj
				.edit({
					name: desiredName,
					color: desiredColor,
					hoist: desiredHoist,
				})
				.catch(() => null);
		}
	}

	// 10. Maintain ascending role hierarchy above Level 1 anchor role
	if (sortedFinalTiers.length > 1 && anchorRole.position < botHighestPos - 1) {
		const roleObjs = sortedFinalTiers.map((lvl) => discordGuild.roles.cache.get(keptRoles.get(lvl)!)).filter((r): r is NonNullable<typeof r> => Boolean(r && r.position < botHighestPos));

		let isOrdered = true;
		for (let i = 1; i < roleObjs.length; i++) {
			if ((roleObjs[i]!.position || 0) <= (roleObjs[i - 1]!.position || 0)) {
				isOrdered = false;
				break;
			}
		}

		if (!isOrdered && roleObjs.length > 1 && typeof discordGuild.roles?.setPositions === 'function') {
			const basePos = Math.max(1, Number(anchorRole.position) || 1);
			const positionPayload = roleObjs.map((r, idx) => ({
				role: r.id,
				position: Math.min(botHighestPos - 1, basePos + idx),
			}));
			await discordGuild.roles.setPositions(positionPayload).catch(() => null);
		}
	}

	// 11. Assign target tier role to triggering member and remove any other dynamic roles
	const freshMember = typeof member.fetch === 'function' ? await member.fetch(true).catch(() => member) : member;
	if (freshMember && Array.isArray(freshMember._roles) && Array.isArray(member._roles)) {
		member._roles = [...freshMember._roles];
	}
	const targetMember = freshMember || member;

	let assignedTier: number | null = null;
	let assignedRoleId: string | null = null;

	if (triggerUserLevel >= 1) {
		assignedTier = resolveUserMilestoneTier(triggerUserLevel, sortedFinalTiers);
		assignedRoleId = keptRoles.get(assignedTier) || anchorRoleId;
	}

	const allDynamicIds = new Set<string>([anchorRoleId, ...keptRoles.values()]);
	for (const entry of existingManagedRaw) {
		if (entry?.roleId) allDynamicIds.add(String(entry.roleId));
	}

	if (assignedRoleId && !targetMember.roles.cache.has(assignedRoleId)) {
		const res = await targetMember.roles.add(assignedRoleId).catch(() => null);
		if (res) {
			if (Array.isArray(targetMember._roles) && !targetMember._roles.includes(assignedRoleId)) targetMember._roles.push(assignedRoleId);
			if (Array.isArray(member._roles) && !member._roles.includes(assignedRoleId)) member._roles.push(assignedRoleId);
		}
	}

	for (const dynRoleId of allDynamicIds) {
		if (dynRoleId !== assignedRoleId && targetMember.roles.cache.has(dynRoleId)) {
			const res = await targetMember.roles.remove(dynRoleId).catch(() => null);
			if (res) {
				if (Array.isArray(targetMember._roles)) targetMember._roles = targetMember._roles.filter((id: string) => id !== dynRoleId);
				if (Array.isArray(member._roles)) member._roles = member._roles.filter((id: string) => id !== dynRoleId);
			}
		}
	}

	// 12. Persist updated dynamicRoles.managed to virtue/guilds if changed
	const nextManaged: DynamicManagedRoleEntry[] = sortedFinalTiers.map((lvl) => ({
		level: lvl,
		roleId: keptRoles.get(lvl)!,
	}));

	const prevSerialized = JSON.stringify(existingManagedRaw.map((m) => ({ level: Number(m.level), roleId: String(m.roleId) })));
	const nextSerialized = JSON.stringify(nextManaged);

	if (ws && prevSerialized !== nextSerialized) {
		const nextDynCfg = {
			...dynCfg,
			managed: nextManaged,
		};
		guildDoc.dynamicRoles = nextDynCfg;
		await ws
			.update('virtue', 'guilds', {
				id: guildId,
				dynamicRoles: nextDynCfg,
			})
			.catch(() => null);
	}

	return {
		assignedRoleId,
		assignedTier,
		managed: nextManaged,
	};
}

/**
 * Deletes all dynamically created level roles above Level 1 when a server reset cycle (Daily/Weekly/Monthly) triggers.
 */
export async function pruneDynamicRolesOnCycleReset(discordGuild: any, guildDoc: any, ws: any): Promise<void> {
	const dynCfg: DynamicRolesConfig | undefined = guildDoc?.dynamicRoles;
	if (!discordGuild || !dynCfg?.enabled || !dynCfg?.anchorRoleId) return;

	const anchorRoleId = String(dynCfg.anchorRoleId).trim();
	const managed: DynamicManagedRoleEntry[] = Array.isArray(dynCfg.managed) ? dynCfg.managed : [];

	for (const entry of managed) {
		const rId = String(entry?.roleId || '').trim();
		if (!rId || rId === anchorRoleId || Number(entry?.level) <= 1) continue;
		const roleObj = discordGuild.roles?.cache?.get(rId);
		if (roleObj) {
			await roleObj.delete('Virtue Level Cycle Reset').catch(() => null);
		}
	}

	const resetManaged: DynamicManagedRoleEntry[] = [{ level: 1, roleId: anchorRoleId }];
	if (ws) {
		await ws
			.update('virtue', 'guilds', {
				id: String(discordGuild.id),
				dynamicRoles: {
					...dynCfg,
					managed: resetManaged,
				},
			})
			.catch(() => null);
	}
}
