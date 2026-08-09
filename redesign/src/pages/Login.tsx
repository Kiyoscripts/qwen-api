import { useEffect, useState } from "react";
import { DiscordLogo, Key as KeyIcon, ArrowRight, Check, Warning } from "@phosphor-icons/react";
import { verifyCode, dmStatus, loginWithKey, type Me } from "../lib/api";
import { useRoute } from "../lib/router";

type Tab = "link" | "key";

/**
 * Two ways in, the same as the old site.
 *
 * "Link Discord" is the first-time path: /link in the bot returns a six digit
 * code, the code proves who you are, and the bot then DMs a login key. "Use a
 * key" is the returning path for anyone who already has that key.
 *
 * The DM is the part that can quietly fail, since a closed DM inbox is silent
 * from the bot's side. So the page polls for delivery and says plainly what to
 * do when it did not arrive, rather than leaving the user on a spinner.
 */
export function Login() {
  const { go } = useRoute();
  const [tab, setTab] = useState<Tab>("link");
  const [code, setCode] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linked, setLinked] = useState<{ me: Me; relay: string } | null>(null);
  const [dm, setDm] = useState<"sending" | "sent" | "dms_closed" | "failed">("sending");

  // Poll only while the outcome is still unknown.
  useEffect(() => {
    if (!linked || dm !== "sending") return;
    let live = true;
    const tick = async () => {
      const s = await dmStatus(linked.relay).catch(() => "sending" as const);
      if (live) setDm(s);
    };
    const id = setInterval(tick, 2000);
    tick();
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [linked, dm]);

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setLinked(await verifyCode(code));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submitKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await loginWithKey(key);
      go("/keys");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field flex min-h-[calc(100dvh-14rem)] items-center py-16">
      <div className="mx-auto w-full max-w-[440px]">
        {linked ? (
          <Linked me={linked.me} dm={dm} onContinue={() => go("/keys")} />
        ) : (
          <>
            <h1 className="h2 text-ink">Sign in</h1>
            <p className="body mt-3 text-[14px]">
              Accounts are linked through Discord. There is no password to set.
            </p>

            <div className="mt-8 flex" role="tablist" aria-label="Sign in method">
              {(
                [
                  ["link", "Link Discord", DiscordLogo],
                  ["key", "Use a key", KeyIcon],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => {
                    setTab(id);
                    setError(null);
                  }}
                  className={`flex flex-1 items-center justify-center gap-2 border px-4 py-2.5
                    font-mono text-[12.5px] transition-colors duration-200 ${
                      tab === id
                        ? "border-ink bg-ink text-[var(--paper)]"
                        : "border-rule text-ink-2 hover:border-ink hover:text-ink"
                    }`}
                  style={{ borderRadius: "var(--r-sm)" }}
                >
                  <Icon size={14} weight="bold" />
                  {label}
                </button>
              ))}
            </div>

            {tab === "link" ? (
              <form onSubmit={submitCode} className="mt-6">
                <ol className="mb-5 space-y-2 text-[13.5px] text-ink-2">
                  <li>
                    <span className="num mr-2 text-ink-3">1</span>
                    Run <code className="font-mono text-ink">/link</code> in the Discord server.
                  </li>
                  <li>
                    <span className="num mr-2 text-ink-3">2</span>
                    Paste the six digit code it replies with.
                  </li>
                </ol>

                <label htmlFor="code" className="mb-2 block font-mono text-[11px] tracking-wide text-ink-3 uppercase">
                  Link code
                </label>
                <input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  className="h-11 w-full border border-rule bg-transparent px-3 font-mono text-[15px]
                             tracking-[0.3em] text-ink outline-none placeholder:tracking-[0.3em]
                             placeholder:text-ink-3 focus:border-signal"
                  style={{ borderRadius: "var(--r-sm)" }}
                />
                {error && <ErrorLine>{error}</ErrorLine>}
                <button
                  type="submit"
                  disabled={busy || code.length !== 6}
                  className="btn btn-primary mt-4 w-full disabled:opacity-40"
                >
                  {busy ? "Checking" : "Link account"}
                  {!busy && <ArrowRight size={13} weight="bold" />}
                </button>
              </form>
            ) : (
              <form onSubmit={submitKey} className="mt-6">
                <label htmlFor="loginkey" className="mb-2 block font-mono text-[11px] tracking-wide text-ink-3 uppercase">
                  Login key
                </label>
                <input
                  id="loginkey"
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="syde_sk_..."
                  className="h-11 w-full border border-rule bg-transparent px-3 font-mono text-[13px]
                             text-ink outline-none placeholder:text-ink-3 focus:border-signal"
                  style={{ borderRadius: "var(--r-sm)" }}
                />
                <p className="mt-2 text-[12.5px] text-ink-3">
                  The bot sent this to you when you first linked. Keys issued before
                  the rename still work.
                </p>
                {error && <ErrorLine>{error}</ErrorLine>}
                <button
                  type="submit"
                  disabled={busy || !key.trim()}
                  className="btn btn-primary mt-4 w-full disabled:opacity-40"
                >
                  {busy ? "Checking" : "Sign in"}
                  {!busy && <ArrowRight size={13} weight="bold" />}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Linked({
  me,
  dm,
  onContinue,
}: {
  me: Me;
  dm: "sending" | "sent" | "dms_closed" | "failed";
  onContinue: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <span
          className="grid size-10 place-items-center bg-signal font-mono text-[15px] text-[var(--on-signal)]"
          style={{ borderRadius: "var(--r-sm)" }}
          aria-hidden
        >
          {me.username.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <p className="h3 text-ink">{me.username}</p>
          <p className="font-mono text-[11.5px] text-ink-3">{me.role}</p>
        </div>
      </div>

      <div
        className="mt-6 border border-rule px-4 py-4"
        style={{ borderRadius: "var(--r-sm)" }}
      >
        {dm === "sending" && (
          <p className="text-[13.5px] text-ink-2">Sending your login key by Discord DM.</p>
        )}
        {dm === "sent" && (
          <p className="flex items-start gap-2 text-[13.5px] text-ink-2">
            <Check size={15} weight="bold" className="mt-0.5 shrink-0 text-signal" />
            Login key sent. Check your Discord DMs and keep it somewhere safe.
          </p>
        )}
        {(dm === "dms_closed" || dm === "failed") && (
          <p className="flex items-start gap-2 text-[13.5px] text-ink-2">
            <Warning size={15} weight="bold" className="mt-0.5 shrink-0 text-signal" />
            {dm === "dms_closed"
              ? "Your DMs are closed, so the key could not be delivered. Open DMs for the server and run /link again."
              : "The key could not be sent. Run /link again."}
          </p>
        )}
      </div>

      <button onClick={onContinue} className="btn btn-primary mt-5 w-full">
        Continue to keys
        <ArrowRight size={13} weight="bold" />
      </button>
    </div>
  );
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 flex items-start gap-2 text-[13px] text-signal">
      <Warning size={14} weight="bold" className="mt-0.5 shrink-0" />
      {children}
    </p>
  );
}
