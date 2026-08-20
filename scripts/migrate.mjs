import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import "dotenv/config";

const args = new Set(process.argv.slice(2));
const baseline = args.has("--baseline");
const statusOnly = args.has("--status");
const migrationsDir = path.resolve(process.cwd(), "migrations");
const names = (await readdir(migrationsDir)).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
if (!names.length) throw new Error("No migrations found.");
const migrations = await Promise.all(names.map(async (name) => { const sql = await readFile(path.join(migrationsDir, name), "utf8"); return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") }; }));
const rawConnectionString = process.env.DATABASE_URL;
if (!rawConnectionString) throw new Error("DATABASE_URL must be set.");
const insecureSsl = process.env.DATABASE_SSL_NO_VERIFY === "true";
const connectionUrl = new URL(rawConnectionString);
if (insecureSsl) connectionUrl.searchParams.delete("sslmode");
const client = new pg.Client({ connectionString: connectionUrl.toString(), ssl: insecureSsl ? { rejectUnauthorized: false } : undefined });
await client.connect();
let locked = false;
try {
  await client.query("select pg_advisory_lock($1)", [834276119]); locked = true;
  await client.query(`create table if not exists public.schema_migrations (name text primary key, checksum text not null, applied_at timestamptz not null default now(), execution_ms integer not null default 0, baselined boolean not null default false)`);
  const appliedRows = (await client.query("select name,checksum,baselined,applied_at from public.schema_migrations order by name")).rows;
  const applied = new Map(appliedRows.map((row) => [row.name, row]));
  for (const row of appliedRows) if (!migrations.some((migration) => migration.name === row.name)) throw new Error(`Applied migration is missing from disk: ${row.name}`);
  for (const migration of migrations) { const row = applied.get(migration.name); if (row && row.checksum !== migration.checksum) throw new Error(`Checksum mismatch for applied migration ${migration.name}. Historical migrations are immutable.`); }
  const pending = migrations.filter((migration) => !applied.has(migration.name));
  if (statusOnly) { for (const migration of migrations) console.log(`${applied.has(migration.name) ? "applied" : "pending"}  ${migration.name}`); console.log(`${applied.size} applied, ${pending.length} pending`); process.exitCode = pending.length ? 2 : 0; }
  else if (baseline) {
    if (applied.size) throw new Error("Cannot baseline: schema_migrations already contains records.");
    const userTables = Number((await client.query(`select count(*) from information_schema.tables where table_schema='public' and table_name<>'schema_migrations'`)).rows[0].count);
    if (!userTables) throw new Error("Cannot baseline an empty database; run migrations normally.");
    await client.query("begin");
    try { for (const migration of migrations) await client.query("insert into public.schema_migrations(name,checksum,baselined) values($1,$2,true)", [migration.name, migration.checksum]); await client.query("commit"); } catch (error) { await client.query("rollback"); throw error; }
    console.log(`Baselined ${migrations.length} migrations against ${userTables} existing public tables.`);
  } else {
    for (const migration of pending) {
      const started = Date.now(); await client.query("begin");
      try { await client.query(migration.sql); await client.query("insert into public.schema_migrations(name,checksum,execution_ms) values($1,$2,$3)", [migration.name, migration.checksum, Date.now() - started]); await client.query("commit"); console.log(`applied ${migration.name}`); }
      catch (error) { await client.query("rollback"); throw new Error(`Migration failed: ${migration.name}`, { cause: error }); }
    }
    console.log(pending.length ? `Applied ${pending.length} migration(s).` : "Database is up to date.");
  }
} finally { if (locked) await client.query("select pg_advisory_unlock($1)", [834276119]).catch(() => {}); await client.end(); }
