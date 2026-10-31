/** @format */

import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';

function initBundledFonts(): string[] {
	const candidateDirs = [resolve(fileURLToPath(new URL('../../assets/fonts', import.meta.url))), resolve(process.cwd(), 'assets/fonts')];
	const fontsDir = candidateDirs.find((d) => existsSync(d));
	if (!fontsDir) return [];

	let fontFiles: string[] = [];
	try {
		fontFiles = readdirSync(fontsDir)
			.filter((f) => /\.(ttf|otf)$/i.test(f))
			.sort((a, b) => {
				const score = (name: string) => (name.toLowerCase().startsWith('fredoka') ? 0 : name.toLowerCase().startsWith('segoe') ? 1 : 2);
				return score(a) - score(b) || a.localeCompare(b);
			})
			.map((f) => join(fontsDir, f));
	} catch {
		return [];
	}

	if (fontFiles.length === 0) return [];

	// Also seed user font dirs & fontconfig for sharp/librsvg fallback on headless Linux containers
	try {
		const home = homedir();
		for (const sub of ['.fonts', '.local/share/fonts']) {
			const targetDir = join(home, sub);
			mkdirSync(targetDir, { recursive: true });
			for (const src of fontFiles) {
				const dest = join(targetDir, src.split(/[\\/]/).pop()!);
				if (!existsSync(dest)) copyFileSync(src, dest);
			}
		}
	} catch {}

	try {
		const cacheDir = join(tmpdir(), 'virtue-fontconfig-cache');
		mkdirSync(cacheDir, { recursive: true });
		const confPath = join(tmpdir(), 'virtue-fonts.conf');
		const escapedDir = fontsDir.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		const escapedCache = cacheDir.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		writeFileSync(
			confPath,
			`<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">\n<fontconfig>\n\t<dir>${escapedDir}</dir>\n\t<dir>/usr/share/fonts</dir>\n\t<dir>/usr/local/share/fonts</dir>\n\t<cachedir>${escapedCache}</cachedir>\n</fontconfig>\n`,
			'utf8'
		);
		if (!process.env.FONTCONFIG_FILE) process.env.FONTCONFIG_FILE = confPath;
		if (!process.env.PANGOCAIRO_BACKEND) process.env.PANGOCAIRO_BACKEND = 'fc';
	} catch {}

	return fontFiles;
}

const BUNDLED_FONT_FILES = initBundledFonts();

async function renderSvgToPng(svg: string): Promise<Buffer> {
	try {
		const resvg = new Resvg(svg, {
			font: {
				fontFiles: BUNDLED_FONT_FILES,
				loadSystemFonts: BUNDLED_FONT_FILES.length === 0,
				defaultFontFamily: 'Fredoka',
				sansSerifFamily: 'Fredoka',
				monospaceFamily: 'Consolas',
			},
		});
		return Buffer.from(resvg.render().asPng());
	} catch {
		return await sharp(Buffer.from(svg)).png().toBuffer();
	}
}

export const DEFAULT_XERNERX_COLOR = 0x8b7cf6;
export const DEFAULT_XERNERX_HEX = '#8b7cf6';

export interface ResolvedAccent {
	colorInt: number;
	colorHex: string;
	theme: 'dark' | 'light';
}

export interface LevelTrackData {
	title: string;
	subtitle: string;
	badge?: string;
	level: number;
	currentXp: number;
	nextXp: number;
	progress: number;
}

export interface LevelRoleSummary {
	name: string;
	level: number;
	colorHex: string;
	track?: 'server' | 'text' | 'voice' | undefined;
	userTrackLevel?: number | undefined;
}

export interface LevelCardOptions {
	displayName: string;
	username: string;
	avatarUrl: string | null;
	guildName: string;
	accentHex: string;
	theme?: 'dark' | 'light';
	tracks: {
		global: LevelTrackData;
		server: LevelTrackData;
		text: LevelTrackData;
		voice: LevelTrackData;
	};
	currentRole?: LevelRoleSummary | null;
	nextRole?: LevelRoleSummary | null;
}

