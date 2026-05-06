/** @format */

import { EventBuilder } from '@xernerx/framework';
import { calculateExperience, calculateLevel } from '../lib/levels.js';

type Doc<T> = { _doc: T };

export default class MessageCreateEvent extends EventBuilder {
	constructor() {
		super('messageCreate', {
			name: 'messageCreate',
			emitter: 'client',
			once: false,
		});
	}

	private async getOrCreate(collection: string, query: any) {
		const ws = (this.client as any).websocket;

		let data = await ws.get('virtue', collection, query);
		if (!data) {
			data = await ws.create('virtue', collection, query);
		}

		return data?._doc ? data : null;
	}

	override async run(message: any) {
		if (!message.guild || message.author.bot || message.system) return;

		const user = await this.getOrCreate('users', { id: message.author.id });
		const member = await this.getOrCreate('members', {
			id: message.author.id,
			guild: message.guild.id,
		});
		const guild = await this.getOrCreate('guilds', {
			id: message.guild.id,
		});

		if (!user || !member || !guild) return;

		const xpGain = calculateExperience('balanced');

		// ===== GLOBAL =====
		let userLevel = user._doc.textLevel ?? 0;
		let userXp = user._doc.textExperience ?? 0;

		userXp += xpGain;

		while (userXp >= calculateLevel('balanced', userLevel)) {
			userXp -= calculateLevel('balanced', userLevel);
			userLevel++;

			message.author.send('Level up!');
		}

		// ===== LOCAL =====
		let memberLevel = member._doc.textLevel ?? 0;
		let memberXp = member._doc.textExperience ?? 0;

		memberXp += xpGain;

		while (memberXp >= calculateLevel(guild._doc.mode, memberLevel)) {
			memberXp -= calculateLevel(guild._doc.mode, memberLevel);
			memberLevel++;

			if (guild._doc.levelUp) {
				const msg = guild._doc.levelMessage
					.replace(/\[@mention\]/gi, message.author)
					.replace(/\[@username\]/gi, message.author.globalName || message.author.username)
					.replace(/\[@nickname\]/gi, message.member.nickname || message.author.globalName || message.author.username)
					.replace(/\[@level\]/gi, String(memberLevel))
					.replace(/\[@server\]/gi, message.guild.name);

				guild._doc.levelChannel ? message.client.channels.fetch(guild._doc.levelChannel).then((c: any) => c.send(msg)) : message.reply(msg);
			}
		}

		const ws = (this.client as any).websocket;

		await Promise.all([
			ws.update('virtue', 'users', {
				id: message.author.id,
				textLevel: userLevel,
				textExperience: userXp,
			}),
			ws.update('virtue', 'members', {
				id: message.author.id,
				guild: message.guild.id,
				textLevel: memberLevel,
				textExperience: memberXp,
			}),
		]);
	}
}
