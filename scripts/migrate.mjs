import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pg = require("/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg");

const connectionString = process.env.NEON_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("No DATABASE_URL");

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();

const stmts = [
  // Players table — all columns the Drizzle schema expects
  `ALTER TABLE players ADD COLUMN IF NOT EXISTS main_balance NUMERIC(12,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE players ADD COLUMN IF NOT EXISTS bonus_balance NUMERIC(12,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE players ADD COLUMN IF NOT EXISTS has_active_wagering BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE players ADD COLUMN IF NOT EXISTS wagering_required NUMERIC(12,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE players ADD COLUMN IF NOT EXISTS wagering_completed NUMERIC(12,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE players ADD COLUMN IF NOT EXISTS preferred_balance TEXT NOT NULL DEFAULT 'main_first'`,
  `ALTER TABLE players ADD COLUMN IF NOT EXISTS has_claimed_channel_bonus BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE players ADD COLUMN IF NOT EXISTS agent_balance NUMERIC(12,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE players ADD COLUMN IF NOT EXISTS total_invite_bonus NUMERIC(12,2) NOT NULL DEFAULT 0`,
  `ALTER TABLE players ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`,
  `ALTER TABLE players ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()`,
  // Transactions table — ensure all columns
  `ALTER TABLE transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()`,
  // Pending deposits
  `ALTER TABLE pending_deposits ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()`,
  // Pending withdrawals
  `ALTER TABLE pending_withdrawals ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()`,
  // Game rounds
  `ALTER TABLE game_rounds ADD COLUMN IF NOT EXISTS room_id TEXT NOT NULL DEFAULT 'room1'`,
  // Deposit code attempts
  `ALTER TABLE deposit_code_attempts ADD COLUMN IF NOT EXISTS transaction_code TEXT`,
  `ALTER TABLE deposit_code_attempts ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 1`,
  // Promo codes
  `ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS game_type TEXT NOT NULL DEFAULT 'bingo'`,
  // Jackpot points
  `ALTER TABLE jackpot_points ADD COLUMN IF NOT EXISTS streak_count INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE jackpot_points ADD COLUMN IF NOT EXISTS last_game_count INTEGER NOT NULL DEFAULT 0`,
];

for (const sql of stmts) {
  try {
    await client.query(sql);
    console.log("✓", sql.slice(0, 80));
  } catch (err) {
    console.error("✗", sql.slice(0, 80), "→", err.message);
  }
}

// Check all player columns exist
const res = await client.query(
  `SELECT column_name FROM information_schema.columns WHERE table_name = 'players' ORDER BY ordinal_position`
);
console.log("\n📋 players columns:", res.rows.map(r => r.column_name).join(", "));

await client.end();
console.log("\n✅ Migration complete");
