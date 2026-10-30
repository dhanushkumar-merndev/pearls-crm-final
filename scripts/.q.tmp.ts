import pg from "pg";
import { loadEnv } from "./env-sync.ts";
const db = new pg.Client({ connectionString: loadEnv().get("DATABASE_URL") });
await db.connect();
for (const q of process.argv.slice(2)) console.log(JSON.stringify((await db.query(q)).rows, null, 0));
await db.end();
