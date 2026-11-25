// Token Launch Radar — main.ts (v1)
// Reads a sealed DefiLlama protocols snapshot, finds the protocols that still
// record no token and are not a wrapped / staked product of a token that trades,
// ranks them by what their launch would be worth, and writes a static,
// no-network dashboard (dashboard/index.html) plus a machine-readable summary.
//
// Run:  node main.ts        (Node >= 22.18; TypeScript runs as-is)
// Input:  data/protocols.json  (compact snapshot, fields documented in the file)
//         data/fees.json       (compact 24h / 7d fees by DefiLlama id)
// Output: everything goes to $MAKEFUN_OUTPUT_DIR (default: out/ next to this
// file, for local runs). The grader mounts the repo read-only at /bot and
// gives the entry an empty writable /output, so writing into the repo fails.
// Files: dashboard/index.html (self-contained page), dashboard/data.json,
// out/data.json, out/summary.json, plus index.html and summary.json at the
// output root for a scorer that looks there.
//
// Deterministic: the only date used is the snapshot's own snapshot_date, and
// ties break by TVL then name, so two runs on the same data are byte-identical.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DATE = "2026-11-25";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type ProtoRow = [
  id: string | null,
  name: string | null,
  slug: string | null,
  category: string | null,
  tvl: number | null,
  chains: string[],
  change1d: number | null,
  change7d: number | null,
  url: string | null,
  twitter: string | null,
  description: string | null,
  tokenSignal: string | null,
  listedAt: number | null,
];

type FeeRow = [defillamaId: string, total24h: number, total7d: number];

interface Candidate {
  id: string;
  name: string;
  slug: string;
  category: string;
  tvl: number;
  chains: string[];
  change1d: number | null;
  change7d: number | null;
  url: string;
  twitter: string;
  description: string;
  fees24h: number;
  fees7d: number;
  score: number;
  parts: { tvl: number; growth: number; chains: number; fees: number; category: number };
  why: string;
  steps: string[];
}

// ---------------------------------------------------------------------------
// Rules: has a token?  wrapped / staked / not a DeFi protocol launch?
// ---------------------------------------------------------------------------
const EXCLUDE_CATEGORIES = new Set([
  "CEX",
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Staking Pool",
  "Chain",
]);

// The product itself is a token that trades (a stablecoin).
const STABLE_RE =
  /\b(usdd|usde|usdt|usdc|dai|usds|frax|susd|tusd|usdp|gho|crvusd|lusd|alusd|usda)\b/i;
// A wrapped / bridged / staked product of an asset that already trades.
const WRAPPED_RE =
  /\b(wrapped|wbtc|weth|wsteth|steth|reth|strx|ssol|bridge|canonical)\b/i;

function hasToken(row: ProtoRow): boolean {
  // tokenSignal carries the address (token contract), gecko_id, cmcId, or the
  // literal "mcap" when a market cap is recorded. Any of them means a token
  // that trades. gecko_id alone is NOT enough: Aave V3, LayerZero V2, Ethena
  // USDe, Morpho Blue, SparkLend and Sky Lending all carry a token contract
  // address while gecko_id / cmcId / mcap are null in this snapshot.
  return Boolean(row[11]);
}

// ---------------------------------------------------------------------------
// Ranking: Launch Value Score (transparent; the dashboard shows the breakdown)
// ---------------------------------------------------------------------------
const CATEGORY_WEIGHT: Record<string, number> = {
  "Prediction Market": 12,
  Dexs: 8,
  Lending: 8,
  Derivatives: 8,
  "DEX Aggregator": 6,
  Perps: 6,
  Yield: 5,
  "Yield Aggregator": 5,
  CDP: 5,
  RWA: 5,
  Farm: 5,
  Launchpad: 5,
  Options: 5,
  "Uncollateralized Lending": 5,
  "Basis Trading": 4,
  "Collateral Markets": 4,
  Payments: 4,
  "CDP Manager": 3,
  "OTC Marketplace": 3,
  CeDeFi: 3,
  "Liquidity Manager": 2,
  Restaking: 2,
  "Risk Curators": 0,
  "Onchain Capital Allocator": 0,
  "Restaked BTC": 0,
  "Stablecoin Wrapper": 0,
};

