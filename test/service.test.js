import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { serve } from "@hono/node-server";
import { createApps } from "../src/apps.js";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { count } from "drizzle-orm";
import { createStore } from "../src/database.js";
import { shortVisits } from "../src/schema.js";

test("internal CRUD controls public redirects and visit history", async (t) => {
    const postgres = new PGlite();
    const db = drizzle(postgres);
    const token = "test-only";
    const { publicApp, internalApp } = createApps(createStore(db, 90), { token });
    const servers = [];
    t.after(async () => {
        await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
        await postgres.close();
    });
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
    async function listen(app) {
        const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
        servers.push(server);
        await once(server, "listening");
        return `http://127.0.0.1:${server.address().port}`;
    }
    const [pub, api] = await Promise.all([listen(publicApp), listen(internalApp)]);
    const links = "/api/links";
    const call = (path, method = "GET", body) => fetch(api + path, {
        method,
        headers: {
            authorization: `Bearer ${token}`,
            ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: JSON.stringify(body),
    });
    const redirect = (path) => fetch(pub + path, { redirect: "manual" });

    assert.equal((await fetch(api + links)).status, 401);
    assert.equal((await fetch(pub + links)).status, 404);
    assert.equal((await fetch(api + "/demo")).status, 404);
    assert.equal((await call(links, "POST", { url: "javascript:alert(1)" })).status, 400);

    const create = await call(links, "POST", {
        code: "Demo",
        url: "https://example.com/page?x=1#anchor",
        owner_user_id: 42,
    });
    assert.equal(create.status, 201);
    assert.equal((await create.json()).code, "Demo");
    assert.equal((await call(links, "POST", { code: "demo", url: "https://example.com/" })).status, 409);
    assert.equal((await call(links + "?owner_user_id=42&offset=1").then((res) => res.json())).length, 0);
    assert.deepEqual(
        (await call(links + "?owner_user_id=42").then((res) => res.json())).map(({ code }) => code),
        ["Demo"],
    );

    assert.equal((await redirect("/s/demo")).status, 404);
    await db.insert(shortVisits).values({
        code: "Demo", initial_url: pub + "/demo", visited_at: new Date("2000-01-01T00:00:00Z"),
    });
    const hit = await redirect("/demo?q=%2F");
    assert.equal(hit.status, 302);
    assert.equal(hit.headers.get("location"), "https://example.com/page?x=1&q=%2F#anchor");
    const path = links + "/demo";
    assert.equal((await call(path).then((res) => res.json())).click_count, 1);
    const visits = await call(path + "/visits").then((res) => res.json());
    assert.deepEqual(visits.map(({ initial_url }) => initial_url), [pub + "/demo?q=%2F"]);

    assert.equal((await call(path, "PATCH", { enabled: false })).status, 200);
    assert.equal((await redirect("/demo")).status, 404);
    assert.equal((await call(path, "PATCH", { enabled: true, expires_at: "2000-01-01T00:00:00Z" })).status, 200);
    assert.equal((await redirect("/demo")).status, 410);
    assert.equal((await call(path, "PATCH", { expires_at: null, url: "https://example.org/" })).status, 200);
    assert.equal((await redirect("/demo")).headers.get("location"), "https://example.org/");

    assert.equal((await call(path, "DELETE")).status, 200);
    assert.equal((await call(path)).status, 404);
    assert.equal((await redirect("/demo")).status, 404);
    const [remaining] = await db.select({ count: count() }).from(shortVisits);
    assert.equal(remaining.count, 0);
});
