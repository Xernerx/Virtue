<!-- @format -->

## 2.3.0

### Minor Changes

- ### Automatic Service Profiles Opt-Out (`XernerxUser.services`) & Blacklist Enforcement
  
  - **Automatic Service Profile Opt-Out (`XernerxUser.services`)**:
    - Added `checkUserServices`, `isServicesDisabledDoc`, and `markUserServicesCache` in `src/lib/levels.ts` with a 15-second in-memory TTL cache to respect the `services` setting (`default: true`) on Xernerx user accounts (`xernerx/users` and `virtue/users` tombstones).
    - Users without an existing Xernerx Account (`xUser === null` and no opt-out tombstone in `virtue/users`) are never locked out and automatically have their leveling records and Xernerx Account provisioned in the background upon activity, allowing them to sign in later at `account.xernerx.com` to manage or disable automatic service profiles if desired.
  - **Automated Message & Voice Progression Guards**:
    - Updated `messageCreate` (`src/events/messageCreate.ts`) and `voiceStateUpdate` (`src/events/voiceStateUpdate.ts`) to verify `checkUserServices` before executing any `getOrCreate` database calls or starting voice sessions.
    - When `services === false` (or `blacklisted === true`), Virtue completely ignores the user for all automated actions: skipping automatic `xernerx` user/level/credit creation, skipping `virtue` user and guild profile (`levels`, `text`, `voice`) creation, halting XP/message/voice time progression, suppressing level-up announcements and DMs, and skipping automatic Discord level role synchronization.
    - Hardened `getOrCreate` in both event handlers to detect `servicesDisabled` / tombstone responses and immediately abort without creating or mutating documents.
  - **Slash & Context Command Handling (`/level`, `/roles`, `/leaderboard`)**:
    - Updated `/level` (and the `Level` / `User Level` context menu commands) to ignore tombstone/disabled records, skip background unified server level upserts when `services === false`, and display a clear notice when a user with disabled Automatic Service Profiles has no recorded XP.
    - Updated `/roles` and `/leaderboard` to filter out disabled/tombstone documents when resolving level progress and leaderboard rankings.

## 2.2.1

### Patch Changes

- Fixed font issues on attachments

## 2.2.0

### Minor Changes

- ### Visual Rank Cards, Leaderboards, Context Menus, Level Role Tracks, Credit Rewards & XP Events
  
  - **Rendered Visual Level & Setup Cards**:
    - Upgraded `/level` and `/setup` to generate crisp visual cards displaying your Discord avatar, Global Level, Unified Server Level, Text Level (with message count), Voice Level (with voice time), progress bars, unlocked/upcoming Level Roles, and full server configuration status.
    - **Profile Theme & Accent Sync**: Cards and embeds automatically match your Xernerx web profile appearance (`light` or `dark` theme and custom accent color).
  - **Context Menu Commands (`View Level` & `View Author Level`)**:
    - Right-click any user (**Apps → View Level**) or any message (**Apps → View Author Level**) to quickly inspect a member's progression card directly from chat.
  - **New `/leaderboard`, `/roles`, and `/info` Slash Commands**:
    - **`/leaderboard`**: Browse full-width visual leaderboards for **Unified Server Level**, **Text Level**, **Voice Level**, and **Global Xernerx Level**, complete with podium badges and your live rank.
    - **`/roles`**: View all level role milestones configured in the server, their required level and track, and which roles you have already unlocked.
    - **`/info`**: Inspect live bot statistics, uptime, latency, version info, and quick links to the Xernerx Dashboard and Support.
  - **Independent Level Role Tracks & Role Stacking**:
    - Server admins can now assign level roles independently to **Unified Server Level**, **Text Level**, or **Voice Level** tracks, and choose whether members **stack** all unlocked level roles or **replace** lower roles on that track with their highest milestone role.
  - **Level-Up Credit Rewards & Expanded Message Placeholders**:
    - Leveling up in a server or globally now automatically awards **Xernerx Credits** using a level-scaled progression formula.
    - Added support for `[@credits]` / `{credits}`, `[@role]` / `{role}`, `[@username]`, `[@nickname]`, and `[@server]` placeholders in custom level-up messages.
  - **Automated Reset Cycles, Channel Filters & XP Multipliers**:
    - **Daily, Weekly & Monthly Cycles**: Automatically resets server progression at cycle boundaries and announces the top 3 podium winners (`🥇`, `🥈`, `🥉`) in the level-up channel.
    - **Ignored Channels**: Mute XP gain in selected text, voice, or category channels.
    - **Server Booster Bonus & Scheduled Global XP Events**: Added configurable XP multipliers for Server Boosters (`1.25x`–`2x`) and scheduled Global XP Doubler events that sync automatically with Discord Scheduled Events.

## 2.1.4

### Patch Changes

- updated commands dependency

## 2.1.3

### Patch Changes

- Added handles to message commands

## 2.1.2

### Patch Changes

- Update @xernerx/* dependencies (@xernerx/commands@^0.2.6, @xernerx/framework@^1.1.1, @xernerx/stats@^1.0.14, @xernerx/terminal@^1.1.15, @xernerx/websocket@^0.4.16) and register XernerxStats via extensionHandler.loadExtensions.

## 2.1.1

### Patch Changes

- Fixed WebSocket connection recovery, environment-aware gateway URLs (`ws.dev.xernerx.com` in development and `ws.xernerx.com` in production), and decoupled global and guild XP progression so individual record failures do not block XP gain.

## 2.1.0

### Minor Changes

- ### Unified Server Leveling & Automatic Role/Channel Synchronization
  
  - **Unified Server Level (`virtue` -> `levels`)**: Added a unified per-server level that progresses from both text and voice activity independently from the server's separate **Text Level** (`virtue` -> `text`) and **Voice Level** (`virtue` -> `voice`), while **Global Level** (`xernerx` -> `levels`) continues to track unified progression across all servers, text, voice, and website interactions.
  - **Expanded `/level` Overview**: Updated `/level` to display **Global Level**, **`{Server}` Level**, **`{Server}` Text Level**, **`{Server}` Voice Level**, and **Level Roles** progression.
  - **Dashboard Role & Channel Sync**: Added automatic synchronization of server roles and text/announcement channels on startup (`clientReady`), server join (`guildCreate`), and `/setup` so role and channel dropdowns populate immediately in the Xernerx Suite dashboard.

## 2.0.1

### Patch Changes

- Fixed user fetch error

## 2.0.0

### Major Changes

- ### What's New in Virtue 2.0
  
  - **Voice Channel Leveling & XP Tracking**: Earn server Voice XP and climb the Voice Leaderboard just by hanging out and chatting in voice channels. Voice activity also contributes directly toward your unified Global Xernerx Level.
  - **Automatic Level Roles**: Server admins can now link Discord roles to specific levels in the Xernerx Dashboard (`app.xernerx.com/dashboard?tab=virtue`). Members automatically unlock and receive their role rewards as they level up in text or voice, with support for the `[@role]` / `{role}` variable in custom level-up messages.
  - **Enhanced `/level` Overview**: View your Global Level, Server Text Level (with total message count), Server Voice Level (with total voice minutes), and your current & next upcoming Level Role rewards in a single command.
  - **Instant Dashboard Setup**: Adding Virtue to a server or running `/setup` now automatically initializes your server profile and links directly to the Virtue tab in the Xernerx Server Dashboard.
  - **Faster & More Reliable Progression**: Upgraded to the new Xernerx Suite gateway for real-time syncing of server settings, XP curves, role rules, and level-up notifications.

# virtue
