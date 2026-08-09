/* A router small enough not to be a dependency.
   Four routes, no params, no nesting. react-router would be more code in
   node_modules than the whole of this file. */

import { createContext, useCallback, useContext, useEffect, useState } from "react";

const RouteCtx = createContext<{ path: string; go: (to: string) => void }>({
  path: "/",
  go: () => {},
});

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = useCallback((to: string) => {
    if (to === window.location.pathname) return;
    window.history.pushState({}, "", to);
    setPath(to);
    window.scrollTo({ top: 0 });
  }, []);

  return <RouteCtx.Provider value={{ path, go }}>{children}</RouteCtx.Provider>;
}

export const useRoute = () => useContext(RouteCtx);

/** An anchor that stays an anchor: real href, middle-click and cmd-click work. */
export function Link({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { go } = useRoute();
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        go(to);
      }}
    >
      {children}
    </a>
  );
}
