---
'virtue': patch
---

<!-- @format -->

## Global XP Scheduled Event Deduplication & Discord Entitlement Sync

Hardened Global XP Scheduled Event synchronization across bot instances and updated Virtue Pass entitlement identifiers.

### Changed

- **Global XP Event Sync (`src/lib/cycleRunner.ts`)**: Scoped scheduled event lookups strictly to the configured `canonicalTargetGuildId` without falling back to `client.guilds.cache.first()`, and added automatic duplicate XP event pruning.
- **Subscription Entitlement IDs (`src/lib/levels.ts`)**: Added `discord_virtue` to `VIRTUE_OR_ULTRA_IDS` and removed deprecated legacy price IDs.
