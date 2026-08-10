import { useEffect, useState } from "react";
import { Plus, Copy, Check, Warning, SignOut } from "@phosphor-icons/react";
import {
  me as fetchMe, listKeys, createKey, revokeKey, usage, logout,
  type Key, type Me, type UsageDay,
} from "../lib/api";
import { Link, useRoute } from "../lib/router";
import { Reveal } from "../components/Reveal";

/**
 * Keys and usage.
 *
 * The one thing this page has to get right is that a new key is shown exactly
 * once: it is returned in the create response and never stored in readable
 * form, so if the user navigates away without copying it, it is gone. Hence the
 * banner that stays until dismissed, rather than a toast that times out.
 */
export function Keys() {
  const { go } = useRoute();
  const [user, setUser] = useState<Me | null | undefined>(undefined);
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [days, setDays] = useState<UsageDay[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchMe().then((u) => {
      if (!live) return;
      setUser(u);
      if (u) {
        listKeys().then((k) => live && setKeys(k));
        usage().then((d) => live && setDays(d));
      }
    });
    return () => { live = false; };
  }, []);

  if (user === undefined) return <div className="field py-20"><Skeleton /></div>;

  if (user === null)
    return (
      <div className="field py-24 text-center">
        <h1 className="h2 text-ink">Sign in to manage keys</h1>
        <p className="body mx-auto mt-3 text-[14px]">
          Keys belong to a linked Discord account.
        </p>
        <Link to="/login" className="btn btn-primary mt-6">Sign in</Link>
      </div>
    );

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { key, record } = await createKey(name.trim());
      setFresh(key);
      setKeys((prev) => [record, ...(prev ?? [])]);
      setName("");
    } catch {
      setError("Could not create the key. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setKeys((prev) => (prev ?? []).map((k) => (k.id === id ? { ...k, revoked: true } : k)));
    await revokeKey(id).catch(() => {});
  };

  const total = days.reduce((n, d) => n + d.requests, 0);
  const peak = Math.max(1, ...days.map((d) => d.requests));

  return (
    <div className="field py-14 md:py-16">
      <Reveal>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="h2 text-ink">Keys</h1>
            <p className="body mt-3 text-[14px]">
              Signed in as <span className="text-ink">{user.username}</span>. Keys are
              hashed at rest and shown once.
            </p>
          </div>
          <button
            onClick={async () => { await logout(); go("/"); }}
            className="btn btn-ghost h-9 px-4"
          >
            <SignOut size={13} weight="bold" />
            Sign out
          </button>
        </div>
      </Reveal>

      {fresh && (
        <div
          className="mt-7 border border-[var(--signal)] bg-[var(--signal-wash)] px-4 py-4"
          style={{ borderRadius: "var(--r-sm)" }}
        >
          <p className="text-[13.5px] font-medium text-signal">
            Copy this now. It will not be shown again.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate border border-[var(--signal)] bg-[var(--paper)]
                             px-3 py-2 font-mono text-[12.5px] text-ink"
                  style={{ borderRadius: "var(--r-sm)" }}>
              {fresh}
            </code>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(fresh);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
              className="btn btn-primary h-9 shrink-0 px-3"
            >
              {copied ? <Check size={13} weight="bold" /> : <Copy size={13} weight="bold" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <button
            onClick={() => setFresh(null)}
            className="mt-3 font-mono text-[11.5px] text-signal underline underline-offset-2"
          >
            I have saved it
          </button>
        </div>
      )}

      {/* Usage. Bars from real counts, no filled background track. */}
      <Reveal delay={0.05} className="mt-8">
        <div className="border border-rule p-5" style={{ borderRadius: "var(--r-sm)" }}>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[11.5px] text-ink-3">requests, last 14 days</span>
            <span className="num text-[13px] text-ink">{total.toLocaleString()}</span>
          </div>
          <div className="mt-4 flex h-20 items-end gap-1.5">
            {days.map((d) => (
              <div
                key={d.day}
                title={`${d.day}: ${d.requests}`}
                className="flex-1 bg-signal transition-[height] duration-500"
                style={{ height: `${Math.max(4, (d.requests / peak) * 100)}%` }}
              />
            ))}
            {days.length === 0 &&
              Array.from({ length: 14 }).map((_, i) => (
                <div key={i} className="flex-1 animate-pulse bg-[var(--paper-3)]" style={{ height: "40%" }} />
              ))}
          </div>
        </div>
      </Reveal>

      {/* Create */}
      <Reveal delay={0.08} className="mt-8">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label htmlFor="keyname" className="mb-2 block font-mono text-[11px] tracking-wide text-ink-3 uppercase">
              New key name
            </label>
            <input
              id="keyname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Local dev"
              className="h-10 w-full border border-rule bg-transparent px-3 font-mono text-[12.5px]
                         text-ink outline-none placeholder:text-ink-3 focus:border-signal"
              style={{ borderRadius: "var(--r-sm)" }}
            />
          </div>
          <button onClick={create} disabled={busy} className="btn btn-primary disabled:opacity-40">
            <Plus size={13} weight="bold" />
            {busy ? "Creating" : "Create key"}
          </button>
        </div>
        {error && (
          <p className="mt-3 flex items-center gap-2 text-[13px] text-signal">
            <Warning size={14} weight="bold" /> {error}
          </p>
        )}
      </Reveal>

      {/* List */}
      <div className="mt-8">
        {!keys ? (
          <Skeleton />
        ) : keys.length === 0 ? (
          <div
            className="border border-dashed border-rule-strong px-6 py-14 text-center"
            style={{ borderRadius: "var(--r-sm)" }}
          >
            <p className="h3 text-ink">No keys yet</p>
            <p className="body mx-auto mt-2 text-[13.5px]">
              Create one above to start sending requests.
            </p>
          </div>
        ) : (
          <div className="border border-rule" style={{ borderRadius: "var(--r-sm)" }}>
            {keys.map((k, i) => (
              <div
                key={k.id}
                className={`flex flex-wrap items-center gap-4 px-4 py-3.5 ${
                  i > 0 ? "border-t border-rule" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className={`text-[13.5px] ${k.revoked ? "text-ink-3 line-through" : "text-ink"}`}>
                    {k.name}
                  </p>
                  <p className="font-mono text-[11.5px] text-ink-3">{k.key_prefix}</p>
                </div>
                <span className="num text-[12px] text-ink-3">
                  {k.requests.toLocaleString()} req
                </span>
                {k.revoked ? (
                  <span className="font-mono text-[11px] text-ink-3">revoked</span>
                ) : (
                  <button
                    onClick={() => revoke(k.id)}
                    className="font-mono text-[11.5px] text-ink-3 transition-colors duration-200 hover:text-signal"
                  >
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="h-14 animate-pulse border border-rule bg-[var(--paper-2)]"
          style={{ borderRadius: "var(--r-sm)" }}
        />
      ))}
    </div>
  );
}
