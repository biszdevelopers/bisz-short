import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getConnInfo } from "@hono/node-server/conninfo";
import { z } from "zod";
import { buildRedirectUrl } from "./redirect.js";

const codeSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const reserved = new Set([
    "api", "portal", "login", "logout", "admin", "sws", "s", "links", "health",
    "sites", "docs", "approvals", "reports", "users", "audit", "storage",
    "deployments", "static", "assets", "www", "root", "null", "undefined",
    "new", "edit", "create", "delete",
]);
const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
const fields = z.strictObject({
    url: z.string().max(2048).refine((value) => {
        if (/[\u0000-\u0020\u007f]/.test(value)) return false;
        try {
            buildRedirectUrl(value, "");
            return true;
        } catch {
            return false;
        }
    }, "Destination must be an absolute HTTP or HTTPS URL without unescaped spaces or control characters"),
    owner_user_id: z.int().positive().nullable().optional(),
    enabled: z.boolean().optional(),
    expires_at: z.iso.datetime({ offset: true }).transform((value) => new Date(value).toISOString())
        .nullable().optional(),
});
const createSchema = fields.extend({ code: codeSchema.optional() });
const patchSchema = fields.partial().refine((data) => Object.keys(data).length > 0, "Nothing to update");
const paging = z.object({
    limit: z.coerce.number().int().min(1).max(1000).default(100),
    offset: z.coerce.number().int().min(0).default(0),
    owner_user_id: z.coerce.number().int().positive().optional(),
});

function error(c, status, message) {
    return c.json({ error: message }, status);
}

function normalize(data) {
    return data.enabled === undefined ? data : { ...data, enabled: Number(data.enabled) };
}

async function readBody(c, schema) {
    if (c.req.header("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
        return { response: error(c, 415, "Expected application/json") };
    }
    const body = await c.req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
        return { response: c.json({
            error: "Invalid request body",
            issues: parsed.error.issues.map(({ path, message }) => ({ path, message })),
        }, 400) };
    }
    return { data: normalize(parsed.data) };
}

const hash = (value) => createHash("sha256").update(value).digest();

export function createApps(store, { token, trustProxy = false }) {
    if (!token) throw new Error("INTERNAL_API_TOKEN is required");
    const secret = hash(token);
    const publicApp = new Hono();
    const internalApp = new Hono();

    for (const app of [publicApp, internalApp]) {
        app.use("*", async (c, next) => {
            c.header("Cache-Control", "no-store");
            await next();
        });
        app.notFound((c) => error(c, 404, "Not found"));
        app.onError((err, c) => {
            console.error(err);
            return error(c, 500, "Internal server error");
        });
    }

    publicApp.get("/:code", (c) => {
        const code = codeSchema.safeParse(c.req.param("code"));
        const link = code.success ? store.find(code.data) : undefined;
        if (!link?.enabled) return error(c, 404, "Short link not found");
        if (link.expires_at && Date.parse(link.expires_at) <= Date.now()) {
            return error(c, 410, "Short link expired");
        }
        const requestUrl = new URL(c.req.url);
        let response;
        try {
            response = c.redirect(buildRedirectUrl(link.url, requestUrl.search), 302);
        } catch {
            return error(c, 500, "Invalid link destination");
        }
        try {
            const forwarded = (name) => c.req.header(name)?.split(",")[0].trim();
            const clientIp = trustProxy
                ? forwarded("cf-connecting-ip") || forwarded("x-forwarded-for")
                : undefined;
            const ip = clientIp || (c.env?.incoming ? getConnInfo(c).remote.address : null) || null;
            const proto = trustProxy ? forwarded("x-forwarded-proto") : undefined;
            if (proto === "https" || proto === "http") requestUrl.protocol = proto + ":";
            store.recordClick(link, ip, requestUrl.href);
        } catch (err) {
            console.error("Short-link visit logging failed", err);
        }
        return response;
    });

    internalApp.use("/api/*", async (c, next) => {
        const match = /^Bearer (.+)$/i.exec(c.req.header("authorization") ?? "");
        if (!match || !timingSafeEqual(secret, hash(match[1]))) {
            c.header("WWW-Authenticate", "Bearer");
            return error(c, 401, "Invalid API token");
        }
        await next();
    });
    internalApp.use("/api/*", bodyLimit({
        maxSize: 16 * 1024,
        onError: (c) => error(c, 413, "Request body too large"),
    }));

    const links = "/api/links";
    internalApp.get(links, (c) => {
        const page = paging.safeParse(c.req.query());
        if (!page.success) return error(c, 400, "Invalid limit, offset or owner_user_id");
        const { limit, offset, owner_user_id } = page.data;
        return c.json(store.list(limit, offset, owner_user_id));
    });

    internalApp.post(links, async (c) => {
        const { data, response } = await readBody(c, createSchema);
        if (response) return response;
        const requested = data.code;
        if (requested && reserved.has(requested.toLowerCase())) {
            return error(c, 400, "Short code is reserved");
        }
        for (let attempt = 0; attempt < (requested ? 1 : 10); attempt++) {
            const code = requested ?? Array.from({ length: 7 }, () => alphabet[randomInt(alphabet.length)]).join("");
            if (reserved.has(code.toLowerCase())) continue;
            try {
                const link = store.insert({ owner_user_id: null, enabled: 1, expires_at: null, ...data, code });
                c.header("Location", `${links}/${link.code}`);
                return c.json(link, 201);
            } catch (err) {
                if (err.code !== "SQLITE_CONSTRAINT_UNIQUE") throw err;
                if (requested) return error(c, 409, "Short code already taken");
            }
        }
        return error(c, 503, "Could not allocate a short code, try again");
    });

    internalApp.get(`${links}/:code`, (c) => {
        const link = store.find(c.req.param("code"));
        return link ? c.json(link) : error(c, 404, "Short link not found");
    });

    internalApp.get(`${links}/:code/visits`, (c) => {
        const link = store.find(c.req.param("code"));
        if (!link) return error(c, 404, "Short link not found");
        const page = paging.pick({ limit: true, offset: true }).safeParse(c.req.query());
        if (!page.success) return error(c, 400, "Invalid limit or offset");
        return c.json(store.visits(link.code, page.data.limit, page.data.offset));
    });

    internalApp.patch(`${links}/:code`, async (c) => {
        const { data, response } = await readBody(c, patchSchema);
        if (response) return response;
        const link = store.update(c.req.param("code"), data);
        return link ? c.json(link) : error(c, 404, "Short link not found");
    });

    internalApp.delete(`${links}/:code`, (c) => {
        return store.remove(c.req.param("code"))
            ? c.json({ ok: true })
            : error(c, 404, "Short link not found");
    });

    return { publicApp, internalApp };
}
