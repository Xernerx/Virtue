/** @format */

import { SlashCommandBuilder, type SlashCommandOptions } from '@xernerx/framework';
import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { syncGuildMetadata } from '../../lib/guildSync.js';
import { renderSetupCardPng, resolveUserAccent, type LevelRoleSummary } from '../../lib/levelCard.js';
import { extractGuildLevelRoles } from '../../lib/levels.js';

const cooldowns: Record<string, number> = {
	easy: 30,
	casual: 45,
	balanced: 60,
	hard: 120,
	extreme: 300,
};

export default class SetupCommand extends SlashCommandBuilder {
	constructor() {
		super('setup', {
			name: 'setup',
			description: 'Configure Virtue for your server with the Xernerx Dashboard.',
			defer: true,
			permissions: {
				user: ['ManageGuild'],
			},
		});
	}

	override async exec({ interaction }: SlashCommandOptions) {
		const ws = (this.client as any).websocket;
		const guildId = interaction.guild?.id;
		const guildName = interaction.guild?.name || 'Discord Server';

		if (interaction.guild) {
			await syncGuildMetadata(ws, interaction.guild);
		}

		const [accent, guild] = await Promise.all([resolveUserAccent(ws, interaction.user.id), guildId ? ws.get('virtue', 'guilds', { id: guildId }).catch(() => null) : Promise.resolve(null)]);

		const url = guildId ? `https://app.xernerx.com/dashboard?tab=virtue&guild=${guildId}` : 'https://app.xernerx.com/dashboard';
		const botUser = interaction.client.user;
		const botAvatar = botUser?.displayAvatarURL({ extension: 'png', size: 256 }) || null;
		const guildIcon = interaction.guild?.iconURL({ extension: 'png', size: 256 }) || botAvatar;

		const modeRaw = String(guild?.mode || 'balanced').toLowerCase();
		const modeLabel = modeRaw.charAt(0).toUpperCase() + modeRaw.slice(1);
		const cooldownSeconds = cooldowns[modeRaw] ?? 60;
		const autoDeleteSeconds = Number(guild?.autoDelete) || 0;
		const levelUpEnabled = guild?.levelUp !== false;

		let levelChannelName = 'Current Channel (Reply)';
		if (guild?.levelChannel) {
			const discordCh = interaction.guild?.channels?.cache?.get(guild.levelChannel);
			const syncedCh = Array.isArray(guild?.serverChannels) ? guild.serverChannels.find((c: any) => String(c.id) === String(guild.levelChannel)) : null;
			const chName = discordCh?.name || syncedCh?.name;
			levelChannelName = chName ? `#${chName}` : `#${guild.levelChannel}`;
		}

		const levelMessageTemplate = String(guild?.levelMessage || '[@mention] reached level [@level] :tada:!');

		const rawLevelRoles = extractGuildLevelRoles(guild);

		const levelRoles: LevelRoleSummary[] = rawLevelRoles.map((entry) => {
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
		});

		const ignoredCount =
			(Array.isArray(guild?.roles?.ignored) ? guild.roles.ignored.length : 0) +
			(Array.isArray(guild?.channels?.ignored) ? guild.channels.ignored.length : 0) +
			(Array.isArray(guild?.ignored?.channels) ? guild.ignored.channels.length : 0) +
			(Array.isArray(guild?.ignored?.roles) ? guild.ignored.roles.length : 0);
		const bypassCount = (Array.isArray(guild?.bypass?.channels) ? guild.bypass.channels.length : 0) + (Array.isArray(guild?.bypass?.roles) ? guild.bypass.roles.length : 0);
		const untrackedCount =
			(Array.isArray(guild?.roles?.tracked) ? guild.roles.tracked.length : 0) +
			(Array.isArray(guild?.channels?.tracked) ? guild.channels.tracked.length : 0) +
			(Array.isArray(guild?.untracked?.channels) ? guild.untracked.channels.length : 0) +
			(Array.isArray(guild?.untracked?.roles) ? guild.untracked.roles.length : 0);
		const activeCycles = (['daily', 'weekly', 'monthly'] as const).filter((k) => Boolean(guild?.cycles?.[k])).map((k) => k.charAt(0).toUpperCase() + k.slice(1));
		const cyclesLabel = activeCycles.length > 0 ? activeCycles.join(', ') : 'Disabled';

		const pngBuffer = await renderSetupCardPng({
			guildName,
			guildIconUrl: guildIcon,
			accentHex: accent.colorHex,
			theme: accent.theme,
			modeLabel,
			cooldownSeconds,
			cyclesLabel,
			autoDeleteSeconds,
			levelUpEnabled,
			levelChannelName,
			levelMessageTemplate,
			levelRoles,
			ignoredCount,
			bypassCount,
			untrackedCount,
		});

		const attachment = new AttachmentBuilder(pngBuffer, {
			name: 'server-setup.png',
		});

		const embed = new EmbedBuilder()
			.setColor(accent.colorInt)
			.setAuthor({
				name: `${botUser?.username || 'Virtue'} • Server Setup`,
				url,
				...(botAvatar ? { iconURL: botAvatar } : {}),
			})
			.setImage('attachment://server-setup.png')
			.setFooter({
				text: `${botUser?.username || 'Virtue'}`,
				...(botAvatar ? { iconURL: botAvatar } : {}),
			})
			.setTimestamp();

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setLabel('Open Dashboard').setURL(url).setStyle(ButtonStyle.Link),
			new ButtonBuilder().setLabel('Support').setURL('https://www.xernerx.com/support').setStyle(ButtonStyle.Link)
		);

		return interaction.util.reply({
			embeds: [embed],
			files: [attachment],
			components: [row],
			ephemeral: true,
		});
	}
}
