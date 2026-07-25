"use client";

import { useEffect, useState } from "react";

export interface Me {
  id: string;
  username: string | null;
  discord_id: string | null;
  avatar: string | null;
  role: string;
}

/**
 * The signed-in account, or null when signed out.
 *
 * `undefined` means "still checking" — worth distinguishing, because rendering a
 * "Log in" button during the check makes every page flash logged-out on load,
 * which is exactly what made the session feel like it wasn't sticking.
 */
export function useMe(): Me | null | undefined {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => alive && setMe(j?.user ?? null))
      .catch(() => alive && setMe(null));
    return () => {
      alive = false;
    };
  }, []);
  return me;
}

/** Discord sends a full URL these days, but older rows hold a bare hash. */
export function avatarUrl(me: Me): string | null {
  if (!me.avatar) return null;
  if (me.avatar.startsWith("http")) return me.avatar;
  return `https://cdn.discordapp.com/avatars/${me.discord_id}/${me.avatar}.png`;
}

/** Small avatar + name, used in navs and rails. */
export function AccountChip({ me }: { me: Me }) {
  const src = avatarUrl(me);
  return (
    <>
      {src ? <img src={src} alt="" /> : <span className="auth-avatar-fallback" />}
      <span className="dash-me-name">{me.username || "Account"}</span>
      {me.role && me.role !== "member" && <span className={`role-tag ${me.role}`}>{me.role}</span>}
    </>
  );
}

/**
 * Nav call-to-action: your account when signed in, "Log in" when not. Reserves
 * its own width while checking so the nav doesn't jump.
 */
export default function AccountNav() {
  const me = useMe();
  if (me === undefined) return <span className="nav-acct-ph" aria-hidden="true" />;
  if (!me) return <a className="g-btn" href="/login">Log in</a>;
  return (
    <a className="nav-acct" href="/keys" title="Open your dashboard">
      <AccountChip me={me} />
    </a>
  );
}
