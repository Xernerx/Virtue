/** @format */

import { SlashCommandBuilder } from '@xernerx/framework';
import { EmbedBuilder } from 'discord.js';
import { calculateLevel } from '../../lib/levels.js';

export default class LevelCommand extends SlashCommandBuilder {
	constructor() {
		super('level', {
			name: 'level',
			description: 'View your levels.',
			permissions: {
				user: ['SendMessages'],
			},
		});
	}

	override async exec({ interaction }: { interaction: any }) {
		const ws = (this.client as any).websocket;

		const user = await ws.get('virtue', 'users', { id: interaction.user.id });
		const member = await ws.get('virtue', 'members', { id: interaction.user.id, guild: interaction.guild.id });
		const guild = await ws.get('virtue', 'guilds', { id: interaction.guild.id });

		const settings = guild._doc;

		if (!user) return interaction.util.reply({ content: 'You have never sent a message where I can see it... Why?', ephemeral: true });

		const levels = {
			global: { next: calculateLevel('balanced', user._doc.textLevel), current: user._doc.textExperience, progress: 0 },
			local: { next: calculateLevel(settings.mode, member._doc.textLevel || 0), current: member._doc.textExperience || 0, progress: 0 },
		};

		levels.global.progress = Math.round((levels.global.current / levels.global.next) * 10000) / 100;
		levels.local.progress = Math.round((levels.local.current / levels.local.next) * 10000) / 100;

		const makeBar = (progress: number, size = 10) => {
			const filled = Math.round((progress / 100) * size);
			const empty = size - filled;

			return `\`${'█'.repeat(filled)}${'░'.repeat(empty)}\``;
		};

		const embed = new EmbedBuilder()
			.setColor('#f2d9b6')
			.setTitle('Level overview')
			.addFields([
				{
					name: 'Global Level',
					value: [
						`**${user._doc.textLevel}** ${makeBar(levels.global.progress)} **${user._doc.textLevel + 1}**`,
						`XP: \`${levels.global.current}/${levels.global.next}\` (${levels.global.progress}%)`,
					].join('\n'),
				},
			]);

		if (member) {
			embed.addFields([
				{
					name: `${interaction.guild.name} Level`,
					value: [
						`**${member._doc.textLevel || 0}** ${makeBar(levels.local.progress)} **${(member._doc.textLevel || 0) + 1}**`,
						`XP: \`${levels.local.current}/${levels.local.next}\` (${levels.local.progress}%)`,
					].join('\n'),
				},
			]);
		}

		interaction.util.reply({ embeds: [embed], ephemeral: true });
	}
}
