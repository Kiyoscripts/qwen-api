import { useEffect, useState } from "react";
import { Plus, Warning } from "@phosphor-icons/react";
import { me as fetchMe, poolTokens, type Me, type PoolToken } from "../lib/api";
import { Link } from "../lib/router";
import { Reveal } from "../components/Reveal";

type Pool = "qwen" | "onecompiler";

/**
 * Account pools.
 *
 * The operator question this page has to answer at a glance is "which accounts
 * are about to stop working", so expiry is a first-class column rather than
 * something you compute from a timestamp. Qwen session tokens are JWTs with a
 * roughly two week life, and a pool that quietly ages out all at once looks
 * exactly like a ban.
 */
export function Admin() {
  const [user, setUser] = useState<Me | null | undefined>(undefined);
  const [pool, setPool] = useState<Pool>("qwen");
  const [tokens, setTokens] = useState<PoolToken[] | null>(null);
  const [paste, setPaste] = useState("");

  useEffect(() => {
    fetchMe().then(setUser);
  }, []);

  useEffect(() => {
    setTokens(null);
    poolTokens().then(setTokens);
  }, [pool]);

  if (user === undefined) return <div className="field py-20" />;

  if (!user || (user.role !== "owner" && user.role !== "admin"))
    return (
      <div className="field py-24 text-center">
        <h1 className="h2 text-ink">Not your page</h1>
        <p className="body mx-auto mt-3 text-[14px]">
          Pool administration is limited to owners.
        </p>
        <Link to="/" className="btn btn-ghost mt-6">Back to the site</Link>
      </div>
    );

  const live = tokens?.filter((t) => t.active).length ?? 0;
  const expiringSoon =
    tokens?.filter((t) => new Date(t.expires_at).getTime() - Date.now() < 3 * 86400_000).length ?? 0;

  return (
    <div className="field py-14 md:py-16">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="h2 text-ink">Pools</h1>
            <p className="body mt-3 text-[14px]">
              Accounts the gateway rotates through. A failing account is parked
              automatically; an expired one is deactivated before a request is spent on it.
            </p>
          </div>
          <div className="flex gap-1" role="tablist" aria-label="Pool">
            {([["qwen", "Qwen"], ["onecompiler", "OneCompiler"]] as const).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={pool === id}
                onClick={() => setPool(id)}
                className={`h-9 border px-3 font-mono text-[12px] transition-colors duration-200 ${
                  pool === id
                    ? "border-ink bg-ink text-[var(--paper)]"
                    : "border-rule text-ink-2 hover:border-ink hover:text-ink"
                }`}
                style={{ borderRadius: "var(--r-sm)" }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.05} className="mt-8">
        <dl className="grid gap-4 sm:grid-cols-3">
          {[
            [String(tokens?.length ?? "-"), "accounts"],
            [String(live), "active"],
            [String(expiringSoon), "expiring within 3 days"],
          ].map(([figure, label]) => (
            <div
              key={label}
              className="border border-rule px-4 py-4"
              style={{ borderRadius: "var(--r-sm)" }}
            >
              <dd className="num text-[1.7rem] leading-none font-medium text-ink">{figure}</dd>
              <dt className="mt-2 text-[12.5px] text-ink-2">{label}</dt>
            </div>
          ))}
        </dl>
      </Reveal>

      <Reveal delay={0.08} className="mt-8">
        <label htmlFor="paste" className="mb-2 block font-mono text-[11px] tracking-wide text-ink-3 uppercase">
          Add accounts
        </label>
        <textarea
          id="paste"
          rows={3}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={
            pool === "qwen"
              ? "Paste one Qwen session token per line"
              : "Paste one OneCompiler bearer token per line"
          }
          className="w-full resize-y border border-rule bg-transparent px-3 py-2.5 font-mono
                     text-[12.5px] text-ink outline-none placeholder:text-ink-3 focus:border-signal"
          style={{ borderRadius: "var(--r-sm)" }}
        />
        <button className="btn btn-primary mt-3" disabled={!paste.trim()}>
          <Plus size={13} weight="bold" />
          Add {paste.trim() ? paste.trim().split("\n").filter(Boolean).length : ""} accounts
        </button>
      </Reveal>

      <div className="mt-8">
        {!tokens ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse border border-rule bg-[var(--paper-2)]"
                   style={{ borderRadius: "var(--r-sm)" }} />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto border border-rule" style={{ borderRadius: "var(--r-sm)" }}>
            <table className="w-full min-w-[560px] text-left">
              <thead>
                <tr className="border-b border-rule">
                  {["Account", "State", "Errors", "Expires"].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-mono text-[11px] tracking-wide text-ink-3 uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => {
                  const daysLeft = Math.round(
                    (new Date(t.expires_at).getTime() - Date.now()) / 86400_000
                  );
                  return (
                    <tr key={t.id} className="border-b border-rule last:border-0">
                      <td className="px-4 py-3 font-mono text-[12.5px] text-ink">{t.label}</td>
                      <td className="px-4 py-3 text-[12.5px]">
                        <span className={t.active ? "text-ink-2" : "text-signal"}>
                          {t.active ? "active" : "deactivated"}
                        </span>
                      </td>
                      <td className="num px-4 py-3 text-[12.5px] text-ink-2">{t.error_count}</td>
                      <td className="num px-4 py-3 text-[12.5px]">
                        <span className={daysLeft < 3 ? "text-signal" : "text-ink-2"}>
                          {daysLeft}d
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 flex items-start gap-2 text-[12.5px] text-ink-3">
          <Warning size={14} weight="bold" className="mt-0.5 shrink-0" />
          Adding accounts is inert while the backend is a placeholder.
        </p>
      </div>
    </div>
  );
}
