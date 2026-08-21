"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Copy, Check, Warning, SignOut } from "@phosphor-icons/react";
import { useT } from "./I18n";

interface Key {
  id: string; name: string | null; key_prefix: string;
  created_at: string; last_used_at: string | null; request_count: number; revoked: boolean;
  expires_at?: string | null; request_limit?: number | null; allowed_models?: string[] | null; allowed_ips?: string[] | null;
}
interface Usage { authenticatedRequests: number; total: number; success: number; errors: number; errorRate: number; latency: { average: number; p50: number; p95: number; p99: number }; series: { date: string; count: number; errors: number }[]; byModel: { model: string; count: number; errors: number; average_latency_ms: number }[]; perKey: { id: string; name: string | null; key_prefix: string; request_count: number; request_limit: number | null; revoked: boolean; expires_at: string | null; window_count: number; errors: number }[]; keys: { id: string; name: string | null; key_prefix: string }[] }

/**
 * Keys and usage.
 *
 * The one thing this has to get right is that a new key is shown exactly once:
 * it comes back on create and is never stored readable. Hence a banner that
 * waits to be dismissed, not a toast that times out.
 */
export function KeysPanel() {
  const t = useT();
  const router = useRouter();
  const [me, setMe] = useState<any>(undefined);
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageDays, setUsageDays] = useState("30");
  const [usageKey, setUsageKey] = useState("");
  const [name, setName] = useState("");
  const [requestLimit, setRequestLimit] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [allowedModels, setAllowedModels] = useState("");
  const [allowedIps, setAllowedIps] = useState("");
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Key | null>(null);
  const [editLimit, setEditLimit] = useState("");
  const [editExpiry, setEditExpiry] = useState("");
  const [editModels, setEditModels] = useState("");
  const [editIps, setEditIps] = useState("");
  const [overlapMinutes, setOverlapMinutes] = useState("60");

  useEffect(() => {
    let live = true;
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : { user: null })).then((j) => {
      if (!live) return;
      setMe(j.user ?? null);
      if (!j.user) return;
      fetch("/api/account/keys").then((r) => r.json()).then((j) => live && setKeys(j.keys ?? []));
      fetch("/api/account/usage").then((r) => r.json()).then((j) => live && setUsage(j));
    });
    return () => { live = false; };
  }, []);

  if (me === undefined) return <Skeleton />;

  if (me === null)
    return (
      <div className="py-16 text-center">
        <h1 className="h2 text-ink">{t("login_title")}</h1>
        <p className="body mx-auto mt-3 text-[14px]">{t("login_no_account")}</p>
        <Link href="/login" className="btn btn-primary mt-6">{t("login_submit")}</Link>
      </div>
    );

  const create = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/account/keys", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), request_limit: requestLimit, expires_at: expiresAt || null, allowed_models: allowedModels.split(/[\n,]+/).map(x => x.trim()).filter(Boolean), allowed_ips: allowedIps.split(/[\n,]+/).map(x => x.trim()).filter(Boolean) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setFresh(j.key);
      setName("");
      const list = await (await fetch("/api/account/keys")).json();
      setKeys(list.keys ?? []);
    } catch { setError(t("error")); } finally { setBusy(false); }
  };

  const openEdit = (key: Key) => { setEditing(key); setEditLimit(key.request_limit?.toString() || ""); setEditExpiry(key.expires_at ? key.expires_at.slice(0,16) : ""); setEditModels((key.allowed_models || []).join("\n")); setEditIps((key.allowed_ips || []).join("\n")); setError(null); };
  const saveEdit = async () => { if (!editing) return; setBusy(true); try { const split=(value:string)=>value.split(/[\n,]+/).map(x=>x.trim()).filter(Boolean); const r=await fetch("/api/account/keys",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:editing.id,request_limit:editLimit,expires_at:editExpiry||null,allowed_models:split(editModels),allowed_ips:split(editIps)})});const j=await r.json();if(!r.ok)throw new Error(j.error);const list=await(await fetch("/api/account/keys")).json();setKeys(list.keys||[]);setEditing(null); } catch(e:any){setError(e.message);} finally {setBusy(false);} };

  const rotate = async () => { if(!editing)return;setBusy(true);setError(null);try{const r=await fetch("/api/account/keys/rotate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:editing.id,overlap_minutes:Number(overlapMinutes)})}),j=await r.json();if(!r.ok)throw new Error(j.error);setFresh(j.key);setEditing(null);const list=await(await fetch("/api/account/keys")).json();setKeys(list.keys||[]);}catch(e:any){setError(e.message);}finally{setBusy(false);} };

  const revoke = async (id: string) => {
    setKeys((p) => (p ?? []).map((k) => (k.id === id ? { ...k, revoked: true } : k)));
    await fetch("/api/account/keys/revoke", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  };

  const series = usage?.series ?? [];
  const peak = Math.max(1, ...series.map((d) => d.count));
  const loadUsage = () => fetch(`/api/account/usage?days=${usageDays}&key=${encodeURIComponent(usageKey)}`).then(r => r.json().then(j => { if (!r.ok) throw new Error(j.error || "Usage request failed"); return j; })).then(setUsage).catch(e => setError(e.message));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h2 text-ink">{t("keys_title")}</h1>
          <p className="body mt-3 text-[14px]">
            {t("admin_signed_in_as")} <span className="text-ink">{me.username}</span>
          </p>
        </div>
        <button
          onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/"); router.refresh(); }}
          className="btn btn-ghost h-9 px-4">
          <SignOut size={13} weight="bold" />{t("keys_sign_out")}
        </button>
      </div>



      {fresh && (
        <div className="mt-7 border border-[var(--signal)] bg-[var(--signal-wash)] px-4 py-4"
             style={{ borderRadius: "var(--r-sm)" }}>
          <p className="text-[13.5px] font-medium text-signal">{t("keys_shown_once")}</p>
          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate border border-[var(--signal)] bg-[var(--paper)] px-3 py-2
                             font-mono text-[12.5px] text-ink" style={{ borderRadius: "var(--r-sm)" }}>
              {fresh}
            </code>
            <button onClick={async () => { await navigator.clipboard.writeText(fresh); setCopied(true); setTimeout(() => setCopied(false), 1600); }}
                    className="btn btn-primary h-9 shrink-0 px-3">
              {copied ? <Check size={13} weight="bold" /> : <Copy size={13} weight="bold" />}
              {copied ? t("keys_copied") : t("keys_copy")}
            </button>
          </div>
          <button onClick={() => setFresh(null)} className="mt-3 font-mono text-[11.5px] text-signal underline underline-offset-2">
            {t("close")}
          </button>
        </div>
      )}

      <section className="mt-8"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="eyebrow">Usage intelligence</p><h2 className="mt-1 text-xl text-ink">Requests and quota</h2></div><div className="flex gap-2"><select className="h-10 border border-rule bg-transparent px-3 font-mono text-xs text-ink" value={usageDays} onChange={e=>setUsageDays(e.target.value)}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">365 days</option></select><select className="h-10 max-w-52 border border-rule bg-transparent px-3 font-mono text-xs text-ink" value={usageKey} onChange={e=>setUsageKey(e.target.value)}><option value="">All keys</option>{(usage?.keys||[]).map(k=><option key={k.id} value={k.id}>{k.name||"Untitled"} · {k.key_prefix}</option>)}</select><button className="btn btn-ghost" onClick={loadUsage}>Apply</button></div></div>{usage&&<><div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">{[["Authenticated",usage.authenticatedRequests],["Completed",usage.total],["Successful",usage.success],["Errors",usage.errors],["p95 latency",`${usage.latency.p95} ms`]].map(([label,value])=><div className="border border-rule p-4" key={String(label)}><p className="font-mono text-[10px] uppercase text-ink-3">{label}</p><p className="mt-2 text-xl text-ink">{value}</p></div>)}</div><div className="mt-4 grid gap-4 lg:grid-cols-2"><div className="border border-rule p-5"><b className="text-sm text-ink">Model breakdown</b><div className="mt-3 space-y-2">{usage.byModel.slice(0,10).map(x=><div className="flex justify-between gap-3 text-xs" key={x.model}><span className="truncate font-mono text-ink-2">{x.model}</span><span className="text-ink-3">{x.count} · {x.errors} errors · {x.average_latency_ms} ms</span></div>)}</div></div><div className="border border-rule p-5"><b className="text-sm text-ink">Key quota visibility</b><div className="mt-3 space-y-3">{usage.perKey.map(x=><div key={x.id}><div className="flex justify-between gap-3 text-xs"><span className="font-mono text-ink-2">{x.name||"Untitled"} · {x.key_prefix}</span><span className="text-ink-3">{x.request_count}/{x.request_limit||"∞"}</span></div>{x.request_limit&&<div className="mt-1 h-1.5 bg-[var(--paper-2)]"><div className="h-full bg-signal" style={{width:`${Math.min(100,x.request_count/x.request_limit*100)}%`}}/></div>}</div>)}</div></div></div></>}</section>

      {series.length > 0 && (
        <div className="mt-4 border border-rule p-5" style={{ borderRadius: "var(--r-sm)" }}>
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[11.5px] text-ink-3">{t("usage_requests_over_time")}</span>
            <span className="num text-[13px] text-ink">{(usage?.total ?? 0).toLocaleString()}</span>
          </div>
          <div className="mt-4 flex h-20 items-end gap-1">
            {series.map((d) => (
              <div key={d.date} title={`${d.date}: ${d.count} requests, ${d.errors} errors`} className="flex-1 bg-signal"
                   style={{ height: `${Math.max(3, (d.count / peak) * 100)}%` }} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-8 grid gap-3 md:grid-cols-2">
        <input type="number" min="0" value={requestLimit} onChange={e=>setRequestLimit(e.target.value)} placeholder="Request limit (blank uses default)" className="h-10 border border-rule bg-transparent px-3 font-mono text-[12.5px] text-ink outline-none focus:border-signal" />
        <input type="datetime-local" value={expiresAt} onChange={e=>setExpiresAt(e.target.value)} className="h-10 border border-rule bg-transparent px-3 font-mono text-[12.5px] text-ink outline-none focus:border-signal" />
        <textarea rows={3} value={allowedModels} onChange={e=>setAllowedModels(e.target.value)} placeholder="Allowed model IDs, one per line (blank allows all)" className="border border-rule bg-transparent px-3 py-2 font-mono text-[12.5px] text-ink outline-none focus:border-signal" />
        <textarea rows={3} value={allowedIps} onChange={e=>setAllowedIps(e.target.value)} placeholder="Allowed IP addresses, one per line (blank allows all)" className="border border-rule bg-transparent px-3 py-2 font-mono text-[12.5px] text-ink outline-none focus:border-signal" />
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <label htmlFor="keyname" className="mb-2 block font-mono text-[11px] tracking-wide text-ink-3 uppercase">
            {t("keys_label_optional")}
          </label>
          <input id="keyname" value={name} onChange={(e) => setName(e.target.value)}
            placeholder={t("keys_name_placeholder")}
            className="h-10 w-full border border-rule bg-transparent px-3 font-mono text-[12.5px]
                       text-ink outline-none placeholder:text-ink-3 focus:border-signal"
            style={{ borderRadius: "var(--r-sm)" }} />
        </div>
        <button onClick={create} disabled={busy} className="btn btn-primary disabled:opacity-40">
          <Plus size={13} weight="bold" />{busy ? t("loading") : t("keys_create_btn")}
        </button>
      </div>
      {error && <p className="mt-3 flex items-center gap-2 text-[13px] text-signal"><Warning size={14} weight="bold" />{error}</p>}

      <div className="mt-8">
        {!keys ? <Skeleton /> : keys.length === 0 ? (
          <div className="border border-dashed border-rule-strong px-6 py-14 text-center" style={{ borderRadius: "var(--r-sm)" }}>
            <p className="h3 text-ink">{t("keys_none")}</p>
            <p className="body mx-auto mt-2 text-[13.5px]">{t("keys_none_create")}</p>
          </div>
        ) : (
          <div className="border border-rule" style={{ borderRadius: "var(--r-sm)" }}>
            {keys.map((k, i) => (
              <div key={k.id} className={`flex flex-wrap items-center gap-4 px-4 py-3.5 ${i > 0 ? "border-t border-rule" : ""}`}>
                <div className="min-w-0 flex-1">
                  <p className={`text-[13.5px] ${k.revoked ? "text-ink-3 line-through" : "text-ink"}`}>
                    {k.name || t("keys_label_optional")}
                  </p>
                  <p className="font-mono text-[11.5px] text-ink-3">{k.key_prefix}</p>
                  <p className="mt-1 text-[11px] text-ink-3">Limit: {k.request_limit ?? "unlimited"} · Expires: {k.expires_at ? new Date(k.expires_at).toLocaleString() : "never"}</p>
                  <p className="text-[11px] text-ink-3">Models: {k.allowed_models?.join(", ") || "all"} · IPs: {k.allowed_ips?.join(", ") || "all"}</p>
                </div>
                <span className="num text-[12px] text-ink-3">{k.request_count.toLocaleString()} {t("usage_req_short")}</span>
                {!k.revoked && <button onClick={() => openEdit(k)} className="font-mono text-[11.5px] text-ink-3 hover:text-signal">Edit limits</button>}
                {k.revoked ? (
                  <span className="font-mono text-[11px] text-ink-3">{t("keys_revoked")}</span>
                ) : (
                  <button onClick={() => revoke(k.id)}
                          className="font-mono text-[11.5px] text-ink-3 transition-colors duration-200 hover:text-signal">
                    {t("keys_revoke")}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {editing && <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="edit-key-title" onMouseDown={(e)=>{if(e.target===e.currentTarget)setEditing(null);}}><div className="w-full max-w-xl border border-rule bg-[var(--paper)] p-6 shadow-2xl"><div className="flex items-start justify-between gap-4"><div><p className="eyebrow">API key policy</p><h2 id="edit-key-title" className="mt-1 text-xl text-ink">Edit {editing.name || "Untitled key"}</h2></div><button onClick={()=>setEditing(null)} className="font-mono text-xs text-ink-3">Close</button></div><div className="mt-6 grid gap-4 sm:grid-cols-2"><label className="text-xs text-ink-2">Total request limit<input className="input mt-2 w-full" type="number" min="0" value={editLimit} onChange={e=>setEditLimit(e.target.value)} placeholder="Unlimited" /></label><label className="text-xs text-ink-2">Expires at<input className="input mt-2 w-full" type="datetime-local" value={editExpiry} onChange={e=>setEditExpiry(e.target.value)} /></label><label className="text-xs text-ink-2 sm:col-span-2">Allowed models<textarea className="input mt-2 min-h-24 w-full" value={editModels} onChange={e=>setEditModels(e.target.value)} placeholder="One model per line; blank allows all" /></label><label className="text-xs text-ink-2 sm:col-span-2">Allowed IP addresses<textarea className="input mt-2 min-h-20 w-full" value={editIps} onChange={e=>setEditIps(e.target.value)} placeholder="One IPv4 or IPv6 address per line; blank allows all" /></label></div><div className="mt-5 border-t border-rule pt-5"><p className="text-sm font-medium text-ink">Rotate credentials</p><p className="mt-1 text-xs text-ink-3">Creates a replacement with this policy. The current key remains valid during the overlap.</p><div className="mt-3 flex items-end gap-3"><label className="flex-1 text-xs text-ink-2">Overlap in minutes<input className="input mt-2 w-full" type="number" min="0" max="10080" value={overlapMinutes} onChange={e=>setOverlapMinutes(e.target.value)} /></label><button className="btn btn-ghost" disabled={busy} onClick={rotate}>Rotate key</button></div></div>{error&&<p className="mt-4 text-sm text-signal">{error}</p>}<div className="mt-6 flex justify-end gap-3"><button className="btn btn-ghost" onClick={()=>setEditing(null)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={saveEdit}>{busy?"Saving...":"Save policy"}</button></div></div></div>}
    </>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-14 animate-pulse border border-rule bg-[var(--paper-2)]"
             style={{ borderRadius: "var(--r-sm)" }} />
      ))}
    </div>
  );
}
