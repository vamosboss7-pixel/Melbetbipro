import { pgTable, text, bigint, timestamp } from "drizzle-orm/pg-core";

export const deviceFingerprintsTable = pgTable("device_fingerprints", {
  fingerprint: text("fingerprint").primaryKey(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type DeviceFingerprint = typeof deviceFingerprintsTable.$inferSelect;
