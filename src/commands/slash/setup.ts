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
		const embed = new EmbedBuilder()
			.setColor('#f2d9b6')
			.setTitle('Virtue Dashboard')
			.setURL(`https://app.xernerx.com/dashboard?view=virtue&guild=${interaction.guild.id}`)
			.setDescription(`This bot cannot be setup within the discord app. Click the [link](https://app.xernerx.com/dashboard?view=virtue&guild=${interaction.guild.id}) to configure the bot.`);

		interaction.util.reply({ embeds: [embed], ephemeral: true });
	}
}
