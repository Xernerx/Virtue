/** @format */

import { ContextCommandBuilder, type ContextCommandOptions } from '@xernerx/framework';
import { ApplicationCommandType } from 'discord.js';
import { replyWithLevelCard } from '../slash/level.js';

export default class MessageLevelContextCommand extends ContextCommandBuilder {
	constructor() {
		super('User Level', {
			name: 'User Level',
			description: "View this message user's level progression card.",
			type: ApplicationCommandType.Message,
			defer: true,
			permissions: {
				user: ['SendMessages'],
			},
		});
	}

	override async exec({ interaction, message }: ContextCommandOptions<'message'>) {
		const ws = (this.client as any).websocket;
		const target = message?.author || interaction.targetMessage?.author || interaction.user;
		return replyWithLevelCard(ws, interaction, target);
	}
}
