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

		const [user, member, voice, guild] = await Promise.all([
			ws.get('xernerx', 'levels', { ownerId: target.id }).catch(() => null),
			ws.get('virtue', 'text', { id: target.id, guild: interaction.guild?.id }).catch(() => null),
			ws.get('virtue', 'voice', { id: target.id, guild: interaction.guild?.id }).catch(() => null),
			ws.get('virtue', 'guilds', { id: interaction.guild?.id }).catch(() => null),
		]);

		if (!user && !member && !voice)
			return interaction.util.reply({
				content: 'You have never sent a message where I can see it... Why?',
				ephemeral: true,
			});

		const mode = guild?.mode || 'balanced';
		const globalLevel = user?.level ?? 0;
		const globalXp = user?.xp ?? 0;
		const localLevel = member?.level ?? 0;
		const localXp = member?.xp ?? 0;
		const voiceLevel = voice?.level ?? 0;
		const voiceXp = voice?.xp ?? 0;

		const levels = {
			global: {
				next: calculateLevel('balanced', globalLevel),
				current: globalXp,
				progress: 0,
			},
			local: {
				next: calculateLevel(mode, localLevel),
				current: localXp,
				progress: 0,
			},
			voice: {
				next: calculateLevel(mode, voiceLevel),
				current: voiceXp,
				progress: 0,
			},
		};

		levels.global.progress = Math.round((levels.global.current / levels.global.next) * 10000) / 100;
		levels.local.progress = Math.round((levels.local.current / levels.local.next) * 10000) / 100;
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
					name: `${interaction.guild?.name} Text Level`,
					value: [
						`**${localLevel}** ${makeBar(levels.local.progress)} **${localLevel + 1}**`,
						`XP: \`${levels.local.current}/${levels.local.next}\` (${levels.local.progress}%)`,
						`Messages: \`${member.messages ?? 0}\``,
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
			const highestServerLevel = Math.max(localLevel, voiceLevel);
			const currentUnlocked = [...sortedRoles].filter((lr) => Number(lr.level) <= highestServerLevel).pop();
			const nextRole = sortedRoles.find((lr) => Number(lr.level) > highestServerLevel);

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
