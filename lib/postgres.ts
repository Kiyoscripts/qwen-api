import { Pool, type PoolClient } from "pg";

let instance: Pool | null = null;
function pool() {
  if (!instance) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL must be set");
    instance = new Pool({ connectionString: process.env.DATABASE_SSL_NO_VERIFY === "true" ? process.env.DATABASE_URL.replace(/([?connectionString: process.env.DATABASE_URL,])sslmode=require(connectionString: process.env.DATABASE_URL,|$)/, "$1") : process.env.DATABASE_URL, ssl: process.env.DATABASE_SSL_NO_VERIFY === "true" ? { rejectUnauthorized: false } : undefined, max: Number(process.env.DATABASE_POOL_SIZE || 10) });
  }
  return instance;
}

export async function sql<T = any>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await pool().query(text, values);
  return result.rows as T[];
}

export async function postgresHealth(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
  const started = Date.now();
  try {
    await pool().query("SELECT 1");
    return { ok: true, latency_ms: Date.now() - started };
  } catch (error) {
    return { ok: false, latency_ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function withAdvisoryLock<T>(key: number, work: () => Promise<T>): Promise<T | null> {
  const client = await pool().connect();
  try {
    const locked = (await client.query("SELECT pg_try_advisory_lock($1) AS locked", [key])).rows[0].locked;
    if (!locked) return null;
    try { return await work(); } finally { await client.query("SELECT pg_advisory_unlock($1)", [key]); }
  } finally { client.release(); }
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

type Result = { data: any; error: { message: string } | null; count: number | null };
type Operation = "select" | "insert" | "update" | "delete" | "upsert";
const identifier = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Invalid SQL identifier: ${s}`);
  return `"${s}"`;
};
const columns = (s: string) => s.trim() === "*" ? "*" : s.split(",").map(x => identifier(x.trim())).join(", ");

class Query implements PromiseLike<Result> {
  private operation: Operation = "select";
  private selected = "*";
  private payload: any;
  private filters: string[] = [];
  private params: any[] = [];
  private suffix = "";
  private mode: "single" | "maybe" | null = null;
  private head = false;
  private conflict = "";
  constructor(private table: string) { identifier(table); }
  select(value = "*", options?: { head?: boolean; count?: string }) { this.selected = value; this.head = Boolean(options?.head); return this; }
  insert(value: any) { this.operation = "insert"; this.payload = value; return this; }
  update(value: any) { this.operation = "update"; this.payload = value; return this; }
  delete(_options?: any) { this.operation = "delete"; return this; }
  upsert(value: any, options?: { onConflict?: string }) { this.operation = "upsert"; this.payload = value; this.conflict = options?.onConflict || ""; return this; }
  private parameter(value: any) { this.params.push(value); return `$${this.params.length}`; }
  private where(column: string, op: string, value: any) { this.filters.push(`${identifier(column)} ${op} ${this.parameter(value)}`); return this; }
  eq(c: string, v: any) { return this.where(c, "=", v); }
  gte(c: string, v: any) { return this.where(c, ">=", v); }
  lt(c: string, v: any) { return this.where(c, "<", v); }
  like(c: string, v: any) { return this.where(c, "LIKE", v); }
  is(c: string, v: any) { this.filters.push(`${identifier(c)} IS ${v === null ? "NULL" : "NOT NULL"}`); return this; }
  not(c: string, op: string, v: any) { return op === "is" && v === null ? (this.filters.push(`${identifier(c)} IS NOT NULL`), this) : this.where(c, "<>", v); }
  in(c: string, values: any[]) { this.filters.push(values.length ? `${identifier(c)} IN (${values.map(v => this.parameter(v)).join(",")})` : "FALSE"); return this; }
  order(c: string, options?: { ascending?: boolean }) { this.suffix += ` ORDER BY ${identifier(c)} ${options?.ascending === false ? "DESC" : "ASC"}`; return this; }
  limit(n: number) { this.suffix += ` LIMIT ${Math.max(0, Math.trunc(n))}`; return this; }
  single() { this.mode = "single"; this.suffix += " LIMIT 1"; return this; }
  maybeSingle() { this.mode = "maybe"; this.suffix += " LIMIT 1"; return this; }
  async run(): Promise<Result> {
    try {
      const where = this.filters.length ? ` WHERE ${this.filters.join(" AND ")}` : "";
      let sql: string;
      if (this.operation === "select") {
        sql = `SELECT ${this.head ? "COUNT(*)::int AS count" : columns(this.selected)} FROM ${identifier(this.table)}${where}${this.suffix}`;
      } else if (this.operation === "delete") {
        sql = `DELETE FROM ${identifier(this.table)}${where} RETURNING ${columns(this.selected)}`;
      } else if (this.operation === "update") {
        const sets = Object.entries(this.payload).map(([k, v]) => `${identifier(k)}=${this.parameter(v)}`);
        sql = `UPDATE ${identifier(this.table)} SET ${sets.join(",")}${where} RETURNING ${columns(this.selected)}`;
      } else {
        const rows = Array.isArray(this.payload) ? this.payload : [this.payload];
        const keys = Object.keys(rows[0]);
        const values = rows.map(row => `(${keys.map(k => this.parameter(row[k])).join(",")})`).join(",");
        sql = `INSERT INTO ${identifier(this.table)} (${keys.map(identifier).join(",")}) VALUES ${values}`;
        if (this.operation === "upsert") {
          const target = this.conflict ? `(${this.conflict.split(",").map(identifier).join(",")})` : "";
          sql += ` ON CONFLICT ${target} DO UPDATE SET ${keys.map(k => `${identifier(k)}=EXCLUDED.${identifier(k)}`).join(",")}`;
        }
        sql += ` RETURNING ${columns(this.selected)}`;
      }
      const result = await pool().query(sql, this.params);
      if (this.head) return { data: null, error: null, count: Number(result.rows[0]?.count || 0) };
      const data = this.mode ? (result.rows[0] ?? null) : result.rows;
      if (this.mode === "single" && !data) return { data: null, error: { message: "No row returned" }, count: result.rowCount };
      return { data, error: null, count: result.rowCount };
    } catch (e: any) { return { data: null, error: { message: e?.message || String(e) }, count: null }; }
  }
  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, fail?: ((e: any) => B | PromiseLike<B>) | null) { return this.run().then(ok, fail); }
}

export function postgresAdmin() {
  return {
    from(table: string) { return new Query(table); },
    async rpc(name: string, args: Record<string, any>) {
      try {
        identifier(name);
        const values = Object.values(args);
        const result = await pool().query(`SELECT ${identifier(name)}(${values.map((_, i) => `$${i + 1}`).join(",")})`, values);
        return { data: result.rows, error: null, count: result.rowCount };
      } catch (e: any) { return { data: null, error: { message: e?.message || String(e) }, count: null }; }
    },
  };
}
