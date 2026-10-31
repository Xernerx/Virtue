/** @format */

import { ContextCommandBuilder, type ContextCommandOptions } from '@xernerx/framework';
import { ApplicationCommandType } from 'discord.js';
import { replyWithLevelCard } from '../slash/level.js';

export default class LevelContextCommand extends ContextCommandBuilder {
	constructor() {
		super('Level', {
			name: 'Level',
			description: "View this user's level progression card.",
			type: ApplicationCommandType.User,
			defer: true,
			permissions: {
				user: ['SendMessages'],
			},
		});
	}

	override async exec({ interaction, user }: ContextCommandOptions<'user'>) {
		const ws = (this.client as any).websocket;
		const target = interaction.targetUser || (user as any)?.user || user;
		return replyWithLevelCard(ws, interaction, target);
	}
}
