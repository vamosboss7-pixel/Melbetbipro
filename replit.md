# መልካም BINGO

A Telegram Mini App bingo game where players join via Telegram bot, select up to 2 cards, and compete in real-time multiplayer rounds.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/bingo-app run dev` — run the frontend (auto via workflow)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run typecheck:libs` — build composite libs (run before api-server typecheck)
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env secrets: `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`
- Optional env secrets: `MAIN_ADMIN_TELEGRAM_ID` (for balance-adjust UI), `SMS_WEBHOOK_SECRET` (security token for SMS webhook), `ANNOUNCEMENT_CHANNEL_ID` (Telegram channel ID or @username for auto-posting approved deposits/withdrawals), `LUCKY_BOX_CHANNEL_ID` (Telegram channel ID or @username for Lucky Box posts — defaults to `ANNOUNCEMENT_CHANNEL_ID` if not set), `JACKPOT_CHANNEL_ID` (Telegram channel ID or @username for jackpot leaderboard updates and jackpot result announcements — dedicated jackpot channel, separate from `ANNOUNCEMENT_CHANNEL_ID`), `REQUIRED_CHANNEL_IDS` (comma-separated @usernames users must join before registering, e.g. `@MelkamBingoOfficial,@MelkamBingoNews`), `GROQ_API_KEY` (Groq API key for the 🤖 AI Support bot feature — uses llama-3.1-70b-versatile)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + Socket.IO (real-time game)
- Bot: grammy (Telegram bot framework), webhook mode
- DB: PostgreSQL + Drizzle ORM
- Frontend: React + Vite + Tailwind CSS
- Validation: Zod (`zod/v4`), `drizzle-zod`
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/bingo-app/` — React frontend (Telegram Mini App)
- `artifacts/api-server/` — Express + Socket.IO server + Telegram bot
- `lib/db/` — Drizzle schema (`src/schema/players.ts`)
- `lib/api-spec/` — OpenAPI spec + Orval codegen config
- `lib/api-zod/`, `lib/api-client-react/` — generated client code

Key files:
- `artifacts/api-server/src/lib/gameEngine.ts` — game state machine (singleton)
- `artifacts/api-server/src/lib/gameSocket.ts` — Socket.IO setup, path `/api/socket.io`
- `artifacts/api-server/src/lib/bot.ts` — Telegram bot, `/start` command
- `artifacts/bingo-app/src/hooks/useGame.ts` — Socket.IO client hook
- `artifacts/bingo-app/src/hooks/useTelegramAuth.ts` — Telegram WebApp auth
- `artifacts/bingo-app/src/data/cartelas.ts` — 200 unique bingo cards (source of truth)

## Architecture decisions

- **Socket.IO path is `/api/socket.io`** — required because the shared proxy routes `/api` to the API server; clients must use `path: '/api/socket.io'`
- **Server-side win validation** — client detects win locally (has cartela data), sends `claim_bingo` with card layout; server validates against called balls set and broadcasts winner
- **Game engine is a singleton** — one `GameEngine` instance per server process; all players share one room; rounds auto-cycle
- **Telegram auth via initData HMAC** — `/api/auth/telegram` validates Telegram WebApp initData using HMAC-SHA256 with `WebAppData` key; creates/upserts player in DB
- **esbuild externals** — `pg`, `grammy`, `socket.io` must be in the external list in `build.mjs` to avoid native module bundling issues

## Product

- Player opens Telegram bot → `/start` → receives "ጨዋታ ጀምር" button → opens Mini App
- Mini App validates Telegram identity, registers player in DB automatically
- Card Selection: 30-second countdown, select up to 2 cards from 200 available
- If at least 1 player has cards when countdown hits 0 → game starts; otherwise countdown resets
- Game: balls called every 3 seconds (B1-O75), auto-marked on master grid and player cards
- Win patterns: any row, column, diagonal, or four corners (FREE space = always marked)
- Winner auto-detected client-side → server validates → winner modal shown to all (5s) → new round

## Gotchas

- Run `pnpm run typecheck:libs` before `pnpm --filter @workspace/api-server run typecheck` (lib/db must be built first)
- After changing `lib/db` schema, run `pnpm --filter @workspace/db run push` to migrate
- `pg` package has no type declarations bundled — `@types/pg` is in api-server devDependencies
- Never run `pnpm dev` at workspace root
- **Railway deploy auto-runs `drizzle-kit push --force`** before starting — schema is always synced on deploy. No manual migration step needed.
- **`app_settings` PK is `key` (text)**, not a serial `id`. If the Railway DB was created before this was standardised, run `pnpm --filter @workspace/db run push-force` manually once to fix it (the deploy command now handles this automatically).
- **`device_fingerprints` PK is `fingerprint` (text)**, not a serial `id` — same note as above.

## Daily Check-in Bonus

- `GET /api/player/checkin-status?telegramId=N` — streak info + whether claimable today
- `POST /api/player/checkin` `{ telegramId }` — claim daily bonus; credits `playBalance` (non-withdrawable)
- Schedule: Day 1: 0.5, Day 2: 1.0, Day 3: 1.5, Day 4: 2.0, Day 5: 3.0, Day 6: 4.0, Day 7: 5.0 ETB
- Streak resets if a day is missed; after 7 consecutive days wraps back to Day 1
- DB: `daily_checkins` table tracks per-player streak and last checkin date

## Achievement System

- `GET /api/player/achievements?telegramId=N` — returns all achievements with live progress; auto-awards any newly unlocked
- Achievement definitions in `artifacts/api-server/src/lib/achievements.ts`
- Milestones: games_5 (+1 ETB), games_20 (+5 ETB), games_50 (+15 ETB), games_100 (+30 ETB), invite_3 (+2 ETB), invite_10 (+5 ETB), invite_25 (+15 ETB)
- Rewards credited to `playBalance` (non-withdrawable); logged as `achievement_bonus` transactions
- DB: `player_achievements` table (unique per player+achievement, prevents double-award via PK constraint)
- UI: Profile page shows daily check-in strip + achievements preview; dedicated `Achievements` screen accessible from Profile

## Pointers

- See `.local/skills/pnpm-workspace` for workspace structure
- See `.local/skills/environment-secrets` for managing secrets