export function parseHexColor(hex?: string | null): { colorInt: number; colorHex: string } | null {
	if (!hex || typeof hex !== 'string') return null;
	const clean = hex.trim().replace(/^#/, '');
	if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
	const parsed = parseInt(clean, 16);
	if (Number.isNaN(parsed)) return null;
	return {
		colorInt: parsed,
		colorHex: `#${clean.toLowerCase()}`,
	};
}

export async function resolveUserAccent(ws: any, targetUserId: string, invokerUserId?: string): Promise<ResolvedAccent> {
	const candidateIds = Array.from(new Set([targetUserId, invokerUserId].filter(Boolean) as string[]));

	for (const uid of candidateIds) {
		try {
			const doc = await ws?.get?.('xernerx', 'appearance', { ownerId: uid, id: uid }).catch(() => null);
			const parsed = parseHexColor(doc?.accent);
			if (parsed) {
				return {
					...parsed,
					theme: doc?.theme === 'light' ? 'light' : 'dark',
				};
			}
		} catch {}
	}

	const apiBase = 'https://api.xernerx.com';
	for (const uid of candidateIds) {
		try {
			const res = await fetch(`${apiBase}/core/users/${uid}`);
			if (res.ok) {
				const data: any = await res.json();
				const parsed = parseHexColor(data?.accent);
				if (parsed) {
					return {
						...parsed,
						theme: 'dark',
					};
				}
			}
		} catch {}
	}

	return {
		colorInt: DEFAULT_XERNERX_COLOR,
		colorHex: DEFAULT_XERNERX_HEX,
		theme: 'dark',
	};
}

function escapeXml(unsafe: string): string {
	return String(unsafe || '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

function truncateText(str: string, maxLen: number): string {
	const clean = String(str || '').trim();
	if (clean.length <= maxLen) return clean;
	return `${clean.slice(0, Math.max(1, maxLen - 1))}…`;
}

async function fetchAvatarDataUri(url: string | null): Promise<string | null> {
	if (!url) return null;
	try {
		const pngUrl = url.replace(/\.(webp|gif)(\?|$)/i, '.png$2');
		const res = await fetch(pngUrl);
		if (!res.ok) return null;
		const arrayBuf = await res.arrayBuffer();
		const pngBuf = await sharp(Buffer.from(arrayBuf)).resize(160, 160, { fit: 'cover' }).png().toBuffer();
		return `data:image/png;base64,${pngBuf.toString('base64')}`;
	} catch {
		return null;
	}
}

export async function renderLevelCardPng(opts: LevelCardOptions): Promise<Buffer> {
	const avatarDataUri = await fetchAvatarDataUri(opts.avatarUrl);
	const isLight = opts.theme === 'light';
	const accent = parseHexColor(opts.accentHex)?.colorHex || DEFAULT_XERNERX_HEX;

	const hasRoles = Boolean(opts.currentRole || opts.nextRole);
	const width = 920;
	const height = hasRoles ? 548 : 472;

	const bgStart = isLight ? '#f8fafc' : '#0b0e17';
	const bgMid = isLight ? '#f1f5f9' : '#101524';
	const bgEnd = isLight ? '#e2e8f0' : '#151c30';
	const cardBg = isLight ? '#ffffff' : '#141a2b';
	const cardStroke = isLight ? '#0f172a' : '#ffffff';
	const trackBg = isLight ? '#e2e8f0' : '#0b0f1a';
	const textPrimary = isLight ? '#0f172a' : '#f8fafc';
	const textSecondary = isLight ? '#475569' : '#94a3b8';
	const textMuted = isLight ? '#64748b' : '#64748b';

	const safeDisplayName = escapeXml(truncateText(opts.displayName || opts.username || 'User', 22));
	const safeHandle = escapeXml(truncateText(`@${opts.username}`, 26));
	const safeGuild = escapeXml(truncateText(opts.guildName || 'Discord Server', 24));
	const initial = escapeXml((opts.displayName || opts.username || 'U').charAt(0).toUpperCase());

	const renderTrackCard = (track: LevelTrackData, x: number, y: number, idSuffix: string) => {
		const cardW = 418;
		const cardH = 138;
		const barX = 22;
		const barY = 74;
		const barW = cardW - 44;
		const barH = 14;
		const clampedPct = Math.max(0, Math.min(100, Number(track.progress) || 0));
		const fillW = clampedPct > 0 ? Math.max(14, Math.round((clampedPct / 100) * barW)) : 0;

		const safeTitle = escapeXml(truncateText(track.title.toUpperCase(), 26));
		const safeSub = escapeXml(truncateText(track.subtitle, 30));
		const safeBadge = track.badge ? escapeXml(truncateText(track.badge, 18)) : '';
		const xpText = escapeXml(`${track.currentXp.toLocaleString()} / ${track.nextXp.toLocaleString()} XP`);
		const pctText = escapeXml(`${clampedPct.toFixed(1)}%`);

		return `
		<g transform="translate(${x}, ${y})">
			<rect width="${cardW}" height="${cardH}" rx="22" fill="${cardBg}" fill-opacity="${isLight ? '0.92' : '0.88'}" stroke="${cardStroke}" stroke-opacity="0.09" stroke-width="1.5" />
			<rect x="0" y="22" width="4" height="32" rx="2" fill="${accent}" />

			<text x="22" y="32" fill="${accent}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="11.5" font-weight="800" letter-spacing="1.2">${safeTitle}</text>
			<text x="22" y="53" fill="${textSecondary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="13" font-weight="600">${safeSub}</text>

			<g transform="translate(${cardW - 22}, 18)">
				<rect x="-112" y="0" width="112" height="36" rx="12" fill="${accent}" fill-opacity="0.15" stroke="${accent}" stroke-opacity="0.38" stroke-width="1.2" />
				<text x="-56" y="23" text-anchor="middle" fill="${textPrimary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="14" font-weight="700">Lv. ${track.level} &gt; ${track.level + 1}</text>
			</g>

			<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="7" fill="${trackBg}" stroke="${cardStroke}" stroke-opacity="0.06" />
			${fillW > 0 ? `<rect x="${barX}" y="${barY}" width="${fillW}" height="${barH}" rx="7" fill="url(#barGrad)" clip-path="url(#clip-${idSuffix})" />` : ''}
			<clipPath id="clip-${idSuffix}">
				<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="7" />
			</clipPath>

			<text x="22" y="114" fill="${textPrimary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="13" font-weight="700">${xpText}</text>
			${
				safeBadge
					? `<text x="${Math.round(cardW / 2)}" y="114" text-anchor="middle" fill="${textSecondary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="12" font-weight="700">${safeBadge}</text>`
					: ''
			}
			<text x="${cardW - 22}" y="114" text-anchor="end" fill="${accent}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="13" font-weight="800">${pctText}</text>
		</g>`;
	};

	const renderRolesFooter = () => {
		if (!hasRoles) return '';
		const currentLabel = opts.currentRole ? `@${truncateText(opts.currentRole.name, 22)} (Lv. ${opts.currentRole.level})` : 'None unlocked yet';
		const currentColor = opts.currentRole?.colorHex || textMuted;

		const nextLabel = opts.nextRole ? `@${truncateText(opts.nextRole.name, 22)} (Lv. ${opts.nextRole.level})` : 'All server level roles unlocked!';
		const nextColor = opts.nextRole?.colorHex || accent;

		return `
		<g transform="translate(32, 464)">
			<rect width="856" height="54" rx="18" fill="${cardBg}" fill-opacity="${isLight ? '0.92' : '0.88'}" stroke="${accent}" stroke-opacity="0.28" stroke-width="1.2" />
			<text x="22" y="32" fill="${accent}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="11.5" font-weight="800" letter-spacing="1.2">LEVEL ROLES</text>

			<g transform="translate(148, 13)">
				<rect width="328" height="28" rx="9" fill="${trackBg}" />
				<circle cx="16" cy="14" r="5" fill="${escapeXml(currentColor)}" />
				<text x="28" y="18.5" fill="${textSecondary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="11.5" font-weight="700">CURRENT:</text>
				<text x="94" y="18.5" fill="${textPrimary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="12" font-weight="800">${escapeXml(currentLabel)}</text>
			</g>

			<g transform="translate(496, 13)">
				<rect width="340" height="28" rx="9" fill="${trackBg}" />
				<circle cx="16" cy="14" r="5" fill="${escapeXml(nextColor)}" />
				<text x="28" y="18.5" fill="${textSecondary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="11.5" font-weight="700">NEXT:</text>
				<text x="72" y="18.5" fill="${textPrimary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="12" font-weight="800">${escapeXml(nextLabel)}</text>
			</g>
		</g>`;
	};

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">
	<defs>
		<linearGradient id="bgGrad" x1="0" y1="0" x2="${width}" y2="${height}" gradientUnits="userSpaceOnUse">
			<stop offset="0%" stop-color="${bgStart}" />
			<stop offset="55%" stop-color="${bgMid}" />
			<stop offset="100%" stop-color="${bgEnd}" />
		</linearGradient>
		<linearGradient id="barGrad" x1="0" y1="0" x2="1" y2="0">
			<stop offset="0%" stop-color="${accent}" stop-opacity="0.85" />
			<stop offset="100%" stop-color="${accent}" stop-opacity="1" />
		</linearGradient>
		<radialGradient id="accentGlow" cx="85%" cy="15%" r="65%">
			<stop offset="0%" stop-color="${accent}" stop-opacity="0.22" />
			<stop offset="100%" stop-color="${accent}" stop-opacity="0" />
		</radialGradient>
		<pattern id="dotMatrix" x="0" y="0" width="18" height="18" patternUnits="userSpaceOnUse">
			<circle cx="9" cy="9" r="1.35" fill="${accent}" fill-opacity="0.16" />
		</pattern>
		<clipPath id="avatarClip">
			<rect x="32" y="28" width="92" height="92" rx="24" />
		</clipPath>
	</defs>

	<!-- Outer Frame -->
	<rect width="${width - 4}" height="${height - 4}" x="2" y="2" rx="32" fill="url(#bgGrad)" stroke="${accent}" stroke-opacity="0.45" stroke-width="2.5" />
	<rect width="${width - 8}" height="${height - 8}" x="4" y="4" rx="30" fill="url(#accentGlow)" />
	<rect width="${width - 8}" height="136" x="4" y="4" rx="30" fill="url(#dotMatrix)" />

	<!-- Avatar -->
	<rect x="32" y="28" width="92" height="92" rx="24" fill="${cardBg}" stroke="${accent}" stroke-opacity="0.6" stroke-width="2.5" />
	${
		avatarDataUri
			? `<image href="${avatarDataUri}" x="32" y="28" width="92" height="92" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)" />`
			: `<text x="78" y="86" text-anchor="middle" fill="${accent}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="36" font-weight="800">${initial}</text>`
	}

	<!-- User Identity -->
	<text x="144" y="50" fill="${accent}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="11.5" font-weight="800" letter-spacing="1.8">XERNERX • VIRTUE PROGRESSION</text>
	<text x="144" y="84" fill="${textPrimary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="30" font-weight="800">${safeDisplayName}</text>
	<text x="144" y="109" fill="${textSecondary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="15" font-weight="600">${safeHandle}</text>

	<!-- Server Pill (Top Right) -->
	<g transform="translate(${width - 32}, 54)">
		<rect x="-240" y="0" width="240" height="40" rx="14" fill="${cardBg}" stroke="${cardStroke}" stroke-opacity="0.1" stroke-width="1.2" />
		<text x="-120" y="25" text-anchor="middle" fill="${textPrimary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="13.5" font-weight="700">${safeGuild}</text>
	</g>

	<!-- Divider -->
	<line x1="32" y1="140" x2="${width - 32}" y2="140" stroke="${cardStroke}" stroke-opacity="0.08" stroke-width="1.5" />

	<!-- 2x2 Progression Grid -->
	${renderTrackCard(opts.tracks.global, 32, 158, 'global')}
	${renderTrackCard(opts.tracks.server, 470, 158, 'server')}
	${renderTrackCard(opts.tracks.text, 32, 310, 'text')}
	${renderTrackCard(opts.tracks.voice, 470, 310, 'voice')}

	<!-- Optional Level Roles Bar -->
	${renderRolesFooter()}
</svg>`;

	return await renderSvgToPng(svg);
}

export interface LeaderboardEntryData {
	rank: number;
	userId: string;
	displayName: string;
	username: string;
	level: number;
	currentXp: number;
	nextXp: number;
	progress: number;
	statText: string;
	isCaller?: boolean;
}

export interface LeaderboardCardOptions {
	title: string;
	subtitle: string;
	iconUrl: string | null;
	accentHex: string;
	theme?: 'dark' | 'light';
	callerRankText: string;
	entries: LeaderboardEntryData[];
}

export async function renderLeaderboardCardPng(opts: LeaderboardCardOptions): Promise<Buffer> {
	const iconDataUri = await fetchAvatarDataUri(opts.iconUrl);
	const isLight = opts.theme === 'light';
	const accent = parseHexColor(opts.accentHex)?.colorHex || DEFAULT_XERNERX_HEX;

	const entries = opts.entries.slice(0, 10);
	const rowCount = Math.max(1, entries.length);
	const width = 920;
	const height = 160 + rowCount * 72 + 20;

	const bgStart = isLight ? '#f8fafc' : '#0b0e17';
	const bgMid = isLight ? '#f1f5f9' : '#101524';
	const bgEnd = isLight ? '#e2e8f0' : '#151c30';
	const cardBg = isLight ? '#ffffff' : '#141a2b';
	const cardStroke = isLight ? '#0f172a' : '#ffffff';
	const trackBg = isLight ? '#e2e8f0' : '#0b0f1a';
	const textPrimary = isLight ? '#0f172a' : '#f8fafc';
	const textSecondary = isLight ? '#475569' : '#94a3b8';

	const safeTitle = escapeXml(truncateText(opts.title || 'Leaderboard', 22));
	const safeSubtitle = escapeXml(truncateText(opts.subtitle || 'Top Progression Rankings', 46));
	const safeRankPill = escapeXml(truncateText(opts.callerRankText || 'LEADERBOARD', 22));
	const initial = escapeXml((opts.title || 'L').charAt(0).toUpperCase());

	const renderEntryCard = (entry: LeaderboardEntryData, x: number, y: number, idx: number) => {
		const cardW = 856;
		const cardH = 62;
		const rankColor = entry.rank === 1 ? '#f59e0b' : entry.rank === 2 ? '#94a3b8' : entry.rank === 3 ? '#d97706' : accent;
		const borderColor = entry.isCaller ? accent : cardStroke;
		const borderOpacity = entry.isCaller ? '0.55' : '0.09';

		const safeName = escapeXml(truncateText(entry.displayName || entry.username || 'User', 26));
		const safeHandle = escapeXml(truncateText(`@${entry.username || entry.userId}`, 28));
		const safeStat = escapeXml(truncateText(entry.statText, 36));
		const barX = 380;
		const barW = 348;
		const clampedPct = Math.max(0, Math.min(100, Number(entry.progress) || 0));
		const fillW = clampedPct > 0 ? Math.max(8, Math.round((clampedPct / 100) * barW)) : 0;

		return `
		<g transform="translate(${x}, ${y})">
			<rect width="${cardW}" height="${cardH}" rx="16" fill="${cardBg}" fill-opacity="${isLight ? '0.94' : '0.9'}" stroke="${borderColor}" stroke-opacity="${borderOpacity}" stroke-width="${entry.isCaller ? '2' : '1.4'}" />
			${entry.isCaller ? `<rect x="0" y="14" width="4" height="34" rx="2" fill="${accent}" />` : ''}

			<rect x="16" y="13" width="48" height="36" rx="11" fill="${rankColor}" fill-opacity="0.16" stroke="${rankColor}" stroke-opacity="0.45" stroke-width="1.2" />
			<text x="40" y="36" text-anchor="middle" fill="${rankColor}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="14" font-weight="800">#${entry.rank}</text>

			<text x="80" y="28" fill="${textPrimary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="15.5" font-weight="800">${safeName}</text>
			<text x="80" y="47" fill="${textSecondary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="12" font-weight="600">${safeHandle}</text>

			<text x="${barX}" y="26" fill="${textPrimary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="12.5" font-weight="700">${safeStat}</text>
			<text x="${barX + barW}" y="26" text-anchor="end" fill="${accent}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="12.5" font-weight="800">${clampedPct.toFixed(1)}%</text>

			<rect x="${barX}" y="36" width="${barW}" height="10" rx="5" fill="${trackBg}" />
			${fillW > 0 ? `<rect x="${barX}" y="36" width="${fillW}" height="10" rx="5" fill="${accent}" clip-path="url(#lb-clip-${idx})" />` : ''}
			<clipPath id="lb-clip-${idx}">
				<rect x="${barX}" y="36" width="${barW}" height="10" rx="5" />
			</clipPath>

			<rect x="748" y="13" width="92" height="36" rx="11" fill="${accent}" fill-opacity="0.15" stroke="${accent}" stroke-opacity="0.4" stroke-width="1.2" />
			<text x="794" y="36" text-anchor="middle" fill="${textPrimary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="13.5" font-weight="800">Lv. ${entry.level}</text>
		</g>`;
	};

	const entriesSvg = entries
		.map((entry, idx) => {
			const x = 32;
			const y = 160 + idx * 72;
			return renderEntryCard(entry, x, y, idx);
		})
		.join('');

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">
	<defs>
		<linearGradient id="bgGrad" x1="0" y1="0" x2="${width}" y2="${height}" gradientUnits="userSpaceOnUse">
			<stop offset="0%" stop-color="${bgStart}" />
			<stop offset="55%" stop-color="${bgMid}" />
			<stop offset="100%" stop-color="${bgEnd}" />
		</linearGradient>
		<radialGradient id="accentGlow" cx="85%" cy="15%" r="65%">
			<stop offset="0%" stop-color="${accent}" stop-opacity="0.22" />
			<stop offset="100%" stop-color="${accent}" stop-opacity="0" />
		</radialGradient>
		<pattern id="dotMatrix" x="0" y="0" width="18" height="18" patternUnits="userSpaceOnUse">
			<circle cx="9" cy="9" r="1.35" fill="${accent}" fill-opacity="0.16" />
		</pattern>
		<clipPath id="lbIconClip">
			<rect x="32" y="28" width="92" height="92" rx="24" />
		</clipPath>
	</defs>

	<rect width="${width - 4}" height="${height - 4}" x="2" y="2" rx="32" fill="url(#bgGrad)" stroke="${accent}" stroke-opacity="0.45" stroke-width="2.5" />
	<rect width="${width - 8}" height="${height - 8}" x="4" y="4" rx="30" fill="url(#accentGlow)" />
	<rect width="${width - 8}" height="136" x="4" y="4" rx="30" fill="url(#dotMatrix)" />

	<rect x="32" y="28" width="92" height="92" rx="24" fill="${cardBg}" stroke="${accent}" stroke-opacity="0.6" stroke-width="2.5" />
	${
		iconDataUri
			? `<image href="${iconDataUri}" x="32" y="28" width="92" height="92" preserveAspectRatio="xMidYMid slice" clip-path="url(#lbIconClip)" />`
			: `<text x="78" y="86" text-anchor="middle" fill="${accent}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="36" font-weight="800">${initial}</text>`
	}

	<text x="144" y="50" fill="${accent}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="11.5" font-weight="800" letter-spacing="1.8">XERNERX • VIRTUE LEADERBOARD</text>
	<text x="144" y="84" fill="${textPrimary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="30" font-weight="800">${safeTitle}</text>
	<text x="144" y="109" fill="${textSecondary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="14.5" font-weight="600">${safeSubtitle}</text>

	<g transform="translate(${width - 32}, 54)">
		<rect x="-240" y="0" width="240" height="40" rx="14" fill="${trackBg}" stroke="${accent}" stroke-opacity="0.4" stroke-width="1.2" />
		<text x="-120" y="25" text-anchor="middle" fill="${accent}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="13" font-weight="800">${safeRankPill}</text>
	</g>

	<line x1="32" y1="140" x2="${width - 32}" y2="140" stroke="${cardStroke}" stroke-opacity="0.08" stroke-width="1.5" />

	${entriesSvg}
</svg>`;

	return await renderSvgToPng(svg);
}

export interface RolesCardOptions {
	guildName: string;
	guildIconUrl: string | null;
	accentHex: string;
	theme?: 'dark' | 'light';
	userLevel: number;
	roles: LevelRoleSummary[];
}

export async function renderRolesCardPng(opts: RolesCardOptions): Promise<Buffer> {
	const iconDataUri = await fetchAvatarDataUri(opts.guildIconUrl);
	const isLight = opts.theme === 'light';
	const accent = parseHexColor(opts.accentHex)?.colorHex || DEFAULT_XERNERX_HEX;

	const roles = opts.roles.slice(0, 10);
	const rowCount = Math.max(1, roles.length);
	const width = 920;
	const height = 160 + rowCount * 72 + 20;

	const bgStart = isLight ? '#f8fafc' : '#0b0e17';
	const bgMid = isLight ? '#f1f5f9' : '#101524';
	const bgEnd = isLight ? '#e2e8f0' : '#151c30';
	const cardBg = isLight ? '#ffffff' : '#141a2b';
	const cardStroke = isLight ? '#0f172a' : '#ffffff';
	const trackBg = isLight ? '#e2e8f0' : '#0b0f1a';
	const textPrimary = isLight ? '#0f172a' : '#f8fafc';
	const textSecondary = isLight ? '#475569' : '#94a3b8';

	const getRoleUserLevel = (r: LevelRoleSummary) => (typeof r.userTrackLevel === 'number' ? r.userTrackLevel : opts.userLevel);
	const unlockedCount = opts.roles.filter((r) => getRoleUserLevel(r) >= r.level).length;
	const safeGuild = escapeXml(truncateText(opts.guildName || 'Discord Server', 22));
	const safePill = escapeXml(`LV. ${opts.userLevel} • ${unlockedCount}/${opts.roles.length} UNLOCKED`);
	const initial = escapeXml((opts.guildName || 'R').charAt(0).toUpperCase());

	const renderRoleCard = (role: LevelRoleSummary, x: number, y: number, idx: number) => {
		const cardW = 856;
		const cardH = 62;
		const currentLvl = getRoleUserLevel(role);
		const unlocked = currentLvl >= role.level;
		const trackLabel = role.track === 'text' ? 'Text Level' : role.track === 'voice' ? 'Voice Level' : 'Server Level';
		const trackShort = role.track === 'text' ? 'Text Lv.' : role.track === 'voice' ? 'Voice Lv.' : 'Lv.';
		const roleColor = parseHexColor(role.colorHex)?.colorHex || accent;
		const statusColor = unlocked ? '#34d399' : accent;
		const statusText = unlocked ? 'UNLOCKED' : `${Math.max(1, role.level - currentLvl)} LVL TO GO`;
		const pct = role.level > 0 ? Math.min(100, Math.round((currentLvl / role.level) * 100)) : 100;
		const barX = 380;
		const barW = 328;
		const fillW = pct > 0 ? Math.max(8, Math.round((pct / 100) * barW)) : 0;

		return `
		<g transform="translate(${x}, ${y})">
			<rect width="${cardW}" height="${cardH}" rx="16" fill="${cardBg}" fill-opacity="${isLight ? '0.94' : '0.9'}" stroke="${unlocked ? roleColor : cardStroke}" stroke-opacity="${unlocked ? '0.5' : '0.09'}" stroke-width="1.5" />
			<rect x="0" y="14" width="4" height="34" rx="2" fill="${roleColor}" />

			<circle cx="28" cy="24" r="7" fill="${roleColor}" />
			<text x="44" y="29" fill="${textPrimary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="15.5" font-weight="800">${escapeXml(truncateText(`@${role.name}`, 30))}</text>
			<text x="22" y="48" fill="${textSecondary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="12" font-weight="700">Requires ${trackLabel} ${role.level}</text>

			<text x="${barX}" y="26" fill="${textPrimary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="12.5" font-weight="700">${trackShort} ${currentLvl} / ${role.level}</text>
			<text x="${barX + barW}" y="26" text-anchor="end" fill="${statusColor}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="12.5" font-weight="800">${pct}%</text>

			<rect x="${barX}" y="36" width="${barW}" height="10" rx="5" fill="${trackBg}" />
			${fillW > 0 ? `<rect x="${barX}" y="36" width="${fillW}" height="10" rx="5" fill="${unlocked ? '#34d399' : roleColor}" clip-path="url(#role-clip-${idx})" />` : ''}
			<clipPath id="role-clip-${idx}">
				<rect x="${barX}" y="36" width="${barW}" height="10" rx="5" />
			</clipPath>

			<rect x="724" y="13" width="116" height="36" rx="11" fill="${statusColor}" fill-opacity="0.15" stroke="${statusColor}" stroke-opacity="0.4" stroke-width="1.2" />
			<text x="782" y="36" text-anchor="middle" fill="${textPrimary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="12" font-weight="800">${escapeXml(statusText)}</text>
		</g>`;
	};

	const rolesSvg = roles
		.map((role, idx) => {
			const x = 32;
			const y = 160 + idx * 72;
			return renderRoleCard(role, x, y, idx);
		})
		.join('');

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">
	<defs>
		<linearGradient id="bgGrad" x1="0" y1="0" x2="${width}" y2="${height}" gradientUnits="userSpaceOnUse">
			<stop offset="0%" stop-color="${bgStart}" />
			<stop offset="55%" stop-color="${bgMid}" />
			<stop offset="100%" stop-color="${bgEnd}" />
		</linearGradient>
		<radialGradient id="accentGlow" cx="85%" cy="15%" r="65%">
			<stop offset="0%" stop-color="${accent}" stop-opacity="0.22" />
			<stop offset="100%" stop-color="${accent}" stop-opacity="0" />
		</radialGradient>
		<pattern id="dotMatrix" x="0" y="0" width="18" height="18" patternUnits="userSpaceOnUse">
			<circle cx="9" cy="9" r="1.35" fill="${accent}" fill-opacity="0.16" />
		</pattern>
		<clipPath id="roleIconClip">
			<rect x="32" y="28" width="92" height="92" rx="24" />
		</clipPath>
	</defs>

	<rect width="${width - 4}" height="${height - 4}" x="2" y="2" rx="32" fill="url(#bgGrad)" stroke="${accent}" stroke-opacity="0.45" stroke-width="2.5" />
	<rect width="${width - 8}" height="${height - 8}" x="4" y="4" rx="30" fill="url(#accentGlow)" />
	<rect width="${width - 8}" height="136" x="4" y="4" rx="30" fill="url(#dotMatrix)" />

	<rect x="32" y="28" width="92" height="92" rx="24" fill="${cardBg}" stroke="${accent}" stroke-opacity="0.6" stroke-width="2.5" />
	${
		iconDataUri
			? `<image href="${iconDataUri}" x="32" y="28" width="92" height="92" preserveAspectRatio="xMidYMid slice" clip-path="url(#roleIconClip)" />`
			: `<text x="78" y="86" text-anchor="middle" fill="${accent}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="36" font-weight="800">${initial}</text>`
	}

	<text x="144" y="50" fill="${accent}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="11.5" font-weight="800" letter-spacing="1.8">XERNERX • VIRTUE LEVEL ROLES</text>
	<text x="144" y="84" fill="${textPrimary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="30" font-weight="800">${safeGuild}</text>
	<text x="144" y="109" fill="${textSecondary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="14.5" font-weight="600">Server role milestones unlocked automatically on level-up</text>

	<g transform="translate(${width - 32}, 54)">
		<rect x="-240" y="0" width="240" height="40" rx="14" fill="${trackBg}" stroke="${accent}" stroke-opacity="0.4" stroke-width="1.2" />
		<text x="-120" y="25" text-anchor="middle" fill="${accent}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="13" font-weight="800">${safePill}</text>
	</g>

	<line x1="32" y1="140" x2="${width - 32}" y2="140" stroke="${cardStroke}" stroke-opacity="0.08" stroke-width="1.5" />

	${rolesSvg}
