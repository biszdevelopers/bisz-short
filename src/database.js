import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");

export function openDatabase(path) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    try {
        db.pragma("journal_mode = WAL");
        db.transaction(() => {
            db.exec(schema);
            // Basis Sites added expiry to older databases in a separate migration.
            if (!db.pragma("table_info(short_links)").some(({ name }) => name === "expires_at")) {
                db.exec("ALTER TABLE short_links ADD COLUMN expires_at TEXT");
            }
        }).immediate();
        return db;
    } catch (error) {
        db.close();
        throw error;
    }
}

export function createStore(db, retentionDays) {
    const find = db.prepare("SELECT * FROM short_links WHERE code = ? COLLATE NOCASE");
    const list = db.prepare(`
        SELECT * FROM short_links ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
    `);
    const listByOwner = db.prepare(`
        SELECT * FROM short_links WHERE owner_user_id = ?
        ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
    `);
    const insert = db.prepare(`
        INSERT INTO short_links (code, url, owner_user_id, enabled, expires_at)
        VALUES (@code, @url, @owner_user_id, @enabled, @expires_at)
        RETURNING *
    `);
    const update = db.prepare(`
        UPDATE short_links
        SET url = @url, owner_user_id = @owner_user_id, enabled = @enabled,
            expires_at = @expires_at, updated_at = datetime('now')
        WHERE code = @code COLLATE NOCASE
        RETURNING *
    `);
    const deleteLink = db.prepare("DELETE FROM short_links WHERE code = ? COLLATE NOCASE");
    const deleteVisits = db.prepare("DELETE FROM short_visits WHERE code = ? COLLATE NOCASE");
    const bump = db.prepare(
        "UPDATE short_links SET click_count = click_count + 1 WHERE id = ?",
    );
    const addVisit = db.prepare(
        "INSERT INTO short_visits (code, ip, initial_url) VALUES (?, ?, ?)",
    );
    const prune = db.prepare("DELETE FROM short_visits WHERE visited_at < datetime('now', ?)");
    const visits = db.prepare(`
        SELECT * FROM short_visits WHERE code = ? COLLATE NOCASE
        ORDER BY visited_at DESC, id DESC LIMIT ? OFFSET ?
    `);

    return {
        find: (code) => find.get(code),
        list: (limit, offset, owner) => owner === undefined
            ? list.all(limit, offset)
            : listByOwner.all(owner, limit, offset),
        insert: (link) => insert.get(link),
        update: db.transaction((code, changes) => {
            const link = find.get(code);
            return link && update.get({ ...link, ...changes });
        }).immediate,
        remove: db.transaction((code) => {
            if (!deleteLink.run(code).changes) return false;
            deleteVisits.run(code);
            return true;
        }).immediate,
        recordClick: db.transaction((link, ip, initialUrl) => {
            if (!bump.run(link.id).changes) return;
            addVisit.run(link.code, ip, initialUrl);
            prune.run(`-${retentionDays} days`);
        }),
        visits: (code, limit, offset) => visits.all(code, limit, offset),
    };
}
