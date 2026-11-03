/** @format */

import { SlashCommandBuilder, type SlashCommandOptions } from '@xernerx/framework';
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { renderRolesCardPng, resolveUserAccent, type LevelRoleSummary } from '../../lib/levelCard.js';
import { extractGuildLevelRoles, isServicesDisabledDoc, resolveUnifiedServerProgress } from '../../lib/levels.js';

export default class RolesCommand extends SlashCommandBuilder {
	constructor() {
		super('roles', {
			name: 'roles',
			description: 'View all level roles configured on this server and your unlock progress.',
			defer: true,
			permissions: {
				user: ['SendMessages'],
			},
		});
	}

	override async exec({ interaction }: SlashCommandOptions) {
		const ws = (this.client as any).websocket;
		const guildId = interaction.guild?.id;
		const guildName = interaction.guild?.name || 'Discord Server';

		const [accent, guild, rawMember, rawText, rawVoice] = await Promise.all([
			resolveUserAccent(ws, interaction.user.id),
			guildId ? ws.get('virtue', 'guilds', { id: guildId }).catch(() => null) : Promise.resolve(null),
			guildId ? ws.get('virtue', 'levels', { id: interaction.user.id, guild: guildId }).catch(() => null) : Promise.resolve(null),
			guildId ? ws.get('virtue', 'text', { id: interaction.user.id, guild: guildId }).catch(() => null) : Promise.resolve(null),
			guildId ? ws.get('virtue', 'voice', { id: interaction.user.id, guild: guildId }).catch(() => null) : Promise.resolve(null),
		]);

		const member = isServicesDisabledDoc(rawMember) ? null : rawMember;
		const text = isServicesDisabledDoc(rawText) ? null : rawText;
		const voice = isServicesDisabledDoc(rawVoice) ? null : rawVoice;

		const resolvedServer = resolveUnifiedServerProgress(member, text, voice);
		const serverLevel = resolvedServer.level;
		const textLevel = Number(text?.level) || 0;
		const voiceLevel = Number(voice?.level) || 0;

		const rawLevelRoles = extractGuildLevelRoles(guild);

		const sortedRoles: LevelRoleSummary[] = rawLevelRoles.map((entry) => {
			const discordRole = interaction.guild?.roles?.cache?.get(entry.roleId);
			const syncedRole = Array.isArray(guild?.serverRoles) ? guild.serverRoles.find((r: any) => String(r.id) === String(entry.roleId)) : null;
			const name = discordRole?.name || syncedRole?.name || `Role ${entry.roleId}`;
			const rawColor = discordRole?.color ?? syncedRole?.color ?? 0;
			const colorHex = Number(rawColor) > 0 ? `#${Number(rawColor).toString(16).padStart(6, '0')}` : accent.colorHex;
			const userTrackLevel = entry.track === 'text' ? textLevel : entry.track === 'voice' ? voiceLevel : serverLevel;
			return {
				name,
				level: Number(entry.level),
				colorHex,
				track: entry.track,
				userTrackLevel,
			};
		});

		if (sortedRoles.length === 0) {
			const emptyEmbed = new EmbedBuilder().setColor(accent.colorInt).setDescription(`**${guildName}** does not have any level roles configured yet.`);

			return interaction.util.reply({
				embeds: [emptyEmbed],
				ephemeral: true,
			});
		}

		const userLevel = serverLevel;

		const botUser = interaction.client.user;
		const botAvatar = botUser?.displayAvatarURL({ extension: 'png', size: 256 }) || null;
		const guildIcon = interaction.guild?.iconURL({ extension: 'png', size: 256 }) || botAvatar;

		const pngBuffer = await renderRolesCardPng({
			guildName,
			guildIconUrl: guildIcon,
			accentHex: accent.colorHex,
			theme: accent.theme,
			userLevel,
			roles: sortedRoles,
		});

		const attachment = new AttachmentBuilder(pngBuffer, {
			name: 'level-roles.png',
		});

		const embed = new EmbedBuilder()
			.setColor(accent.colorInt)
			.setAuthor({
				name: `${guildName} • Level Roles`,
				...(guildIcon ? { iconURL: guildIcon } : {}),
			})
			.setImage('attachment://level-roles.png')
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
}
