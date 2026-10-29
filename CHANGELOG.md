<!-- @format -->

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
