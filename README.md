# bisz-short

Standalone short-link backend. The public listener on **6767** serves `GET /:code` (for example, `http://localhost:6767/demo`). The management API listens only on **127.0.0.1:6768** and requires a bearer token.

## Run

Requires Node.js 24 or later.

1. Run `npm ci`.
2. Create a PostgreSQL database and set its connection string as `DATABASE_URL` in `.env`. Copy `.env.example` as a starting point and set `INTERNAL_API_TOKEN` to a secret.
3. Run `npm run db:migrate` to apply the Drizzle migrations.
4. Run `npm start`.

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

The [Drizzle schema](src/schema.js) preserves the Basis Sites `short_links` columns, case-insensitive code uniqueness, and `short_visits` for click history. The API returns timestamps as UTC ISO 8601 strings. `owner_user_id` remains a nullable reference value; the service does not need the Basis Sites user database. Visit records older than `SHORT_VISIT_RETENTION_DAYS` (default 90) are pruned on redirects; lifetime counts are retained. Migrations create the tables in the configured PostgreSQL database. Existing records can be imported separately.

Run `npm test` to apply the migrations to an in-memory PostgreSQL instance (PGlite) and verify both listeners. After editing the Drizzle schema, run `npm run db:generate` to generate a migration.
