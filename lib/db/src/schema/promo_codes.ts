import { pgTable, serial, text, numeric, integer, bigint, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const promoCodesTable = pgTable("promo_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  bonusAmount: numeric("bonus_amount", { precision: 12, scale: 2 }).notNull(),
  maxUses: integer("max_uses").notNull().default(1),
  usedCount: integer("used_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  gameType: text("game_type").notNull().default("both"),
  createdBy: bigint("created_by", { mode: "number" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
});

export const promoCodeUsagesTable = pgTable("promo_code_usages", {
  id: serial("id").primaryKey(),
  promoCodeId: integer("promo_code_id").notNull(),
  telegramId: bigint("telegram_id", { mode: "number" }).notNull(),
  usedAt: timestamp("used_at").notNull().defaultNow(),
});

export const insertPromoCodeSchema = createInsertSchema(promoCodesTable).omit({ id: true, usedCount: true, createdAt: true });
export const selectPromoCodeSchema = createSelectSchema(promoCodesTable);

export type InsertPromoCode = z.infer<typeof insertPromoCodeSchema>;
export type PromoCode = typeof promoCodesTable.$inferSelect;
export type PromoCodeUsage = typeof promoCodeUsagesTable.$inferSelect;