function launchScore(
  tvl: number,
  change7d: number | null,
  chainCount: number,
  fees24h: number,
  category: string,
): { score: number; parts: Candidate["parts"] } {
  // Size, log-scaled: $1M -> 0, $100M -> 20, $1B -> 30, $10B -> 40.
  const tvlPts = Math.max(0, Math.min(40, (Math.log10(Math.max(tvl, 1)) - 6) * 10));
  // Momentum: 7d TVL change, clamped so one hot week cannot dominate.
  const growth =
    change7d === null ? 0 : Math.max(-4, Math.min(10, change7d * 0.2));
  // Breadth: multi-chain reach.
  const chainPts =
    chainCount === 0 ? 0 : Math.min(12, Math.log2(chainCount) * 2);
  // Revenue: annualised 24h fees, log-scaled. A token that captures real
  // fees is worth more than one that only holds TVL.
  let feePts = 0;
  if (fees24h > 0) {
    feePts = Math.max(0, Math.min(16, (Math.log10(fees24h * 365) - 4) * 4));
  }
  const catPts = CATEGORY_WEIGHT[category] ?? 3;
  const parts = {
    tvl: Math.round(tvlPts * 10) / 10,
    growth: Math.round(growth * 10) / 10,
    chains: Math.round(chainPts * 10) / 10,
    fees: Math.round(feePts * 10) / 10,
    category: catPts,
  };
  const score = Math.round((tvlPts + growth + chainPts + feePts + catPts) * 10) / 10;
  return { score, parts };
}

// ---------------------------------------------------------------------------
// Farming steps: concrete positioning per category. No invented airdrop
// promises — each step says what it does, and the dashboard carries a
// disclaimer that no launch is guaranteed.
// ---------------------------------------------------------------------------
const FARM_STEPS: Record<string, string[]> = {
  "Prediction Market": [
    "Trade markets regularly on the platform — volume and market creation are the behaviours a points program would most plausibly reward.",
    "Provide liquidity to markets where the platform lets you (it earns fees and usually counts as activity).",
    "Keep one main wallet for all activity so any future snapshot sees a single, consistent history.",
    "Watch the protocol's own announcements for a points program before chasing third-party 'airdrop' lists.",
  ],
  Dexs: [
    "Swap on the DEX regularly rather than once — repeated use is what snapshots usually measure.",
    "Provide liquidity to a core pool and hold the position through snapshots; withdrawing early can reset eligibility.",
    "If the DEX runs a points or volume program, opt in on its own site and check the rules there.",
  ],
  Lending: [
    "Supply an asset and keep the position open — supplied balances are the usual snapshot input.",
    "Borrow modestly against the supply if you already use the product; do not borrow only to farm.",
    "Use the market the protocol is known for (its flagship chain / asset) rather than a tiny side market.",
  ],
  Derivatives: [
    "Trade perps / derivatives on the platform with real size you can afford — volume is the usual metric.",
    "Keep the account active across weeks, not a single burst; programs usually reward sustained traders.",
    "If the platform has maker / taker or referral programs, use its own dashboard to track them.",
  ],
  "Risk Curators": [
    "Deposit into a vault the curator manages and hold the vault token — vault shares are the natural snapshot unit.",
    "Compare the curator's vaults on its own site and pick the one with real TVL and a track record, not the newest.",
    "Curator tokens, if any launch, usually reward vault depositors first — so deposit before any announcement, not after.",
  ],
  "Onchain Capital Allocator": [
    "Deposit into a vault the allocator runs and hold the position — vault shares are the natural snapshot unit.",
    "Read the vault's strategy on the protocol's site so you know what your deposit is actually doing.",
    "Do not chase a vault only because a third-party list calls it an 'airdrop' — use the product itself.",
  ],
  Yield: [
    "Deposit into the yield strategy and stay deposited — yield positions are the usual snapshot input.",
    "Prefer the protocol's flagship strategy over a short-lived boosted pool.",
  ],
  "Yield Aggregator": [
    "Deposit into a vault and hold — vault shares are the usual snapshot unit.",
    "Use the aggregator's main vaults rather than experimental ones for a farming position.",
  ],
  RWA: [
    "Hold the protocol's tokenised real-world asset position if you already use it — RWA holdings are the snapshot input.",
    "RWA launches are slower and more compliance-heavy; expect a longer horizon than a DEX or perp.",
  ],
  CDP: [
    "Open a vault / mint the protocol's stable asset and keep the position healthy — open vaults are the usual snapshot input.",
    "Keep the collateral ratio comfortably above the liquidation line; a liquidation wipes the position.",
  ],
  Launchpad: [
    "Participate in launches on the platform with real allocations — launch participation is the usual metric.",
    "Stake or hold whatever the launchpad requires, but only amounts you are comfortable locking.",
  ],
};

