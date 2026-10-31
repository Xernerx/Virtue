/** @format */

import { SlashCommandBuilder, type SlashCommandOptions } from '@xernerx/framework';
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { renderLeaderboardCardPng, resolveUserAccent, type LeaderboardEntryData } from '../../lib/levelCard.js';
import { calculateLevel } from '../../lib/levels.js';

function formatVoiceTime(totalSeconds: number): string {
	const secs = Math.max(0, Math.floor(Number(totalSeconds) || 0));
	if (secs < 60) return `${secs}s`;
	const totalMinutes = Math.floor(secs / 60);
	if (totalMinutes < 60) return `${totalMinutes}m`;
	const hours = Math.floor(totalMinutes / 60);
	const mins = totalMinutes % 60;
	return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export default class LeaderboardCommand extends SlashCommandBuilder {
	constructor() {
		super('leaderboard', {
			name: 'leaderboard',
			description: 'View the server or global level leaderboard.',
			defer: true,
			options: [
				{
					type: 'string',
					name: 'track',
					description: 'Select which leaderboard track to display.',
					choices: [
						{ name: 'Server Level (Unified)', value: 'server' },
						{ name: 'Text Level', value: 'text' },
						{ name: 'Voice Level', value: 'voice' },
						{ name: 'Global Level (Xernerx)', value: 'global' },
					],
				},
			],
			permissions: {
				user: ['SendMessages'],
			},
		});
	}

	override async exec({ interaction, options }: SlashCommandOptions) {
		const ws = (this.client as any).websocket;
		const guildId = interaction.guild?.id;
		const guildName = interaction.guild?.name || 'Server';
		const trackRaw = String((options?.track as any)?.value || (interaction.options as any)?.getString?.('track') || 'server').toLowerCase();
		const track = (['server', 'text', 'voice', 'global'].includes(trackRaw) ? trackRaw : 'server') as 'server' | 'text' | 'voice' | 'global';

		const [accent, guild, rawEntries] = await Promise.all([
			resolveUserAccent(ws, interaction.user.id),
			guildId ? ws.get('virtue', 'guilds', { id: guildId }).catch(() => null) : Promise.resolve(null),
			track === 'global'
				? ws.get('xernerx', 'levels', { limit: 100 }).catch(() => [])
				: ws
						.get('virtue', track === 'server' ? 'levels' : track, {
							guild: guildId,
							limit: 100,
						})
						.catch(() => []),
		]);

		const list: any[] = Array.isArray(rawEntries)
			? rawEntries
			: Array.isArray(rawEntries?.entries)
				? rawEntries.entries
				: rawEntries && typeof rawEntries === 'object'
					? rawEntries.id || rawEntries.ownerId
						? [rawEntries]
						: Object.values(rawEntries)
					: [];
		const sorted = [...list]
			.filter((doc) => doc && typeof doc === 'object' && (doc.id || doc.ownerId))
			.sort((a, b) => Number(b.level || 0) - Number(a.level || 0) || Number(b.xp || 0) - Number(a.xp || 0));

		if (sorted.length === 0) {
			const emptyEmbed = new EmbedBuilder().setColor(accent.colorInt).setDescription('No leaderboard entries found for this track yet — start chatting or join a voice channel to earn XP!');

			return interaction.util.reply({
				embeds: [emptyEmbed],
				ephemeral: true,
			});
		}

		const mode = (track === 'global' ? 'balanced' : guild?.mode || 'balanced') as 'easy' | 'casual' | 'balanced' | 'hard' | 'extreme';
		const callerIdx = sorted.findIndex((doc) => String(doc.id || doc.ownerId) === interaction.user.id);
		const callerRankText = callerIdx >= 0 ? `YOUR RANK: #${callerIdx + 1} OF ${sorted.length}` : `TOP ${Math.min(10, sorted.length)} OF ${sorted.length}`;

		const topTen = sorted.slice(0, 10);
		const entries: LeaderboardEntryData[] = await Promise.all(
			topTen.map(async (doc, idx) => {
				const uid = String(doc.id || doc.ownerId);
				const cachedUser = interaction.client.users.cache.get(uid) || (await interaction.client.users.fetch(uid).catch(() => null));
				const displayName = cachedUser?.globalName || cachedUser?.username || `User ${uid.slice(-4)}`;
				const username = cachedUser?.username || uid;
				const level = Number(doc.level) || 0;
				const currentXp = Number(doc.xp) || 0;
				const nextXp = calculateLevel(mode, level);
				const progress = nextXp > 0 ? Math.min(100, Math.round((currentXp / nextXp) * 10000) / 100) : 0;

				let statText = `${currentXp.toLocaleString()} / ${nextXp.toLocaleString()} XP`;
				if (track === 'text' && typeof doc.messages === 'number') {
					statText = `${doc.messages.toLocaleString()} msgs • ${currentXp.toLocaleString()} XP`;
				} else if (track === 'voice' && typeof doc.timeSpent === 'number') {
					statText = `${formatVoiceTime(doc.timeSpent)} • ${currentXp.toLocaleString()} XP`;
				}

				return {
					rank: idx + 1,
					userId: uid,
					displayName,
					username,
					level,
					currentXp,
					nextXp,
					progress,
					statText,
					isCaller: uid === interaction.user.id,
				};
			})
		);

		const titleMap = {
			server: `${guildName} Leaderboard`,
			text: `${guildName} Text Leaderboard`,
			voice: `${guildName} Voice Leaderboard`,
			global: 'Global Leaderboard',
		};

		const subtitleMap = {
			server: 'Unified Server Level Rankings (Text + Voice)',
			text: 'Server Text Chat Progression Rankings',
			voice: 'Server Voice Channel Progression Rankings',
			global: 'Unified Xernerx Ecosystem Progression Rankings',
		};

		const botUser = interaction.client.user;
		const botAvatar = botUser?.displayAvatarURL({ extension: 'png', size: 256 }) || null;
		const guildIcon = track === 'global' ? botAvatar : interaction.guild?.iconURL({ extension: 'png', size: 256 }) || botAvatar;

		const pngBuffer = await renderLeaderboardCardPng({
			title: titleMap[track],
			subtitle: subtitleMap[track],
			iconUrl: guildIcon,
			accentHex: accent.colorHex,
			theme: accent.theme,
			callerRankText,
			entries,
		});

		const attachment = new AttachmentBuilder(pngBuffer, {
			name: 'leaderboard.png',
		});

		const leaderboardUrl =
			track === 'global' || !guildId ? 'https://app.xernerx.com/leaderboard?tab=levels&track=global' : `https://app.xernerx.com/leaderboard?tab=levels&guild=${guildId}&track=${track}`;

		const embed = new EmbedBuilder()
			.setColor(accent.colorInt)
			.setAuthor({
				name: `${titleMap[track]} • Virtue`,
				url: leaderboardUrl,
				...(botAvatar ? { iconURL: botAvatar } : {}),
			})
			.setImage('attachment://leaderboard.png')
			.setFooter({
				text: `${botUser?.username || 'Virtue'}`,
				...(botAvatar ? { iconURL: botAvatar } : {}),
			})
			.setTimestamp();

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setLabel('View Full Leaderboard').setURL(leaderboardUrl).setStyle(ButtonStyle.Link));

		return interaction.util.reply({
			embeds: [embed],
			files: [attachment],
			components: [row],
			ephemeral: true,
		});
	}
}
