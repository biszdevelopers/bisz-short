import { desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { foldCode, shortLinks, shortVisits } from "./schema.js";

export function openDatabase(connectionString) {
    if (!connectionString) throw new Error("Set DATABASE_URL in the environment or .env");
    const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 });
    pool.on("error", (error) => console.error("PostgreSQL idle connection failed", error));
    return { db: drizzle(pool), close: () => pool.end() };
}

export function createStore(db, retentionDays) {
    const linkCode = (code) => eq(foldCode(shortLinks.code), foldCode(code));
    const visitCode = (code) => eq(foldCode(shortVisits.code), foldCode(code));

    return {
        async find(code) {
            const [link] = await db.select().from(shortLinks).where(linkCode(code)).limit(1);
            return link;
        },
        list(limit, offset, owner) {
            return db.select().from(shortLinks)
                .where(owner === undefined ? undefined : eq(shortLinks.owner_user_id, owner))
                .orderBy(desc(shortLinks.created_at), desc(shortLinks.id))
                .limit(limit).offset(offset);
        },
        async insert(link) {
            try {
                const [created] = await db.insert(shortLinks).values(link).returning();
                return created;
            } catch (error) {
                const cause = error.cause ?? error;
                if (cause.code === "23505" && cause.constraint === "idx_short_links_code_ci") return undefined;
                throw error;
            }
        },
        async update(code, changes) {
            const [updated] = await db.update(shortLinks)
                .set({ ...changes, updated_at: sql`now()` })
                .where(linkCode(code)).returning();
            return updated;
        },
        remove(code) {
            return db.transaction(async (tx) => {
                const [deleted] = await tx.delete(shortLinks).where(linkCode(code))
                    .returning({ code: shortLinks.code });
                if (!deleted) return false;
                await tx.delete(shortVisits).where(visitCode(deleted.code));
                return true;
            });
        },
        recordClick(link, ip, initialUrl) {
            return db.transaction(async (tx) => {
                const [counted] = await tx.update(shortLinks)
                    .set({ click_count: sql`${shortLinks.click_count} + 1` })
                    .where(eq(shortLinks.id, link.id))
                    .returning({ code: shortLinks.code });
                if (!counted) return;
                await tx.insert(shortVisits).values({ code: counted.code, ip, initial_url: initialUrl });
                await tx.delete(shortVisits).where(sql`
                    ${shortVisits.visited_at} < now() - ${`${retentionDays} days`}::interval
                `);
            });
        },
        visits(code, limit, offset) {
            return db.select().from(shortVisits).where(visitCode(code))
                .orderBy(desc(shortVisits.visited_at), desc(shortVisits.id))
                .limit(limit).offset(offset);
        },
    };
}
