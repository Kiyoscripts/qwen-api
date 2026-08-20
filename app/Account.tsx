"use client";

import { useEffect, useState } from "react";
import { useT } from "./I18n";

export interface Me {
  id: string;
  username: string;
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

/** Small identity chip used in navigation and dashboard rails. */
export function AccountChip({ me }: { me: Me }) {
  return (
    <>
      <span className="auth-avatar-fallback" />
      <span className="dash-me-name">{me.username || "Account"}</span>
      {me.role === "admin" && <span className="role-tag admin">admin</span>}
    </>
  );
}

/**
 * Nav call-to-action: your account when signed in, "Log in" when not. Reserves
 * its own width while checking so the nav doesn't jump.
 */
export default function AccountNav() {
  const t = useT();
  const me = useMe();
  if (me === undefined) return <span className="nav-acct-ph" aria-hidden="true" />;
  if (!me) return <a className="g-btn" href="/login">{t("nav_login")}</a>;
  return (
    <a className="nav-acct" href="/keys" title={t("chat_open_dashboard")}>
      <AccountChip me={me} />
    </a>
  );
}
