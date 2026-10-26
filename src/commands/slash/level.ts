/** @format */

import { SlashCommandBuilder, type SlashCommandOptions } from '@xernerx/framework';
import { ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { calculateLevel } from '../../lib/levels.js';

export default class LevelCommand extends SlashCommandBuilder {
	constructor() {
		super('level', {
			name: 'level',
			description: 'View your levels.',
			options: [
				{
					type: 'user',
					name: 'user',
					description: 'user',
				},
			],
			permissions: {
				user: ['SendMessages'],
			},
		});
	}

	override async exec({ interaction, options }: SlashCommandOptions) {
		const ws = (this.client as any).websocket;

		const target = (options?.user as any)?.user || (interaction.user as any);

		const [user, member, text, voice, guild] = await Promise.all([
			ws.get('xernerx', 'levels', { ownerId: target.id }).catch(() => null),
			ws.get('virtue', 'levels', { id: target.id, guild: interaction.guild?.id }).catch(() => null),
			ws.get('virtue', 'text', { id: target.id, guild: interaction.guild?.id }).catch(() => null),
			ws.get('virtue', 'voice', { id: target.id, guild: interaction.guild?.id }).catch(() => null),
			ws.get('virtue', 'guilds', { id: interaction.guild?.id }).catch(() => null),
		]);

		if (!user && !member && !text && !voice)
			return interaction.util.reply({
				content: 'You have never sent a message where I can see it... Why?',
				ephemeral: true,
			});

		const mode = guild?.mode || 'balanced';
		const globalLevel = user?.level ?? 0;
		const globalXp = user?.xp ?? 0;
		const serverLevel = member?.level ?? 0;
		const serverXp = member?.xp ?? 0;
		const textLevel = text?.level ?? 0;
		const textXp = text?.xp ?? 0;
		const voiceLevel = voice?.level ?? 0;
		const voiceXp = voice?.xp ?? 0;

		const levels = {
			global: {
				next: calculateLevel('balanced', globalLevel),
				current: globalXp,
				progress: 0,
			},
			server: {
				next: calculateLevel(mode, serverLevel),
				current: serverXp,
				progress: 0,
			},
			text: {
				next: calculateLevel(mode, textLevel),
				current: textXp,
				progress: 0,
			},
			voice: {
				next: calculateLevel(mode, voiceLevel),
				current: voiceXp,
				progress: 0,
			},
		};

		levels.global.progress = Math.round((levels.global.current / levels.global.next) * 10000) / 100;
		levels.server.progress = Math.round((levels.server.current / levels.server.next) * 10000) / 100;
		levels.text.progress = Math.round((levels.text.current / levels.text.next) * 10000) / 100;
		levels.voice.progress = Math.round((levels.voice.current / levels.voice.next) * 10000) / 100;

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
					value: [`**${globalLevel}** ${makeBar(levels.global.progress)} **${globalLevel + 1}**`, `XP: \`${levels.global.current}/${levels.global.next}\` (${levels.global.progress}%)`].join('\n'),
				},
			]);

		if (member) {
			embed.addFields([
				{
					name: `${interaction.guild?.name} Level`,
					value: [`**${serverLevel}** ${makeBar(levels.server.progress)} **${serverLevel + 1}**`, `XP: \`${levels.server.current}/${levels.server.next}\` (${levels.server.progress}%)`].join('\n'),
				},
			]);
		}

		if (text) {
			embed.addFields([
				{
					name: `${interaction.guild?.name} Text Level`,
					value: [
						`**${textLevel}** ${makeBar(levels.text.progress)} **${textLevel + 1}**`,
						`XP: \`${levels.text.current}/${levels.text.next}\` (${levels.text.progress}%)`,
						`Messages: \`${text.messages ?? 0}\``,
					].join('\n'),
				},
			]);
		}

		if (voice) {
			const minutes = Math.floor((voice.timeSpent ?? 0) / 60);

			embed.addFields([
				{
					name: `${interaction.guild?.name} Voice Level`,
					value: [
						`**${voiceLevel}** ${makeBar(levels.voice.progress)} **${voiceLevel + 1}**`,
						`XP: \`${levels.voice.current}/${levels.voice.next}\` (${levels.voice.progress}%)`,
						`Voice Time: \`${minutes}m\``,
					].join('\n'),
				},
			]);
		}

		const levelRoles: Array<{ level: number; roleId: string }> =
			Array.isArray(guild?.levelRoles) && guild.levelRoles.length > 0 ? guild.levelRoles : Array.isArray(guild?.roles?.levels) ? guild.roles.levels : [];

		if (levelRoles.length > 0) {
			const sortedRoles = [...levelRoles].filter((lr) => lr?.roleId && Number(lr.level) > 0).sort((a, b) => Number(a.level) - Number(b.level));
			const currentUnlocked = [...sortedRoles].filter((lr) => Number(lr.level) <= serverLevel).pop();
			const nextRole = sortedRoles.find((lr) => Number(lr.level) > serverLevel);

			const lines: string[] = [];
			if (currentUnlocked) lines.push(`Current: <@&${currentUnlocked.roleId}> (Level ${currentUnlocked.level})`);
			if (nextRole) lines.push(`Next: <@&${nextRole.roleId}> (Level ${nextRole.level})`);

			if (lines.length > 0) {
				embed.addFields([
					{
						name: 'Level Roles',
						value: lines.join('\n'),
					},
				]);
			}
		}

		interaction.util.reply({ embeds: [embed], ephemeral: true });
	}
}
