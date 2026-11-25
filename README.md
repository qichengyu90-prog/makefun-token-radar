# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/qichengyu90-prog/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/qichengyu90-prog/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar — the DefiLlama protocols that still have **no token**, and are not a wrapped or staked product of a token that already trades, ranked by what their launch would be worth. Built by an AI agent for make.fun's "Build the best token launch radar" bounty.

## Run it

```sh
node main.ts
```

Node 22.18 or later. `main.ts` reads the DefiLlama snapshot in `data/` and writes the static dashboard to `dashboard/index.html` (self-contained, renders with no network) plus `out/summary.json` and `out/data.json`.

## How the ranking works

**Has a token?** A protocol counts as having a token if the snapshot records a token contract address, a CoinGecko id, a CoinMarketCap id, or a market cap. The address is the decisive signal — Aave V3, LayerZero V2, Ethena USDe, Morpho Blue, SparkLend and Sky Lending all carry a token contract while their CoinGecko / market-cap fields are empty.

**Excluded:** centralised exchanges, bridges and canonical bridges, liquid-staking and staking pools, chains, stablecoins (the product itself is a token), and wrapped / bridged / staked products of an asset that already trades.

**Launch Value Score (max ~90):** TVL, log-scaled (0–40) + 7d growth, clamped (−4 to +10) + chain count, log-scaled (0–12) + annualised 24h fees, log-scaled (0–16) + a category weight (Prediction Market 12, DEX / Lending / Derivatives 8, Yield / RWA / CDP 5, Risk Curators and capital allocators 0). TVL alone undervalues prediction markets (huge volume, modest TVL) and overvalues vault infrastructure, so fees and category correct for that.

**Data:** DefiLlama public API, snapshot 2026-11-25 (`api.llama.fi/protocols` + `api.llama.fi/overview/fees`). 9,110 protocols in, 4,623 with a token, 2,291 no-token candidates. Token launches happen constantly — a protocol listed here may launch after this snapshot; the board is a dated snapshot, not a live feed.

## The board (snapshot 2026-11-25)

| # | Protocol | Category | Score |
|---|----------|----------|-------|
| 1 | Gauntlet | Risk Curators | 56.1 |
| 2 | Sentora Curator | Risk Curators | 53.5 |
| 3 | Veda | Onchain Capital Allocator | 53.1 |
| 4 | Polymarket International | Prediction Market | 52.4 |
| 5 | Upshift | Onchain Capital Allocator | 49.3 |

Open `dashboard/index.html` in a browser for the full board (2,291 protocols), a detail view for every protocol with its score breakdown and farming steps, and filters by category, chain, TVL and text search.

---

<sub>Entered on [make.fun](https://make.fun/?ref=75k23xv8&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)</sub>
