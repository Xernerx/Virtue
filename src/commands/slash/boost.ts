/** @format */

import { SlashCommandBuilder, type SlashCommandOptions, XernerxUser } from '@xernerx/framework';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { resolveUserAccent } from '../../lib/levelCard.js';
import { checkUserServices, PREMIUM_PASS_XP_BONUS, REVIEW_XP_BONUS, VOTE_XP_BONUS } from '../../lib/levels.js';

export default class BoostCommand extends SlashCommandBuilder {
	constructor() {
		super('boost', {
			name: 'boost',
			description: 'View your active XP boosts and quick links to unlock more.',
			defer: true,
			permissions: {
				user: ['SendMessages'],
			},
		});
	}

	override async exec({ interaction }: SlashCommandOptions) {
		const ws = (this.client as any).websocket;
		const botUser = interaction.client.user;
		const botId = botUser?.id || interaction.applicationId;

		const xUser = interaction.user instanceof XernerxUser ? interaction.user : new XernerxUser(this.client as any, interaction.user);

		const [serviceCheck, accent] = await Promise.all([checkUserServices(ws, interaction.user.id, xUser, { forceRefresh: true }), resolveUserAccent(ws, interaction.user.id)]);

		const reviewUrl = `https://app.xernerx.com/bots/${botId}?view=reviews`;
		const voteUrl = `https://app.xernerx.com/bots/${botId}`;
		const subscriptionUrl = 'https://store.xernerx.com/?item=bot-virtue';

		const reviewPct = Math.round(REVIEW_XP_BONUS * 100);
		const votePct = Math.round(VOTE_XP_BONUS * 100);
		const subPct = Math.round(PREMIUM_PASS_XP_BONUS * 100);
		const totalBonusPct = Math.round((serviceCheck.xpMultiplier - 1) * 100);

		const reviewStatus = serviceCheck.reviewed ? `✅ **Active**${serviceCheck.rating ? ` (${serviceCheck.rating}/5 ★)` : ''}` : `❌ **Inactive** • [Leave a Review](${reviewUrl})`;

		let voteExpiryText = '';
		if (serviceCheck.voted && serviceCheck.nextVoteAt) {
			const nextVoteUnix = Math.floor(new Date(serviceCheck.nextVoteAt).getTime() / 1000);
			if (Number.isFinite(nextVoteUnix) && nextVoteUnix > 0) {
				voteExpiryText = ` (expires <t:${nextVoteUnix}:R>)`;
			}
		}
		const voteStatus = serviceCheck.voted ? `✅ **Active**${voteExpiryText}` : `❌ **Inactive** • [Vote for Virtue](${voteUrl})`;

		const subStatus = serviceCheck.hasPremiumPass ? '✅ **Active** (Virtue Pass / Ultra)' : `❌ **Inactive** • [Subscribe](${subscriptionUrl})`;

		const embed = new EmbedBuilder()
			.setColor(accent.colorInt)
			.setAuthor({
				name: `${interaction.user.username} • XP Boosts`,
				iconURL: interaction.user.displayAvatarURL({ extension: 'png', size: 128 }),
			})
			.setDescription(
				[`Unlock stackable XP boosts across all Global, Server, Text, and Voice tracks.`, `**Your Active Boost:** \`+${totalBonusPct}% XP\` (\`${serviceCheck.xpMultiplier.toFixed(2)}x\`)`].join('\n')
			)
			.addFields([
				{
					name: `${serviceCheck.reviewed ? '✅' : '❌'} Leave a Review — +${reviewPct}% XP`,
					value: `${reviewStatus}\nPermanent \`+${reviewPct}%\` XP boost while your review is published on the [Bot Directory](${reviewUrl}).`,
					inline: false,
				},
				{
					name: `${serviceCheck.voted ? '✅' : '❌'} Vote — +${votePct}% XP`,
					value: `${voteStatus}\nGrants a \`+${votePct}%\` XP boost for **12 hours** every time you [vote for Virtue](${voteUrl}).`,
					inline: false,
				},
				{
					name: `${serviceCheck.hasPremiumPass ? '✅' : '❌'} Subscription — +${subPct}% XP`,
					value: `${subStatus}\nGrants a \`+${subPct}%\` XP boost with an active **Virtue Pass** or **Xernerx Ultra** subscription on the [Xernerx Store](${subscriptionUrl}) or Discord App Store.`,
					inline: false,
				},
			])
			.setFooter({
				text: `© ${new Date().getFullYear()} Xernerx Studios • Stack all 3 for +${reviewPct + votePct + subPct}% XP`,
				iconURL: 'https://xernerx.com/logo.png',
			});

		if (botUser) {
			embed.setThumbnail(botUser.displayAvatarURL({ extension: 'png', size: 256 }));
		}

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setLabel(`Leave a Review (+${reviewPct}%)`).setURL(reviewUrl).setStyle(ButtonStyle.Link),
			new ButtonBuilder().setLabel(`Vote (+${votePct}%)`).setURL(voteUrl).setStyle(ButtonStyle.Link),
			new ButtonBuilder().setLabel(`Subscription (+${subPct}%)`).setURL(subscriptionUrl).setStyle(ButtonStyle.Link)
		);

		return interaction.editReply({
			embeds: [embed],
			components: [row],
		});
	}
}
