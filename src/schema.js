import { sql } from "drizzle-orm";
import { bigint, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const foldCode = (value) => sql`lower(${value} COLLATE "C")`;

export const shortLinks = pgTable("short_links", {
    id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    code: text().notNull(),
    url: text().notNull(),
    owner_user_id: bigint({ mode: "number" }),
    enabled: integer().notNull().default(1),
    click_count: bigint({ mode: "number" }).notNull().default(0),
    expires_at: timestamp({ withTimezone: true }),
    created_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    uniqueIndex("idx_short_links_code_ci").on(foldCode(table.code)),
]);

export const shortVisits = pgTable("short_visits", {
    id: bigint({ mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    code: text().notNull(),
    ip: text(),
    initial_url: text().notNull(),
    visited_at: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (table) => [
    index("idx_short_visits_code_ci").on(foldCode(table.code)),
    index("idx_short_visits_visited").on(table.visited_at),
]);
