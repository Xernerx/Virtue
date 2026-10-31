/** @format */

import { readFileSync } from 'node:fs';
import { SlashCommandBuilder, type SlashCommandOptions } from '@xernerx/framework';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, version as djsVersion } from 'discord.js';
import { resolveUserAccent } from '../../lib/levelCard.js';

function getVersions(): { bot: string; framework: string } {
	let bot = '2.0.0';
	let framework = '1.1.1';

	try {
		const raw = readFileSync(new URL('../../../package.json', import.meta.url), 'utf8');
		const pkg = JSON.parse(raw);
		if (pkg?.version) bot = pkg.version;
		if (pkg?.dependencies?.['@xernerx/framework']) {
			framework = String(pkg.dependencies['@xernerx/framework']).replace(/^[\^~]/, '');
		}
	} catch {}

	try {
		const fwRaw = readFileSync(new URL('../../../node_modules/@xernerx/framework/package.json', import.meta.url), 'utf8');
		const fwPkg = JSON.parse(fwRaw);
		if (fwPkg?.version) framework = fwPkg.version;
	} catch {}

	return { bot, framework };
}

const VERSIONS = getVersions();

export default class InfoCommand extends SlashCommandBuilder {
	constructor() {
		super('info', {
			name: 'info',
			description: 'View information and statistics about Virtue.',
			permissions: {
				user: ['SendMessages'],
			},
		});
	}

	override async exec({ interaction }: SlashCommandOptions) {
		const ws = (this.client as any).websocket;
		const rawOwners = (this.client as any).owners ?? this.client.settings?.owners ?? [];
		const ownerIds: string[] = Array.isArray(rawOwners) ? rawOwners : rawOwners ? [String(rawOwners)] : [];

		const [accent, ownerUsers] = await Promise.all([
			resolveUserAccent(ws, interaction.user.id),
			Promise.all(
				ownerIds.map(async (id) => {
					const u = interaction.client.users.cache.get(id) || (await interaction.client.users.fetch(id).catch(() => null));
					return u?.username || id;
				})
			),
		]);

		const leadDeveloper = ownerUsers[0] || 'dummiii';
		const developers = ownerUsers.length > 0 ? ownerUsers.join(', ') : leadDeveloper;

		const botUser = interaction.client.user;
		const botAvatar = botUser?.displayAvatarURL({ extension: 'png', size: 256 });

		const guilds = interaction.client.guilds.cache;
		const guildCount = guilds.size;
		const userCount = guilds.reduce((acc, g) => acc + (g.memberCount || 0), 0) || interaction.client.users.cache.size;

		const ping = Math.max(0, Math.round(interaction.client.ws.ping));
		const rssMiB = (process.memoryUsage().rss / 1048576).toFixed(1);
		const startedUnix = Math.round(Date.now() / 1000 - process.uptime());

		const dashboardUrl = interaction.guild?.id ? `https://app.xernerx.com/dashboard?tab=virtue&guild=${interaction.guild.id}` : 'https://app.xernerx.com/dashboard';

		const embed = new EmbedBuilder()
			.setColor(accent.colorInt)
			.setAuthor({
				name: `${botUser?.username || 'Virtue'} • Bot Information`,
				url: 'https://www.xernerx.com',
			})
			.setDescription(
				'**Virtue** is the official leveling and progression bot by **Xernerx Studios**, tracking unified Global, Server, Text, and Voice XP alongside customizable level roles and leaderboards.'
			)
			.addFields([
				{
					name: 'Statistics',
					value: [`**Servers:** \`${guildCount.toLocaleString()}\``, `**Users:** \`${userCount.toLocaleString()}\``].join('\n'),
					inline: true,
				},
				{
					name: 'Runtime',
					value: [`**Latency:** \`${ping}ms\``, `**Memory:** \`${rssMiB} MB\``, `**Uptime:** <t:${startedUnix}:R>`].join('\n'),
					inline: true,
				},
				{
					name: 'System',
					value: [`**Version:** \`v${VERSIONS.bot}\``, `**Xernerx:** \`v${VERSIONS.framework}\``, `**Discord.js:** \`v${djsVersion}\``, `**Node.js:** \`${process.version}\``].join('\n'),
					inline: true,
				},
				{
					name: 'Credits',
					value: [`**Lead Developer:** ${leadDeveloper}`, `**Developers:** ${developers}`, '**Publisher:** [Xernerx Studios](https://www.xernerx.com)'].join('\n'),
					inline: false,
				},
			])
			.setFooter({
				text: `© ${new Date().getFullYear()} Xernerx Studios. All rights reserved`,
				iconURL: 'https://xernerx.com/logo.png',
			});

		if (botAvatar) {
			embed.setThumbnail(botAvatar);
		}

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setLabel('Dashboard').setURL(dashboardUrl).setStyle(ButtonStyle.Link),
			new ButtonBuilder().setLabel('Website').setURL('https://www.xernerx.com').setStyle(ButtonStyle.Link),
			new ButtonBuilder().setLabel('Support').setURL('https://www.xernerx.com/support').setStyle(ButtonStyle.Link),
			new ButtonBuilder().setLabel('Terms').setURL('https://www.xernerx.com/terms').setStyle(ButtonStyle.Link),
			new ButtonBuilder().setLabel('Privacy').setURL('https://www.xernerx.com/privacy').setStyle(ButtonStyle.Link)
		);

		return interaction.util.reply({
			embeds: [embed],
			components: [row],
			ephemeral: true,
		});
	}
}
