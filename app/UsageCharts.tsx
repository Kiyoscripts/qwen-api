"use client";

import { useEffect, useState } from "react";

interface Usage {
  window: number;
  total: number;
  errors: number;
  series: { date: string; count: number }[];
  byModel: { model: string; count: number }[];
  perKey: { name: string; prefix: string; count: number }[];
}

export default function UsageCharts() {
  const [u, setU] = useState<Usage | null>(null);

  useEffect(() => {
    fetch("/api/account/usage").then((r) => (r.ok ? r.json() : null)).then(setU).catch(() => {});
  }, []);

  if (!u) return null;

  const successRate = u.total ? Math.round(((u.total - u.errors) / u.total) * 100) : 100;
  const modelMax = Math.max(1, ...u.byModel.map((m) => m.count));

  return (
    <div className="usage">
      <div className="usage-tiles">
        <Tile value={u.total.toLocaleString()} label={`Requests · ${u.window}d`} />
        <Tile value={`${successRate}%`} label="Success rate" />
        <Tile value={String(u.byModel.length)} label="Models used" />
        <Tile value={String(u.perKey.length)} label="Keys with traffic" />
      </div>

      <div className="usage-grid">
        <div className="usage-card glass">
          <div className="usage-card-head">Requests over time <span>last {u.window} days</span></div>
          <AreaChart series={u.series} />
        </div>

        <div className="usage-card glass">
          <div className="usage-card-head">By model</div>
          {u.byModel.length === 0 ? (
            <p className="usage-empty">No requests yet.</p>
          ) : (
            <div className="usage-bars">
              {u.byModel.slice(0, 8).map((m) => (
                <div key={m.model} className="usage-bar-row">
                  <span className="usage-bar-label" title={m.model}>{m.model}</span>
                  <span className="usage-bar-track"><span className="usage-bar-fill" style={{ width: `${(m.count / modelMax) * 100}%` }} /></span>
                  <span className="usage-bar-num">{m.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="usage-tile glass">
      <div className="usage-tile-num">{value}</div>
      <div className="usage-tile-lbl">{label}</div>
    </div>
  );
}

// Lightweight SVG area chart — no dependencies.
function AreaChart({ series }: { series: { date: string; count: number }[] }) {
  const W = 640, H = 170, pad = 8, bottom = 22;
  const n = series.length;
  const max = Math.max(1, ...series.map((s) => s.count));
  const innerW = W - pad * 2;
  const innerH = H - pad - bottom;
  const x = (i: number) => pad + (n <= 1 ? innerW / 2 : (i * innerW) / (n - 1));
  const y = (c: number) => pad + innerH - (c / max) * innerH;

  const pts = series.map((s, i) => `${x(i).toFixed(1)},${y(s.count).toFixed(1)}`);
  const line = `M ${pts.join(" L ")}`;
  const area = `${line} L ${x(n - 1).toFixed(1)},${(pad + innerH).toFixed(1)} L ${x(0).toFixed(1)},${(pad + innerH).toFixed(1)} Z`;
  const ticks = [0, Math.floor(n / 2), n - 1].filter((i, idx, a) => a.indexOf(i) === idx);
  const fmt = (d: string) => { const dt = new Date(d); return `${dt.getMonth() + 1}/${dt.getDate()}`; };

  return (
    <svg className="usage-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Requests over time">
      <defs>
        <linearGradient id="uc-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#uc-fill)" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      {ticks.map((i) => (
        <text key={i} x={x(i)} y={H - 6} fill="var(--faint)" fontSize="11" textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>{fmt(series[i].date)}</text>
      ))}
    </svg>
  );
}
