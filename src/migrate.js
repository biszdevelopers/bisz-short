import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { openDatabase } from "./database.js";

const { db, close } = openDatabase(process.env.DATABASE_URL);
try {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
} finally {
    await close();
}
