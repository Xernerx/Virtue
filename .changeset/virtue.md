---
'virtue': minor
---

<!-- @format -->

## Global Leaderboard Shadowban Exclusion

Excluded shadowbanned accounts (`shadowban: true`) from global leaderboard queries in `/leaderboard`.

### Changed

- **Global Leaderboard Shadowban Filter**: Added `shadowban: { $ne: true }` to global scope rankings in `src/commands/slash/leaderboard.ts`.