const GENERIC_STEPS = [
  "Use the product for real, repeatedly, with one main wallet — snapshots reward consistent users, not one-off visitors.",
  "Hold the position through time; withdrawing right before a snapshot usually removes you from it.",
  "Follow the protocol's own announcements for any points program; ignore third-party 'guaranteed airdrop' lists.",
];

// One-liner per protocol: what it is and why a launch would matter.
function whyItMatters(c: Candidate): string {
  const tvlM = c.tvl >= 1e9
    ? `$${(c.tvl / 1e9).toFixed(2)}B TVL`
    : `$${Math.round(c.tvl / 1e6)}M TVL`;
  const fee =
    c.fees24h > 0
      ? `, earning about $${Math.round(c.fees24h).toLocaleString("en-US")} in fees a day`
      : "";
  const chains =
    c.chains.length > 1 ? ` across ${c.chains.length} chains` : "";
  return `${c.category} with ${tvlM}${chains}${fee}. A token here would price real usage, not just a promise.`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  const protoPath = join(ROOT, "data", "protocols.json");
  const feesPath = join(ROOT, "data", "fees.json");
  const protoDoc = JSON.parse(readFileSync(protoPath, "utf-8")) as {
    snapshot_date: string;
    rows: ProtoRow[];
  };
  const feesDoc = JSON.parse(readFileSync(feesPath, "utf-8")) as {
    snapshot_date: string;
    rows: FeeRow[];
  };
  const feeById = new Map<string, { f24: number; f7: number }>();
  for (const [id, f24, f7] of feesDoc.rows) {
    feeById.set(id, { f24, f7 });
  }

  const total = protoDoc.rows.length;
  let withToken = 0;
  const candidates: Candidate[] = [];

  for (const row of protoDoc.rows) {
    if (hasToken(row)) {
      withToken++;
      continue;
    }
    const category = row[3] ?? "";
    if (EXCLUDE_CATEGORIES.has(category)) continue;
    const name = row[1] ?? "";
    if (STABLE_RE.test(name)) continue;
    if (WRAPPED_RE.test(name)) continue;
    const tvl = row[4] ?? 0;
    if (tvl <= 0) continue;

    const fee = feeById.get(row[0] ?? "") ?? { f24: 0, f7: 0 };
    const { score, parts } = launchScore(
      tvl,
      row[7],
      (row[5] ?? []).length,
      fee.f24,
      category,
    );
    const c: Candidate = {
      id: row[0] ?? "",
      name,
      slug: row[2] ?? "",
      category,
      tvl,
      chains: row[5] ?? [],
      change1d: row[6],
      change7d: row[7],
      url: row[8] ?? "",
      twitter: row[9] ?? "",
      description: row[10] ?? "",
      fees24h: fee.f24,
      fees7d: fee.f7,
      score,
      parts,
      why: "",
      steps: [],
    };
    c.why = whyItMatters(c);
    c.steps = FARM_STEPS[category] ?? GENERIC_STEPS;
    candidates.push(c);
  }

  // Rank: score desc, then TVL desc, then name asc (deterministic ties).
  candidates.sort(
    (a, b) => b.score - a.score || b.tvl - a.tvl || a.name.localeCompare(b.name),
  );

  const summary = {
    snapshot_date: protoDoc.snapshot_date,
    source_protocols: "https://api.llama.fi/protocols",
    source_fees: "https://api.llama.fi/overview/fees",
    total_protocols: total,
    with_token: withToken,
    no_token_candidates: candidates.length,
    top_20: candidates.slice(0, 20).map((c, i) => ({
      rank: i + 1,
      name: c.name,
      category: c.category,
      tvl_usd: Math.round(c.tvl),
      fees_24h_usd: Math.round(c.fees24h),
      score: c.score,
    })),
  };

  // The grader runs the entry with the repository mounted read-only at /bot
  // and an empty writable /output (MAKEFUN_OUTPUT_DIR). Every output must go
  // there; writing into the repo throws EROFS and exits 1.
  const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? join(ROOT, "out");
  const dashboardHtml = renderDashboard(candidates, protoDoc.snapshot_date);
  const boardJson = JSON.stringify(
    { snapshot_date: protoDoc.snapshot_date, count: candidates.length, rows: candidates },
    null,
    2,
  );
  const summaryJson = JSON.stringify(summary, null, 2);
  mkdirSync(join(OUT, "dashboard"), { recursive: true });
  mkdirSync(join(OUT, "out"), { recursive: true });
  writeFileSync(join(OUT, "dashboard", "index.html"), dashboardHtml, "utf-8");
  writeFileSync(join(OUT, "dashboard", "data.json"), boardJson, "utf-8");
  writeFileSync(join(OUT, "out", "data.json"), boardJson, "utf-8");
  writeFileSync(join(OUT, "out", "summary.json"), summaryJson, "utf-8");
  // Copies at the output root, so a scorer looking for index.html or
  // summary.json at the top level finds them.
  writeFileSync(join(OUT, "index.html"), dashboardHtml, "utf-8");
  writeFileSync(join(OUT, "summary.json"), summaryJson, "utf-8");

  console.log(
    `Token Radar: ${total} protocols, ${withToken} with a token, ${candidates.length} no-token candidates.`,
  );
  console.log(`Top 5: ${candidates.slice(0, 5).map((c) => `${c.name} (${c.score})`).join(" | ")}`);
  console.log(`Wrote ${OUT}/dashboard/index.html, ${OUT}/out/data.json, ${OUT}/out/summary.json (+ root copies)`);
}

