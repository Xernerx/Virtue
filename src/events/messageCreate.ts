/** @format */

import { EventBuilder } from '@xernerx/framework';
import { calculateExperience, calculateLevel } from '../lib/levels.js';

type Doc<T> = { _doc: T };

const cooldowns = {
	easy: 30,
	casual: 45,
	balanced: 60,
	hard: 120,
	extreme: 300,
} as const;

export default class MessageCreateEvent extends EventBuilder {
	private globalCooldowns = new Map<string, number>();
	private guildCooldowns = new Map<string, number>();

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

	private hasCooldown(key: string, duration: number, cache: Map<string, number>) {
		const now = Date.now();
		const expires = cache.get(key);

		if (expires && expires > now) return true;

		cache.set(key, now + duration * 1000);

		return false;
	}

	override async run(message: any) {
		if (!message.guild || message.author.bot || message.system) return;

		const user = await this.getOrCreate('users', {
			id: message.author.id,
		});

		const member = await this.getOrCreate('members', {
			id: message.author.id,
			guild: message.guild.id,
		});

		const guild = await this.getOrCreate('guilds', {
			id: message.guild.id,
		});

		if (!user || !member || !guild) return;

		const mode = guild._doc.mode || 'balanced';
		const cooldown = cooldowns[mode as keyof typeof cooldowns] || cooldowns.balanced;

		const globalCooldown = cooldown * 2;

		const globalKey = `${message.author.id}`;
		const guildKey = `${message.guild.id}:${message.author.id}`;

		const bypassGlobal = this.hasCooldown(globalKey, globalCooldown, this.globalCooldowns);
		const bypassGuild = this.hasCooldown(guildKey, cooldown, this.guildCooldowns);

		const xpGain = calculateExperience(mode);

		// ===== GLOBAL =====
		let userLevel = user._doc.textLevel ?? 0;
		let userXp = user._doc.textExperience ?? 0;

		if (!bypassGlobal) {
			userXp += xpGain;

			while (userXp >= calculateLevel('balanced', userLevel)) {
				userXp -= calculateLevel('balanced', userLevel);
				userLevel++;

				const status = await fetch(`${process.env.API_URL}/users/${message.author.id}/profile`)
					.then((res) => res.json())
					.catch(() => null);

				if (status?.notifications?.virtue?.levelup?.discord) message.author.send(`You went level up! You are now level ${userLevel}`).catch(() => null);
			}
		}

		// ===== LOCAL =====
		let memberLevel = member._doc.textLevel ?? 0;
		let memberXp = member._doc.textExperience ?? 0;

		if (!bypassGuild) {
			memberXp += xpGain;

			while (memberXp >= calculateLevel(mode, memberLevel)) {
				memberXp -= calculateLevel(mode, memberLevel);
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
