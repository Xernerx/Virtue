/** @format */

import { SlashCommandBuilder } from '@xernerx/framework';
import { EmbedBuilder } from 'discord.js';

export default class SetupCommand extends SlashCommandBuilder {
	constructor() {
		super('setup', {
			name: 'setup',
			description: 'Setup your server with our dashboard.',
			permissions: {
				user: ['ManageGuild'],
			},
		});
	}

	override async exec({ interaction }: { interaction: any }) {
		const ws = (this.client as any).websocket;

		if (interaction.guild?.id) {
			const existing = await ws.get('virtue', 'guilds', { id: interaction.guild.id }).catch(() => null);

			if (!existing) {
				await ws.create('virtue', 'guilds', { id: interaction.guild.id }).catch(() => null);
			}
		}

		const url = `https://app.xernerx.com/dashboard?tab=virtue&guild=${interaction.guild.id}`;

		const embed = new EmbedBuilder()
			.setColor('#f2d9b6')
			.setTitle('Virtue Dashboard')
			.setURL(url)
			.setDescription(`This bot cannot be setup within the discord app. Click the [link](${url}) to configure the bot.`);

		interaction.util.reply({ embeds: [embed], ephemeral: true });
	}
}
