---
name: Room settings key convention
description: How per-room bingo settings are stored and wired across the stack, needed when adding/removing a stake room.
---

Per-room bingo settings (stake, commission, countdown, ball interval, max cards, min players) are stored as flat
`app_settings` rows keyed `roomN_<settingKey>` (e.g. `room2_stakePerCard`), not as a nested/relational structure.

**Why:** the settings module (`artifacts/api-server/src/lib/settings.ts`) defines a `RoomId` union and a
`SettingKey` union enumerating every `roomN_*` key explicitly, with matching defaults. Nothing is derived
dynamically from a list of active rooms — every room needs its own hardcoded keys.

**How to apply:** adding or removing a stake room touches all of these in lockstep:
- `settings.ts` — `RoomId` union, `SettingKey` union entries, `SETTING_DEFAULTS`
- `routes/admin.ts` — `VALID_ROOMS`, the room-settings GET/PUT endpoints, and the room-status monitor endpoint
- `lib/gameSocket.ts` — the `GameEngine` instance + Socket.IO namespace wiring for that room
- `routes/game.ts` — the `/game/rooms` public-state aggregation endpoint
- Frontend: `hooks/useGame.ts` (namespace → CARTELAS data mapping), `pages/Landing.tsx`, `pages/Admin.tsx` (room
  settings tabs/state), and `App.tsx` (routes/screens for that stake)
- DB: no schema migration needed for rooms themselves (they're just settings keys), but stale `app_settings` rows
  for a removed room should be cleaned up separately.
