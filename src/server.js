import { serve } from "@hono/node-server";
import { openDatabase, createStore } from "./database.js";
import { createApps } from "./apps.js";
import { shortLinks, shortVisits } from "./schema.js";

const token = process.env.INTERNAL_API_TOKEN?.trim();
if (!token) throw new Error("Set INTERNAL_API_TOKEN in the environment or .env");

const retentionDays = Number(process.env.SHORT_VISIT_RETENTION_DAYS ?? 90);
if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) {
    throw new Error("SHORT_VISIT_RETENTION_DAYS must be a positive integer");
}
const trustProxy = process.env.TRUST_PROXY ?? "false";
if (trustProxy !== "true" && trustProxy !== "false") {
    throw new Error("TRUST_PROXY must be true or false");
}
const { db, close } = openDatabase(process.env.DATABASE_URL);
try {
    await db.select().from(shortLinks).limit(0);
    await db.select().from(shortVisits).limit(0);
} catch (error) {
    await close();
    throw error;
}
const store = createStore(db, retentionDays);
const { publicApp, internalApp } = createApps(store, { token, trustProxy: trustProxy === "true" });
const servers = [];
let shuttingDown = false;

function stop(exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    process.exitCode = exitCode;
    Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
        .then(close)
        .catch((error) => {
            console.error("Could not close PostgreSQL pool", error);
            process.exitCode = 1;
        });
}

for (const [name, app, hostname, port] of [
    ["Internal API", internalApp, "127.0.0.1", 6768],
    ["Public redirects", publicApp, process.env.PUBLIC_HOST || "0.0.0.0", 6767],
]) {
    const server = serve({ fetch: app.fetch, hostname, port }, () => {
        console.log(`${name} listening on http://${hostname}:${port}`);
    });
    servers.push(server);
    server.on("error", (err) => {
        console.error(`${name}: ${err.message}`);
        stop(1);
    });
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
