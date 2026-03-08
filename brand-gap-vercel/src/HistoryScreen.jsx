import { useState, useEffect } from "react";

// ─── REUSING YOUR DESIGN SYSTEM ───────────────────────────────────────────────
// These match the variables already defined in App.jsx's CSS

const Badge = ({ children, color = "#111827" }) => (
  <span style={{
    display: "inline-flex", alignItems: "center",
    padding: "2px 8px", borderRadius: 99,
    fontSize: 11, fontFamily: "var(--font-mono)",
    color, background: `${color}12`,
    border: `1px solid ${color}20`, whiteSpace: "nowrap"
  }}>{children}</span>
);

const Spin = ({ size = 14, color = "#111827" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24"
    style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }}>
    <circle cx="12" cy="12" r="10" fill="none" stroke={color}
      strokeWidth="2.5" strokeDasharray="40" strokeDashoffset="15"
      strokeLinecap="round" />
  </svg>
);

// ─── RUN CARD ─────────────────────────────────────────────────────────────────
// This is a component. It takes one prop: `run` (an object with brand, market, etc.)
// and renders a card. Notice it knows nothing about the rest of the app.

function RunCard({ run, onSelect }) {
  const date = new Date(run.createdAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric"
  });

  return (
    <div
      onClick={() => { console.log('run:', run); onSelect(run.id); }}
      style={{
        padding: "18px 20px",
        border: "1px solid var(--gray-200)",
        borderRadius: "var(--radius)",
        background: "var(--white)",
        boxShadow: "var(--shadow-sm)",
        cursor: "pointer",
        transition: "all 0.15s",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = "var(--gray-400)";
        e.currentTarget.style.boxShadow = "var(--shadow)";
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = "var(--gray-200)";
        e.currentTarget.style.boxShadow = "var(--shadow-sm)";
      }}
    >
      {/* Top row: brand name + date */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ fontSize: 22, fontFamily: "var(--font-serif)", color: "var(--gray-900)", lineHeight: 1.1 }}>
          {run.brand || "Unnamed"}
        </div>
        <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--gray-400)" }}>
          {date}
        </div>
      </div>

      {/* Product + market */}
      <div style={{ fontSize: 13, color: "var(--gray-500)" }}>
        {run.product} · <span style={{ color: "var(--gray-400)" }}>{run.market}</span>
      </div>

      {/* Badges */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {run.gapScore && (
          <Badge color="#111827">Gap {run.gapScore}/10</Badge>
        )}
        {run.verdict && (
          <Badge color={run.verdict === "PERFECT TIMING" ? "#16a34a" : "#d97706"}>
            {run.verdict}
          </Badge>
        )}
      </div>
    </div>
  );
}

// ─── STATS BAR ────────────────────────────────────────────────────────────────
// Another component — takes the full list of runs and shows summary numbers.

function StatsBar({ runs }) {
  const total = runs.length;

  // Find the most common market
  const marketCounts = runs.reduce((acc, r) => {
    acc[r.market] = (acc[r.market] || 0) + 1;
    return acc;
  }, {});
  const topMarket = Object.entries(marketCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0];

  // Average gap score
  const scores = runs.map(r => r.gapScore).filter(Boolean);
  const avgScore = scores.length
    ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
    : "—";

  return (
    <div style={{
      display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap"
    }}>
      {[
        { value: total, label: "Total runs" },
        { value: topMarket || "—", label: "Top market" },
        { value: avgScore, label: "Avg gap score" },
      ].map(({ value, label }) => (
        <div key={label} style={{
          flex: 1, minWidth: 120,
          padding: "14px 16px",
          border: "1px solid var(--gray-200)",
          borderRadius: "var(--radius)",
          background: "var(--white)",
          boxShadow: "var(--shadow-sm)"
        }}>
          <div style={{ fontSize: 22, fontFamily: "var(--font-serif)", color: "var(--gray-900)", marginBottom: 4 }}>
            {String(value)}
          </div>
          <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--gray-400)", letterSpacing: "0.06em" }}>
            {label}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── HISTORY SCREEN ───────────────────────────────────────────────────────────
// This is the main export — the whole screen.
// It takes one prop: `onViewRun` — a function to call when the user
// clicks a run card. The parent (App.jsx) decides what happens next.

export default function HistoryScreen({ onViewRun }) {
  const [runs, setRuns]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  // useEffect runs once when the component first appears on screen.
  // This is where you fetch data.
  useEffect(() => {
    async function loadRuns() {
      try {
        const res = await fetch('/api/history');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const parsed = (data.runs || []).flat().map(item => {
  try { return typeof item === 'string' ? JSON.parse(item) : item; } catch { return null; }
}).filter(Boolean);
setRuns(parsed);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    loadRuns();
  }, []); // the [] means "run once on mount"

  // ── Loading state ──
  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", gap: 12 }}>
      <Spin size={18} />
      <span style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: "var(--gray-400)" }}>
        Loading history…
      </span>
    </div>
  );

  // ── Error state ──
  if (error) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 13, color: "var(--red)", fontFamily: "var(--font-mono)" }}>Failed to load: {error}</div>
      <div style={{ fontSize: 12, color: "var(--gray-400)" }}>Check that Vercel KV is configured correctly.</div>
    </div>
  );

  // ── Empty state ──
  if (runs.length === 0) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 32, fontFamily: "var(--font-serif)", color: "var(--gray-200)" }}>No runs yet</div>
      <div style={{ fontSize: 13, color: "var(--gray-400)" }}>Complete a run and it will appear here.</div>
    </div>
  );

  // ── Main view ──
  return (
    <div style={{ padding: "40px 48px", maxWidth: 900, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--gray-400)", letterSpacing: "0.08em", marginBottom: 8 }}>
          HISTORY
        </div>
        <h1 style={{ fontSize: 36, fontFamily: "var(--font-serif)", color: "var(--gray-900)", letterSpacing: "-0.02em", marginBottom: 8 }}>
          Past runs
        </h1>
        <p style={{ fontSize: 14, color: "var(--gray-500)", lineHeight: 1.7 }}>
          Every brand gap you've found. Click any card to load the full report.
        </p>
      </div>

      {/* Stats */}
      <StatsBar runs={runs} />

      {/* Grid of run cards */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
        gap: 14
      }}>
        {runs.map(run => (
          <RunCard key={run.id} run={run} onSelect={onViewRun} />
        ))}
      </div>
    </div>
  );
}
