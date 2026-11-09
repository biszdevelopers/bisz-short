# bisz-short

Standalone short-link backend. The public listener on **6767** serves `GET /:code` (for example, `http://localhost:6767/demo`). The management API listens only on **127.0.0.1:6768** and requires a bearer token.

## Run

Requires Node.js 24 or later.

1. Run `npm ci`.
2. Copy `.env.example` to `.env` and set `INTERNAL_API_TOKEN` to a secret. Generate one with the command in the example file.
3. Run `npm start`. SQLite creates the database and tables on first start.

The public listener binds to all interfaces by default. Set `PUBLIC_HOST` to change that. If you run behind a trusted reverse proxy that overwrites the forwarding headers and controls access to the origin, set `TRUST_PROXY=true` to use the forwarded visitor IP and scheme in visit records.

## Management API

Send `Authorization: Bearer <INTERNAL_API_TOKEN>` with every request, and `Content-Type: application/json` with request bodies.

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/links` | List newest first. Accepts `limit` (default 100, max 1000), `offset`, and optional `owner_user_id`. |
| POST | `/api/links` | Create a link. Requires `url`; accepts `code`, `owner_user_id`, `enabled`, and `expires_at`. An omitted code is generated. |
| GET | `/api/links/:code` | Read one link, including its lifetime click count. |
| PATCH | `/api/links/:code` | Change the URL, owner, enabled state, or expiry. Use `null` to clear expiry or owner. |
| DELETE | `/api/links/:code` | Delete the link and its visit records. |
| GET | `/api/links/:code/visits` | List recent visits with `limit` and `offset`. |

For example, send this JSON to `POST /api/links`:

```json
{"code":"demo","url":"https://example.com/page","expires_at":"2030-01-01T00:00:00Z"}
```

Codes are case insensitive and stay fixed after creation. URLs must use HTTP or HTTPS. A public request returns 302 and forwards its query string to the destination. Disabled or missing links return 404, and expired links return 410.

## Database

[`src/schema.sql`](src/schema.sql) preserves the Basis Sites `short_links` table, its case insensitive unique index, and `short_visits` for click history. `owner_user_id` remains a nullable reference value; the service does not need the Basis Sites user database. Visit records older than `SHORT_VISIT_RETENTION_DAYS` (default 90) are pruned on redirects; lifetime counts are retained. Set `DB_PATH` to choose the database file. The default is a new database at `./data/short-links.sqlite`; this does not copy any existing records.

Run `npm test` to verify the public and internal listeners together.