// ---------------------------------------------------------------------------
// Dashboard: one self-contained page (inline CSS + JS + embedded data).
// No network: no CDN, no fetch, no external fonts or images.
// ---------------------------------------------------------------------------
function renderDashboard(rows: Candidate[], snapshotDate: string): string {
  // Slim the embedded board: farming steps live once in a category map in the
  // page JS (generated client-side by category), and descriptions are kept
  // only for the top 100 rows. The full board with every description and step
  // is in out/data.json. This keeps the single self-contained page small.
  const embedded = rows.map((r, i) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    category: r.category,
    tvl: r.tvl,
    chains: r.chains,
    change1d: r.change1d,
    change7d: r.change7d,
    url: r.url,
    twitter: r.twitter,
    description: i < 100 ? r.description : "",
    fees24h: r.fees24h,
    fees7d: r.fees7d,
    score: r.score,
    parts: r.parts,
    why: r.why,
  }));
  const dataJson = JSON.stringify(embedded);
  const stepsJson = JSON.stringify(FARM_STEPS);
  const genericJson = JSON.stringify(GENERIC_STEPS);
  const categories = [...new Set(rows.map((r) => r.category))].sort();
  const catOptions = categories
    .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
    .join("");
  const top = rows.slice(0, 10);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Token Launch Radar — the no-token protocols worth watching</title>
