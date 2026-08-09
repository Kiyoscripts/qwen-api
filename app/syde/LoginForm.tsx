"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DiscordLogo, Key as KeyIcon, ArrowRight, Check, Warning } from "@phosphor-icons/react";
import { useT } from "../I18n";
import { DISCORD_INVITE } from "@/lib/links";

/** QW- plus six characters from an alphabet with no 0, O, 1 or I, so a code
    read off another window cannot be typed into a different valid one. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = new RegExp(`^QW-[${ALPHABET}]{6}$`);

/** Forgiving on purpose: lower case, stray spaces, and pasting without the QW-
    are all what people actually do, and all recoverable. */
function normalise(raw: string): string {
  let v = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (v.startsWith("QW")) v = v.slice(2);
  v = v.split("").filter((c) => ALPHABET.includes(c)).join("").slice(0, 6);
  return v ? `QW-${v}` : "";
}

export function LoginForm() {
  const t = useT();
  const router = useRouter();
  const [tab, setTab] = useState<"link" | "key">("link");
  const [code, setCode] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<{ username: string; relay: string } | null>(null);
  const [dm, setDm] = useState<"sending" | "sent" | "dms_closed" | "failed">("sending");

  useEffect(() => {
    if (!linked || dm !== "sending") return;
    let live = true;
    const tick = async () => {
      try {
        const r = await fetch(`/api/auth/discord/dm-status?relay=${encodeURIComponent(linked.relay)}`);
        const j = await r.json();
        if (live && j.status) setDm(j.status);
      } catch { /* keep polling */ }
    };
    const id = setInterval(tick, 2000);
    tick();
    return () => { live = false; clearInterval(id); };
  }, [linked, dm]);

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/auth/discord/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "That code did not work.");
      setLinked({ username: j.discord?.username ?? "account", relay: j.relay });
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  const submitKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/auth/discord/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "That key was not accepted.");
      router.push("/keys");
      router.refresh();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };

  const resend = async () => {
    if (!linked) return;
    await fetch("/api/auth/discord/redm", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ relay: linked.relay }),
    }).catch(() => {});
    setDm("sending");
  };

  if (linked)
    return (
      <div>
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center bg-signal font-mono text-[15px] text-[var(--on-signal)]"
                style={{ borderRadius: "var(--r-sm)" }} aria-hidden>
            {linked.username.slice(0, 1).toUpperCase()}
          </span>
          <p className="h3 text-ink">{linked.username}</p>
        </div>
        <p className="mt-4 font-mono text-[12px] text-signal">{t("login_linked")}</p>

        <div className="mt-4 border border-rule px-4 py-4" style={{ borderRadius: "var(--r-sm)" }}>
          <p className="flex items-start gap-2 text-[13.5px] text-ink-2">
            {dm === "sent" ? (
              <Check size={15} weight="bold" className="mt-0.5 shrink-0 text-signal" />
            ) : dm === "sending" ? null : (
              <Warning size={15} weight="bold" className="mt-0.5 shrink-0 text-signal" />
            )}
            {dm === "dms_closed"
              ? t("login_dms_closed")
              : dm === "failed"
                ? t("login_dm_failed")
                : t("login_enter_dm_key")}
          </p>
          <button onClick={resend}
            className="mt-3 font-mono text-[11.5px] text-ink-3 underline underline-offset-2
                       transition-colors duration-200 hover:text-signal">
            {t("login_redm")}
          </button>
        </div>

        {/* Linking is not signing in: the code links the account, the bot sends a
            key, and that key is what signs you in. Sending them onward to the
            dashboard here just bounced them back out. */}
        <button
          onClick={() => { setLinked(null); setTab("key"); setError(null); }}
          className="btn btn-primary mt-5 w-full"
        >
          {t("login_have_key")} <ArrowRight size={13} weight="bold" />
        </button>
      </div>
    );

  return (
    <>
      <h1 className="h2 text-ink">{t("login_title")}</h1>
      <p className="body mt-3 text-[14px]">{t("login_sub")}</p>

      <div className="mt-8 flex" role="tablist" aria-label={t("login_title")}>
        {([["link", t("login_link_discord"), DiscordLogo], ["key", t("login_have_key"), KeyIcon]] as const).map(
          ([id, label, Icon]) => (
            <button key={id} role="tab" aria-selected={tab === id}
              onClick={() => { setTab(id as "link" | "key"); setError(null); }}
              className={`flex flex-1 items-center justify-center gap-2 border px-4 py-2.5 font-mono
                text-[12.5px] transition-colors duration-200 ${
                tab === id ? "border-ink bg-ink text-[var(--paper)]"
                           : "border-rule text-ink-2 hover:border-ink hover:text-ink"}`}
              style={{ borderRadius: "var(--r-sm)" }}>
              <Icon size={14} weight="bold" />{label}
            </button>
          ))}
      </div>

      {tab === "link" ? (
        <form onSubmit={submitCode} className="mt-6">
          <ol className="mb-5 space-y-2 text-[13.5px] text-ink-2">
            <li>
              <span className="num mr-2 text-ink-3">1</span>
              {t("login_join_the")}{" "}
              <a href={DISCORD_INVITE} target="_blank" rel="noreferrer"
                 className="text-signal underline underline-offset-2">
                {t("login_discord_server")}
              </a>
            </li>
            <li><span className="num mr-2 text-ink-3">2</span>{t("login_run")} <code className="font-mono text-ink">/link</code></li>
            <li><span className="num mr-2 text-ink-3">3</span>{t("login_enter_code_below")} <code className="font-mono text-ink">QW-DPKBY2</code></li>
          </ol>
          <label htmlFor="code" className="mb-2 block font-mono text-[11px] tracking-wide text-ink-3 uppercase">
            {t("login_your_link_code")}
          </label>
          <input id="code" autoCapitalize="characters" autoComplete="one-time-code" spellCheck={false}
            value={code} onChange={(e) => setCode(normalise(e.target.value))} placeholder="QW-XXXXXX"
            className="h-11 w-full border border-rule bg-transparent px-3 font-mono text-[15px]
                       tracking-[0.3em] text-ink outline-none placeholder:text-ink-3 focus:border-signal"
            style={{ borderRadius: "var(--r-sm)" }} />
          {error && <Err>{error}</Err>}
          <button type="submit" disabled={busy || !CODE_RE.test(code)}
                  className="btn btn-primary mt-4 w-full disabled:opacity-40">
            {busy ? t("loading") : t("login_submit")}
          </button>
        </form>
      ) : (
        <form onSubmit={submitKey} className="mt-6">
          <label htmlFor="loginkey" className="mb-2 block font-mono text-[11px] tracking-wide text-ink-3 uppercase">
            {t("login_key_label")}
          </label>
          <input id="loginkey" type="password" value={key} onChange={(e) => setKey(e.target.value)}
            placeholder={t("login_key_placeholder")}
            className="h-11 w-full border border-rule bg-transparent px-3 font-mono text-[13px]
                       text-ink outline-none placeholder:text-ink-3 focus:border-signal"
            style={{ borderRadius: "var(--r-sm)" }} />
          {error && <Err>{error}</Err>}
          <button type="submit" disabled={busy || !key.trim()}
                  className="btn btn-primary mt-4 w-full disabled:opacity-40">
            {busy ? t("loading") : t("login_submit")}
          </button>
        </form>
      )}
    </>
  );
}

function Err({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 flex items-start gap-2 text-[13px] text-signal">
      <Warning size={14} weight="bold" className="mt-0.5 shrink-0" />{children}
    </p>
  );
}
