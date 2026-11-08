<!-- @format -->

# `apps/virtue` (`Xernerx/virtue`) — Agent Guidelines (`AGENTS.md`)

## 🧭 Overview

`d:\Xernerx Studios\apps\virtue` is the standalone **Virtue (`v2.x`)** Discord leveling bot repository built on `@xernerx/framework`, `@xernerx/commands`, `@xernerx/stats`, `@xernerx/terminal`, and `@xernerx/websocket`.

## 🏗️ Key Modules (`src/`)

- `src/main.ts`: Bot client bootstrap (`intents: ['Guilds', 'GuildMessages', 'GuildVoiceStates']` — strictly no `MessageContent` intent).
- `src/commands/slash/{boost,info,leaderboard,level,roles,setup}.ts`: Slash commands for XP boost inspection (`/boost`), rank cards (`/level`), leaderboards (`/leaderboard`), role rewards (`/roles`), and server setup (`/setup`).
- `src/commands/context/{level,messageLevel}.ts`: User and Message context menu commands for inspecting level cards.
- `src/events/{clientReady,guildCreate,messageCreate,voiceStateUpdate}.ts`: Real-time Text and Voice XP calculation, cooldown enforcement, level-up credit rewards, and Discord role/channel cache syncing.
- `src/lib/dynamicRoles.ts`: Dynamic Hoist Roles engine (`selectDefiningMilestones`, `syncDynamicGuildRoles`, hex gradient interpolation, and `[@level]` naming templates within Discord's 250-role guild cap).
- `src/lib/cycleRunner.ts`: Automated `daily`, `weekly`, `monthly`, and `yearly` server leaderboard cycle resets and Global XP Scheduled Event synchronization.
- `src/lib/levelCard.ts` & `src/lib/levels.ts`: SVG/PNG card renderer (`@resvg/resvg-js` & `sharp`), XP curve math (`easy`, `casual`, `balanced`, `hard`, `extreme`), and `Automatic Service Profiles` (`services: false`) opt-out checks.

## ⚠️ Important Rules

1. **Zero Message Content & Voice Privacy:** Never request the `MessageContent` gateway intent, never log raw chat text or attachments, and never join voice channels or capture audio.
2. **Cross-Repo Sync with `suite` & `.github`:**
   - Keep `LICENSE` byte-for-byte identical to `../../suite/LICENSE` and `PLAIN_TEXT_LICENSE` in `../../suite/apps/www/src/app/license/page.tsx`.
   - Whenever adding or modifying Virtue commands, XP multipliers, Dynamic Hoist Roles, or privacy/data behavior, ensure the 5 policy pages in `../../suite/apps/www/src/app/{terms,privacy,cookies,security,license}/page.tsx` (`www.*` in `en-GB.json`), the dashboard in `../../suite/apps/app`, and `../../.github` stay in sync.
