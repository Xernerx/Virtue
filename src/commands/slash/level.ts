/** @format */

import { SlashCommandBuilder, type SlashCommandOptions } from '@xernerx/framework';
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { renderLevelCardPng, resolveUserAccent, type LevelRoleSummary } from '../../lib/levelCard.js';
import { calculateLevel, checkUserServices, extractGuildLevelRoles, isServicesDisabledDoc, resolveUnifiedServerProgress } from '../../lib/levels.js';

function formatVoiceTime(totalSeconds: number): string {
	const secs = Math.max(0, Math.floor(Number(totalSeconds) || 0));
	if (secs < 60) return `${secs}s`;
	const totalMinutes = Math.floor(secs / 60);
	if (totalMinutes < 60) return `${totalMinutes}m`;
	const hours = Math.floor(totalMinutes / 60);
	const mins = totalMinutes % 60;
	return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export async function replyWithLevelCard(ws: any, interaction: any, target: any) {
	const guildId = interaction.guild?.id;
	const guildName = interaction.guild?.name || 'Server';

	const [rawUser, rawMember, rawText, rawVoice, guild, accent, serviceCheck] = await Promise.all([
		ws.get('xernerx', 'levels', { ownerId: target.id }).catch(() => null),
		ws.get('virtue', 'levels', { id: target.id, guild: guildId }).catch(() => null),
		ws.get('virtue', 'text', { id: target.id, guild: guildId }).catch(() => null),
		ws.get('virtue', 'voice', { id: target.id, guild: guildId }).catch(() => null),
		ws.get('virtue', 'guilds', { id: guildId }).catch(() => null),
		resolveUserAccent(ws, target.id, interaction.user.id),
		checkUserServices(ws, target.id, target),
	]);

	const user = isServicesDisabledDoc(rawUser) ? null : rawUser;
	const member = isServicesDisabledDoc(rawMember) ? null : rawMember;
	const text = isServicesDisabledDoc(rawText) ? null : rawText;
	const voice = isServicesDisabledDoc(rawVoice) ? null : rawVoice;

	if (!user && !member && !text && !voice) {
		const emptyEmbed = new EmbedBuilder()
			.setColor(accent.colorInt)
			.setDescription(
				!serviceCheck.services
					? target.id === interaction.user.id
						? 'You have Automatic Service Profiles disabled in your Xernerx Account settings, so Virtue is not tracking your XP.'
						: `**${target.globalName || target.username}** has Automatic Service Profiles disabled.`
					: target.id === interaction.user.id
						? 'You have not earned any XP yet — send a message or join a voice channel to start leveling up!'
						: `**${target.globalName || target.username}** has not earned any XP yet.`
			);

		return interaction.util.reply({
			embeds: [emptyEmbed],
			ephemeral: true,
		});
	}

	const mode = (guild?.mode || 'balanced') as 'easy' | 'casual' | 'balanced' | 'hard' | 'extreme';
	const resolvedServer = resolveUnifiedServerProgress(member, text, voice);

	const globalLevel = user?.level ?? 0;
	const globalXp = user?.xp ?? 0;
	const serverLevel = resolvedServer.level;
	const serverXp = resolvedServer.xp;
	const textLevel = text?.level ?? 0;
	const textXp = text?.xp ?? 0;
	const textMessages = text?.messages ?? 0;
	const voiceLevel = voice?.level ?? 0;
	const voiceXp = voice?.xp ?? 0;
	const voiceSeconds = voice?.timeSpent ?? 0;

	if (serviceCheck.allowed && guildId && (serverLevel > (Number(member?.level) || 0) || (serverLevel === (Number(member?.level) || 0) && serverXp > (Number(member?.xp) || 0)))) {
		ws.update('virtue', 'levels', { id: target.id, guild: guildId, level: serverLevel, xp: serverXp }).catch(() => null);
	}

	const globalNext = calculateLevel('balanced', globalLevel);
	const serverNext = calculateLevel(mode, serverLevel);
	const textNext = calculateLevel(mode, textLevel);
	const voiceNext = calculateLevel(mode, voiceLevel);

	const calcProgress = (current: number, next: number) => (next > 0 ? Math.min(100, Math.round((current / next) * 10000) / 100) : 0);

	const globalProgress = calcProgress(globalXp, globalNext);
	const serverProgress = calcProgress(serverXp, serverNext);
	const textProgress = calcProgress(textXp, textNext);
	const voiceProgress = calcProgress(voiceXp, voiceNext);

	const sortedRoles = extractGuildLevelRoles(guild);
	const isRoleUnlocked = (lr: { level: number; track: 'server' | 'text' | 'voice' }) => {
		const userLvl = lr.track === 'text' ? textLevel : lr.track === 'voice' ? voiceLevel : serverLevel;
		return Number(lr.level) <= userLvl;
	};
	const currentUnlockedRaw = [...sortedRoles].filter(isRoleUnlocked).pop();
	const nextRoleRaw = sortedRoles.find((lr) => !isRoleUnlocked(lr));

	const resolveRoleSummary = (entry?: { level: number; roleId: string; track?: 'server' | 'text' | 'voice' }): LevelRoleSummary | null => {
		if (!entry?.roleId) return null;
		const discordRole = interaction.guild?.roles?.cache?.get(entry.roleId);
		const syncedRole = Array.isArray(guild?.serverRoles) ? guild.serverRoles.find((r: any) => String(r.id) === String(entry.roleId)) : null;
		const name = discordRole?.name || syncedRole?.name || `Role ${entry.roleId}`;
		const rawColor = discordRole?.color ?? syncedRole?.color ?? 0;
		const colorHex = Number(rawColor) > 0 ? `#${Number(rawColor).toString(16).padStart(6, '0')}` : accent.colorHex;
		return {
			name,
			level: Number(entry.level),
			colorHex,
			track: entry.track,
		};
	};

	const currentRoleSummary = resolveRoleSummary(currentUnlockedRaw);
	const nextRoleSummary = resolveRoleSummary(nextRoleRaw);

	const displayName = target.globalName || target.username || 'User';
	const avatarUrl = typeof target.displayAvatarURL === 'function' ? target.displayAvatarURL({ extension: 'png', size: 256 }) : null;
	const voiceFormatted = formatVoiceTime(voiceSeconds);

	const pngBuffer = await renderLevelCardPng({
		displayName,
		username: target.username || displayName,
		avatarUrl,
		guildName,
		accentHex: accent.colorHex,
		theme: accent.theme,
		tracks: {
			global: {
				title: 'Global Level',
				subtitle: 'Xernerx Ecosystem (Unified)',
				level: globalLevel,
				currentXp: globalXp,
				nextXp: globalNext,
				progress: globalProgress,
			},
			server: {
				title: `${guildName} Level`,
				subtitle: 'Unified Server Progression',
				level: serverLevel,
				currentXp: serverXp,
				nextXp: serverNext,
				progress: serverProgress,
			},
			text: {
				title: 'Text Level',
				subtitle: 'Server Chat Progression',
				badge: `${textMessages.toLocaleString()} msgs`,
				level: textLevel,
				currentXp: textXp,
				nextXp: textNext,
				progress: textProgress,
			},
			voice: {
				title: 'Voice Level',
				subtitle: 'Server Voice Progression',
				badge: `${voiceFormatted} in VC`,
				level: voiceLevel,
				currentXp: voiceXp,
				nextXp: voiceNext,
				progress: voiceProgress,
			},
		},
		currentRole: currentRoleSummary,
		nextRole: nextRoleSummary,
	});

	const attachment = new AttachmentBuilder(pngBuffer, {
		name: 'level-progression.png',
	});

	const botUser = interaction.client.user;
	const botAvatar = botUser?.displayAvatarURL();
	const embed = new EmbedBuilder()
		.setColor(accent.colorInt)
		.setAuthor({
			name: `${displayName} • Level Progression`,
			url: `https://app.xernerx.com/users/${target.id}`,
			...(avatarUrl ? { iconURL: avatarUrl } : {}),
		})
		.setImage('attachment://level-progression.png')
		.setFooter({
			text: `${botUser?.username || 'Virtue'}`,
			...(botAvatar ? { iconURL: botAvatar } : {}),
		})
		.setTimestamp();

	return interaction.util.reply({
		embeds: [embed],
		files: [attachment],
		ephemeral: true,
	});
}

export default class LevelCommand extends SlashCommandBuilder {
	constructor() {
		super('level', {
			name: 'level',
			description: 'View your levels and progression card.',
			defer: true,
			options: [
				{
					type: 'user',
					name: 'user',
					description: 'Select a user to view their level progression.',
				},
			],
			permissions: {
				user: ['SendMessages'],
			},
		});
	}

	override async exec({ interaction, options }: SlashCommandOptions) {
		const ws = (this.client as any).websocket;
		const target = (options?.user as any)?.user || (interaction.options as any)?.getUser?.('user') || interaction.user;
		return replyWithLevelCard(ws, interaction, target);
	}
}
