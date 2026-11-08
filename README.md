<!-- @format -->

<p align="center">
  <img src="https://www.xernerx.com/banner.png" alt="Virtue — Xernerx Studios" width="100%" />
</p>

# Virtue (`v2.x`) — Global & Server Discord Leveling Bot

**Virtue** is the official text and voice XP progression Discord bot by **Xernerx Studios**, built on [`@xernerx/framework`](https://docs.xernerx.com/packages/@xernerx/framework), [`@xernerx/commands`](https://docs.xernerx.com/packages/@xernerx/commands), [`@xernerx/stats`](https://docs.xernerx.com/packages/@xernerx/stats), [`@xernerx/terminal`](https://docs.xernerx.com/packages/@xernerx/terminal), and [`@xernerx/websocket`](https://docs.xernerx.com/packages/@xernerx/websocket).

- **Application Showcase:** [https://xernerx.com/applications/virtue](https://xernerx.com/applications/virtue)
- **Server Dashboard & Leaderboards:** [https://app.xernerx.com](https://app.xernerx.com)
- **Virtue Pass & Server Boosts:** [https://store.xernerx.com/?item=bot-virtue](https://store.xernerx.com/?item=bot-virtue)

---

## ✨ Core Features & Architecture

- **Four Simultaneous Progression Tracks:**
  1. **Global Ecosystem Level & XP** (`xernerx/levels`) — Permanent cross-server progression that awards Virtual Credits on level-up.
  2. **Unified Server Level & XP** (`virtue/levels`) — Combined text + voice progression per guild.
  3. **Server Text Level & XP** (`virtue/text`) — Real-time message counter and text XP curve (`easy`, `casual`, `balanced`, `hard`, `extreme`).
  4. **Server Voice Level & XP** (`virtue/voice`) — Active undeafened duration (`timeSpent`) in non-AFK voice channels with at least 2 eligible non-bot members and streaming XP multipliers (`1.25x`).
- **Strict Data Minimization (`Zero Message Content`):** Connects solely with `Guilds`, `GuildMessages`, and `GuildVoiceStates` gateway intents—never requesting the privileged `MessageContent` intent and never joining voice channels or capturing audio.
- **Dynamic Hoist Roles (`src/lib/dynamicRoles.ts`):** Automatically manages milestone hoist roles, custom naming templates (`[@level]`), and hex color gradients within Discord's 250-role server limit based on active member level distribution.
- **Stackable XP Boosts (`/boost`):** Combines published Bot Directory review bonuses (`+10%`), 12-hour vote windows (`+10%`), Virtue Pass / Xernerx Ultra subscriptions (`+10%`), Server Booster multipliers, role multipliers, and Global XP Events.
- **Automated Leaderboard Cycle Resets (`src/lib/cycleRunner.ts`):** Supports automated `daily`, `weekly`, `monthly`, and `yearly` server leaderboard resets and Discord Scheduled Event synchronization for Global XP multipliers.
- **Personalized SVG/PNG Rank Cards (`src/lib/levelCard.ts`):** Renders `/level` and `/leaderboard` cards via `@resvg/resvg-js` and `sharp` using each user's Xernerx Account theme, `--accent` color, and locale.

---

## 📄 License

Proprietary software governed by the **[Xernerx Studios Proprietary & SaaS License v1.0](https://xernerx.com/license)**. See [`LICENSE`](./LICENSE) for full terms.
