"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CustomProviders } from "../../../AdminPanel";

export function AdminProviderPage({ providerId }: { providerId: string }) {
  const [me, setMe] = useState<any>(undefined);
  useEffect(() => {
    fetch("/api/auth/me").then((response) => response.json()).then((body) => setMe(body.user || null)).catch(() => setMe(null));
  }, []);
  if (me === undefined) return <p className="body py-20 text-center">Loading...</p>;
  if (!me || me.role !== "admin") return <div className="py-20 text-center"><h1 className="h2 text-ink">Admin access required</h1><Link href="/" className="btn btn-ghost mt-6">Back home</Link></div>;
  return <CustomProviders providerId={providerId}/>;
}
