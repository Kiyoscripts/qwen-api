import { useEffect, useState } from "react";
import { me as fetchMe, type Me } from "../lib/api";
import { Link } from "../lib/router";

/**
 * Session state in the nav.
 *
 * Renders nothing until the answer is known, rather than flashing "Sign in" at
 * someone who is already signed in.
 */
export function Account() {
  const [user, setUser] = useState<Me | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    fetchMe().then((u) => live && setUser(u));
    return () => { live = false; };
  }, []);

  if (user === undefined) return <span className="size-9" aria-hidden />;

  if (!user)
    return (
      <Link to="/login" className="btn btn-primary hidden sm:inline-flex">
        Sign in
      </Link>
    );

  return (
    <Link
      to="/keys"
      className="flex items-center gap-2 border border-rule px-2 py-1.5 no-underline
                 transition-colors duration-200 hover:border-ink"
      style={{ borderRadius: "var(--r-sm)" }}
    >
      <span
        className="grid size-6 shrink-0 place-items-center bg-signal font-mono text-[11px]
                   text-[var(--on-signal)]"
        style={{ borderRadius: "var(--r-sm)" }}
        aria-hidden
      >
        {user.username.slice(0, 1).toUpperCase()}
      </span>
      <span className="hidden font-mono text-[12px] text-ink sm:inline">{user.username}</span>
    </Link>
  );
}