</svg>`;

	return await renderSvgToPng(svg);
}

export interface SetupCardOptions {
	guildName: string;
	guildIconUrl: string | null;
	accentHex: string;
	theme?: 'dark' | 'light' | undefined;
	modeLabel: string;
	cooldownSeconds: number;
	cyclesLabel?: string | undefined;
	autoDeleteSeconds: number;
	levelUpEnabled: boolean;
	levelChannelName: string;
	levelMessageTemplate: string;
	levelRoles: LevelRoleSummary[];
	ignoredCount: number;
	bypassCount: number;
	untrackedCount: number;
}

export async function renderSetupCardPng(opts: SetupCardOptions): Promise<Buffer> {
	const iconDataUri = await fetchAvatarDataUri(opts.guildIconUrl);
	const isLight = opts.theme === 'light';
	const accent = parseHexColor(opts.accentHex)?.colorHex || DEFAULT_XERNERX_HEX;

	const width = 920;
	const height = 548;

	const bgStart = isLight ? '#f8fafc' : '#0b0e17';
	const bgMid = isLight ? '#f1f5f9' : '#101524';
	const bgEnd = isLight ? '#e2e8f0' : '#151c30';
	const cardBg = isLight ? '#ffffff' : '#141a2b';
	const cardStroke = isLight ? '#0f172a' : '#ffffff';
	const trackBg = isLight ? '#e2e8f0' : '#0b0f1a';
	const textPrimary = isLight ? '#0f172a' : '#f8fafc';
	const textSecondary = isLight ? '#475569' : '#94a3b8';

	const safeGuild = escapeXml(truncateText(opts.guildName || 'Discord Server', 22));
	const safeTemplate = escapeXml(truncateText(opts.levelMessageTemplate || '[@mention] reached level [@level] :tada:!', 68));
	const initial = escapeXml((opts.guildName || 'S').charAt(0).toUpperCase());

	const renderConfigBox = (title: string, badgeText: string, rows: Array<{ label: string; value: string; color?: string }>, x: number, y: number) => {
		const cardW = 418;
		const cardH = 138;
		const safeTitle = escapeXml(truncateText(title.toUpperCase(), 26));
		const safeBadge = escapeXml(truncateText(badgeText, 16));

		const rowsSvg = rows
			.slice(0, 3)
			.map((r, i) => {
				const rowY = 64 + i * 24;
				const valColor = r.color ? escapeXml(r.color) : textPrimary;
				return `
				<text x="22" y="${rowY}" fill="${textSecondary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="13" font-weight="600">${escapeXml(r.label)}</text>
				<text x="${cardW - 22}" y="${rowY}" text-anchor="end" fill="${valColor}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="13" font-weight="800">${escapeXml(truncateText(r.value, 28))}</text>`;
			})
			.join('');

		return `
		<g transform="translate(${x}, ${y})">
			<rect width="${cardW}" height="${cardH}" rx="22" fill="${cardBg}" fill-opacity="${isLight ? '0.92' : '0.88'}" stroke="${cardStroke}" stroke-opacity="0.09" stroke-width="1.5" />
			<rect x="0" y="20" width="4" height="28" rx="2" fill="${accent}" />

			<text x="22" y="34" fill="${accent}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="11.5" font-weight="800" letter-spacing="1.2">${safeTitle}</text>

			<g transform="translate(${cardW - 22}, 14)">
				<rect x="-126" y="0" width="126" height="30" rx="10" fill="${accent}" fill-opacity="0.15" stroke="${accent}" stroke-opacity="0.38" stroke-width="1.2" />
				<text x="-63" y="19.5" text-anchor="middle" fill="${textPrimary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="12" font-weight="800">${safeBadge}</text>
			</g>

			<line x1="22" y1="46" x2="${cardW - 22}" y2="46" stroke="${cardStroke}" stroke-opacity="0.06" stroke-width="1" />
			${rowsSvg}
		</g>`;
	};

	const autoDeleteLabel = opts.autoDeleteSeconds > 0 ? `${opts.autoDeleteSeconds}s` : 'Disabled';
	const roleRows =
		opts.levelRoles.length > 0
			? opts.levelRoles.slice(0, 3).map((r) => ({
					label: r.track === 'text' ? `Text Lv. ${r.level}` : r.track === 'voice' ? `Voice Lv. ${r.level}` : `Level ${r.level}`,
					value: `@${r.name}`,
					color: r.colorHex,
				}))
			: [
					{ label: 'Status', value: 'No level roles configured' },
					{ label: 'Assignment', value: 'Automatic on Level-Up' },
				];

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none">
	<defs>
		<linearGradient id="bgGrad" x1="0" y1="0" x2="${width}" y2="${height}" gradientUnits="userSpaceOnUse">
			<stop offset="0%" stop-color="${bgStart}" />
			<stop offset="55%" stop-color="${bgMid}" />
			<stop offset="100%" stop-color="${bgEnd}" />
		</linearGradient>
		<radialGradient id="accentGlow" cx="85%" cy="15%" r="65%">
			<stop offset="0%" stop-color="${accent}" stop-opacity="0.22" />
			<stop offset="100%" stop-color="${accent}" stop-opacity="0" />
		</radialGradient>
		<pattern id="dotMatrix" x="0" y="0" width="18" height="18" patternUnits="userSpaceOnUse">
			<circle cx="9" cy="9" r="1.35" fill="${accent}" fill-opacity="0.16" />
		</pattern>
		<clipPath id="iconClip">
			<rect x="32" y="28" width="92" height="92" rx="24" />
		</clipPath>
	</defs>

	<!-- Outer Frame -->
	<rect width="${width - 4}" height="${height - 4}" x="2" y="2" rx="32" fill="url(#bgGrad)" stroke="${accent}" stroke-opacity="0.45" stroke-width="2.5" />
	<rect width="${width - 8}" height="${height - 8}" x="4" y="4" rx="30" fill="url(#accentGlow)" />
	<rect width="${width - 8}" height="136" x="4" y="4" rx="30" fill="url(#dotMatrix)" />

	<!-- Guild Icon -->
	<rect x="32" y="28" width="92" height="92" rx="24" fill="${cardBg}" stroke="${accent}" stroke-opacity="0.6" stroke-width="2.5" />
	${
		iconDataUri
			? `<image href="${iconDataUri}" x="32" y="28" width="92" height="92" preserveAspectRatio="xMidYMid slice" clip-path="url(#iconClip)" />`
			: `<text x="78" y="86" text-anchor="middle" fill="${accent}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="36" font-weight="800">${initial}</text>`
	}

	<!-- Header Info -->
	<text x="144" y="50" fill="${accent}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="11.5" font-weight="800" letter-spacing="1.8">XERNERX • VIRTUE CONFIGURATION</text>
	<text x="144" y="84" fill="${textPrimary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="30" font-weight="800">${safeGuild}</text>
	<text x="144" y="109" fill="${textSecondary}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="14.5" font-weight="600">Server roles &amp; channels synced</text>

	<!-- Dashboard Pill (Top Right) -->
	<g transform="translate(${width - 32}, 54)">
		<rect x="-240" y="0" width="240" height="40" rx="14" fill="${trackBg}" stroke="${accent}" stroke-opacity="0.4" stroke-width="1.2" />
		<text x="-120" y="25" text-anchor="middle" fill="${accent}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="13" font-weight="800">DASHBOARD READY</text>
	</g>

	<!-- Divider -->
	<line x1="32" y1="140" x2="${width - 32}" y2="140" stroke="${cardStroke}" stroke-opacity="0.08" stroke-width="1.5" />

	<!-- 2x2 Configuration Grid -->
	${renderConfigBox(
		'Leveling Engine',
		opts.modeLabel,
		[
			{ label: 'Difficulty Curve', value: opts.modeLabel },
			{ label: 'XP Cooldown', value: `${opts.cooldownSeconds}s` },
			{ label: 'Reset Cycles', value: opts.cyclesLabel || 'Disabled' },
		],
		32,
		158
	)}
	${renderConfigBox(
		'Announcements',
		opts.levelUpEnabled ? 'Enabled' : 'Disabled',
		[
			{ label: 'Level-Up Alerts', value: opts.levelUpEnabled ? 'Enabled' : 'Disabled' },
			{ label: 'Target Channel', value: opts.levelChannelName },
			{ label: 'Auto-Delete Reply', value: autoDeleteLabel },
		],
		470,
		158
	)}
	${renderConfigBox('Level Roles', `${opts.levelRoles.length} Linked`, roleRows, 32, 310)}
	${renderConfigBox(
		'Channel & Role Filters',
		`${opts.ignoredCount + opts.bypassCount + opts.untrackedCount} Active`,
		[
			{ label: 'Ignored (No XP)', value: `${opts.ignoredCount} configured` },
			{ label: 'Tracked Whitelist', value: `${opts.untrackedCount} configured` },
			{ label: 'Cooldown Bypass', value: `${opts.bypassCount} configured` },
		],
		470,
		310
	)}

	<!-- Full-Width Message Template Card -->
	<g transform="translate(32, 464)">
		<rect width="856" height="54" rx="18" fill="${cardBg}" fill-opacity="${isLight ? '0.92' : '0.88'}" stroke="${accent}" stroke-opacity="0.28" stroke-width="1.2" />
		<text x="22" y="32" fill="${accent}" font-family="Fredoka, Segoe UI, Inter, system-ui, sans-serif" font-size="11.5" font-weight="800" letter-spacing="1.2">MESSAGE TEMPLATE</text>
		<g transform="translate(196, 11)">
			<rect width="640" height="32" rx="10" fill="${trackBg}" />
			<text x="16" y="21" fill="${textPrimary}" font-family="Consolas, monospace, Segoe UI, sans-serif" font-size="13" font-weight="700">${safeTemplate}</text>
		</g>
	</g>
</svg>`;

	return await renderSvgToPng(svg);
}
