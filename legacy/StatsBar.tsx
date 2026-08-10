"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "./I18n";
import type { Dict } from "@/lib/i18n";

interface Stats {
  poolAccounts: number;
  oneCompilerAccounts: number;
  apiKeys: number;
  activeKeys24h: number;
  models: number;
}

// Labels are translation KEYS, resolved at render — a baked-in string here
// would not follow the language picker.
const TILES: { key: keyof Stats; label: keyof Dict; spark?: string }[] = [
  { key: "poolAccounts", label: "stat_qwen_pool", spark: "live" },
  { key: "oneCompilerAccounts", label: "stat_onecompiler_pool", spark: "live" },
  { key: "models", label: "stat_models" },
  { key: "apiKeys", label: "stat_api_keys" },
  { key: "activeKeys24h", label: "stat_active_keys", spark: "24h" },
];

// Count-up from the previous value to the next whenever stats change.
function useCountUp(target: number, ms = 900) {
  const [val, setVal] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(a + (target - a) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return val;
}

function Tile({ value, label, spark }: { value: number; label: keyof Dict; spark?: string }) {
  const shown = useCountUp(value);
  const t = useT();
  return (
    <div className="lp-stat glass">
      {spark && <span className="spark">{spark}</span>}
      <div className="num">{shown.toLocaleString()}</div>
      <div className="lbl">{t(label)}</div>
    </div>
  );
}

export default function StatsBar() {
  const [stats, setStats] = useState<Stats>({ poolAccounts: 0, oneCompilerAccounts: 0, apiKeys: 0, activeKeys24h: 0, models: 0 });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/stats", { cache: "no-store" });
        if (r.ok && alive) setStats(await r.json());
      } catch {
        /* keep last values */
      }
    };
    load();
    const id = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="lp-stats">
      {TILES.map((t) => (
        <Tile key={t.key} value={stats[t.key]} label={t.label} spark={t.spark} />
      ))}
    </div>
  );
}