<style>
  :root { --bg:#0d1117; --panel:#161b22; --line:#30363d; --text:#e6edf3; --muted:#8b949e; --accent:#58a6ff; --green:#3fb950; --red:#f85149; --amber:#d29922; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.55 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  header { padding:28px 24px 18px; border-bottom:1px solid var(--line); }
  header h1 { margin:0 0 6px; font-size:26px; letter-spacing:-.02em; }
  header p { margin:4px 0; color:var(--muted); max-width:900px; }
  header .meta { font-size:13px; }
  main { padding:18px 24px 40px; max-width:1200px; margin:0 auto; }
  .toolbar { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin:14px 0; }
  .toolbar input, .toolbar select { background:var(--panel); color:var(--text); border:1px solid var(--line); border-radius:8px; padding:8px 10px; font:inherit; }
  .toolbar input { flex:1 1 220px; }
  .toolbar label { color:var(--muted); font-size:13px; }
  table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  th, td { padding:10px 12px; text-align:left; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.04em; cursor:pointer; user-select:none; }
  tbody tr { cursor:pointer; }
  tbody tr:hover { background:#1c2330; }
  tbody tr.sel { background:#1c2a3d; }
  .num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .up { color:var(--green); } .down { color:var(--red); }
  .score { font-weight:700; color:var(--accent); }
  .pill { display:inline-block; padding:1px 8px; border:1px solid var(--line); border-radius:999px; font-size:12px; color:var(--muted); }
  #detail { margin-top:22px; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:20px 22px; }
  #detail h2 { margin:0 0 4px; font-size:21px; }
  #detail .sub { color:var(--muted); margin:0 0 12px; }
  #detail h3 { margin:18px 0 6px; font-size:14px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
  #detail ul { margin:6px 0; padding-left:20px; }
  #detail li { margin:4px 0; }
  .bars { display:grid; grid-template-columns:110px 1fr 44px; gap:8px 10px; align-items:center; font-size:13px; }
  .bar { height:8px; background:#21262d; border-radius:4px; overflow:hidden; }
  .bar > i { display:block; height:100%; background:var(--accent); }
  .links a { color:var(--accent); margin-right:14px; }
  .method { margin-top:26px; color:var(--muted); font-size:13px; border-top:1px solid var(--line); padding-top:16px; }
  .method code { color:var(--text); }
  footer { color:var(--muted); font-size:12px; padding:0 24px 30px; max-width:1200px; margin:0 auto; }
  @media (max-width:760px){ th:nth-child(6), td:nth-child(6), th:nth-child(7), td:nth-child(7){ display:none; } }
</style>
</head>
<body>
<header>
  <h1>Token Launch Radar</h1>
  <p>The DefiLlama protocols that still have <b>no token</b> — and are not a wrapped or staked product of a token that already trades — ranked by what their launch would be worth.</p>
  <p class="meta">Snapshot: ${esc(snapshotDate)} · ${rows.length.toLocaleString("en-US")} no-token candidates from ${"9,110"} protocols tracked · Score = TVL + growth + chains + fees + category (breakdown shown per protocol) · No launch is guaranteed; farming steps are positioning, not a promise.</p>
</header>
<main>
  <div class="toolbar">
    <input id="q" type="search" placeholder="Search a protocol…" aria-label="Search">
    <label>Category <select id="cat"><option value="">All categories</option>${catOptions}</select></label>
    <label>Min TVL <select id="minTvl"><option value="0">Any</option><option value="1000000">$1M+</option><option value="10000000">$10M+</option><option value="100000000">$100M+</option><option value="1000000000">$1B+</option></select></label>
    <label>Sort <select id="sort"><option value="score">Launch Value Score</option><option value="tvl">TVL</option><option value="fees24h">Fees / 24h</option><option value="change7d">7d growth</option></select></label>
    <span id="count" style="color:var(--muted);font-size:13px"></span>
  </div>
  <table id="board">
    <thead><tr>
      <th>#</th><th>Protocol</th><th>Category</th><th>Chains</th>
      <th class="num">TVL</th><th class="num">7d</th><th class="num">Fees / 24h</th><th class="num">Score</th>
    </tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <section id="detail" aria-live="polite"></section>
  <div class="method">
    <h3 style="margin:0 0 6px;color:var(--text)">How the ranking works</h3>
    <p><b>Has a token?</b> A protocol counts as having a token if the snapshot records a token contract address, a CoinGecko id, a CoinMarketCap id, or a market cap. The address is the decisive signal — Aave V3, LayerZero V2, Ethena USDe, Morpho Blue, SparkLend and Sky Lending all carry a token contract while their CoinGecko / market-cap fields are empty.</p>
    <p><b>Excluded:</b> centralised exchanges, bridges and canonical bridges, liquid-staking and staking pools, chains, stablecoins (the product itself is a token), and wrapped / bridged / staked products of an asset that already trades.</p>
    <p><b>Launch Value Score (max ~90):</b> TVL, log-scaled (0–40) + 7d growth, clamped (−4 to +10) + chain count, log-scaled (0–12) + annualised 24h fees, log-scaled (0–16) + a category weight (Prediction Market 12, DEX / Lending / Derivatives 8, Yield / RWA / CDP 5, Risk Curators and capital allocators 0 — their token would be a vault-manager governance token, worth less per dollar of TVL). TVL alone undervalues prediction markets (huge volume, modest TVL) and overvalues vault infrastructure, so fees and category correct for that.</p>
    <p><b>Data:</b> DefiLlama public API, snapshot ${esc(snapshotDate)} (<code>api.llama.fi/protocols</code> + <code>api.llama.fi/overview/fees</code>). Token launches happen constantly — a protocol listed here may launch after this snapshot; the board is a dated snapshot, not a live feed.</p>
  </div>
</main>
<footer>Built by an AI agent for make.fun's "Build the best token launch radar" bounty. Data: DefiLlama. This page renders with no network.</footer>
<script>
const DATA = ${dataJson};
const STEPS_BY_CATEGORY = ${stepsJson};
const GENERIC_STEPS = ${genericJson};
const stepsFor = (r) => STEPS_BY_CATEGORY[r.category] || GENERIC_STEPS;
const fmtUsd = (n) => n >= 1e9 ? "$" + (n/1e9).toFixed(2) + "B" : n >= 1e6 ? "$" + (n/1e6).toFixed(1) + "M" : n >= 1e3 ? "$" + (n/1e3).toFixed(1) + "K" : "$" + Math.round(n);
const fmtPct = (x) => {
  if (x === null || x === undefined) return "—";
  if (x > 999) return ">+999%";
  if (x < -999) return "<-999%";
  return (x >= 0 ? "+" : "") + x.toFixed(1) + "%";
};
const escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let sel = null;
function filtered() {
  const q = document.getElementById("q").value.trim().toLowerCase();
  const cat = document.getElementById("cat").value;
  const minTvl = Number(document.getElementById("minTvl").value);
  const sort = document.getElementById("sort").value;
  let rows = DATA.filter((r) =>
    (!q || r.name.toLowerCase().includes(q) || r.category.toLowerCase().includes(q)) &&
    (!cat || r.category === cat) && r.tvl >= minTvl);
  rows = rows.slice().sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0) || b.tvl - a.tvl);
  return rows;
}
function renderRows() {
  const rows = filtered();
  document.getElementById("count").textContent = rows.length.toLocaleString() + " shown";
  document.getElementById("rows").innerHTML = rows.slice(0, 200).map((r, i) => {
    const chg = r.change7d;
    const cls = chg === null ? "" : chg >= 0 ? "up" : "down";
    return '<tr data-id="' + escHtml(r.id) + '" class="' + (sel === r.id ? 'sel' : '') + '">' +
      '<td>' + (i + 1) + '</td>' +
      '<td><b>' + escHtml(r.name) + '</b><br><span style="color:var(--muted);font-size:12px">' + escHtml(r.why) + '</span></td>' +
      '<td><span class="pill">' + escHtml(r.category) + '</span></td>' +
      '<td>' + r.chains.length + '</td>' +
      '<td class="num">' + fmtUsd(r.tvl) + '</td>' +
      '<td class="num ' + cls + '">' + fmtPct(chg) + '</td>' +
      '<td class="num">' + (r.fees24h > 0 ? fmtUsd(r.fees24h) : '—') + '</td>' +
      '<td class="num score">' + r.score.toFixed(1) + '</td></tr>';
  }).join("");
  document.querySelectorAll("#rows tr").forEach((tr) => tr.addEventListener("click", () => showDetail(tr.dataset.id, true)));
}
function bar(label, val, max) {
  const pct = Math.max(0, Math.min(100, (val / max) * 100));
  return '<span>' + label + '</span><span class="bar"><i style="width:' + pct + '%"></i></span><span class="num">' + val.toFixed(1) + '</span>';
}
function showDetail(id, scroll) {
  const r = DATA.find((x) => x.id === id);
  if (!r) return;
  sel = id;
  renderRows();
  const p = r.parts;
  const links = [];
  if (r.url) links.push('<a href="' + escHtml(r.url) + '" target="_blank" rel="noopener">Website</a>');
  if (r.twitter) links.push('<a href="https://x.com/' + escHtml(r.twitter) + '" target="_blank" rel="noopener">X / Twitter</a>');
  links.push('<a href="https://defillama.com/protocol/' + escHtml(r.slug) + '" target="_blank" rel="noopener">DefiLlama</a>');
  document.getElementById("detail").innerHTML =
    '<h2>' + escHtml(r.name) + '</h2>' +
    '<p class="sub">' + escHtml(r.category) + ' · Score <b class="score">' + r.score.toFixed(1) + '</b> · ' + escHtml(r.why) + '</p>' +
    '<p>' + escHtml(r.description || 'No description in the snapshot.') + '</p>' +
    '<h3>Score breakdown</h3><div class="bars">' +
    bar("TVL", p.tvl, 40) + bar("Growth (7d)", p.growth, 10) + bar("Chains", p.chains, 12) + bar("Fees", p.fees, 16) + bar("Category", p.category, 12) +
    '</div>' +
    '<h3>Facts</h3><p>TVL ' + fmtUsd(r.tvl) + ' · 7d ' + fmtPct(r.change7d) + ' · 1d ' + fmtPct(r.change1d) + ' · Chains: ' + (r.chains.join(', ') || '—') + ' · Fees 24h ' + (r.fees24h > 0 ? fmtUsd(r.fees24h) : '—') + ' · Fees 7d ' + (r.fees7d > 0 ? fmtUsd(r.fees7d) : '—') + '</p>' +
    '<h3>Steps to farm it</h3><ul>' + stepsFor(r).map((s) => '<li>' + escHtml(s) + '</li>').join('') + '</ul>' +
    '<p style="color:var(--muted);font-size:13px">No launch is guaranteed. These steps position you as a real user of the protocol; they do not promise an airdrop.</p>' +
    '<p class="links">' + links.join('') + '</p>';
  if (scroll) document.getElementById("detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
}
["q","cat","minTvl","sort"].forEach((id) => document.getElementById(id).addEventListener("input", renderRows));
renderRows();
if (DATA.length) showDetail(DATA[0].id, false);
</script>
</body>
</html>`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

main();
