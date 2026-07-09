import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Check,
  Copy,
  ExternalLink,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  WalletCards,
  Waves,
} from "lucide-react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./styles.css";

const DEFAULT_MINTS = [
  "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump",
  "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn",
];

const TRUSTED_QUOTES = new Set([
  "So11111111111111111111111111111111111111112",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "Es9vMFrzaCERmJfrF4H2FYD8QorZ5H5jUDx1NWV9tvA",
]);

const PERIODS = [
  { label: "5 minutes", short: "5m", key: "stats5m" },
  { label: "1 hour", short: "1h", key: "stats1h" },
  { label: "6 hours", short: "6h", key: "stats6h" },
  { label: "24 hours", short: "24h", key: "stats24h" },
];

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const COMPACT_USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

const INTEGER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function compactUsd(value) {
  return Number.isFinite(Number(value)) ? COMPACT_USD.format(Number(value)) : "—";
}

function preciseUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  if (number < 0.01) {
    return `$${number.toLocaleString("en-US", { maximumSignificantDigits: 5 })}`;
  }
  return USD.format(number);
}

function percent(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${number > 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function shortAddress(address) {
  return `${address.slice(0, 5)}…${address.slice(-5)}`;
}

function normalizeUrl(url) {
  if (!url) return "";
  return url.replace(/^https:/i, "https:");
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(12000),
    headers: { Accept: "application/json", ...(options.headers || {}) },
  });
  if (!response.ok) throw new Error(`${response.status} from ${new URL(url).hostname}`);
  return response.json();
}

async function fetchJupiterTokens(mints) {
  const query = encodeURIComponent(mints.join(","));
  const endpoints = [
    `https://api.jup.ag/tokens/v2/search?query=${query}`,
    `https://lite-api.jup.ag/tokens/v2/search?query=${query}`,
  ];
  let lastError;
  for (const endpoint of endpoints) {
    try {
      return await fetchJson(endpoint);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function fetchDexPairs(mints) {
  return fetchJson(`https://api.dexscreener.com/tokens/v1/solana/${mints.join(",")}`);
}

function selectPrimaryPair(pairs, mint) {
  const basePairs = pairs.filter((pair) => pair.baseToken?.address === mint);
  const trusted = basePairs.filter((pair) => TRUSTED_QUOTES.has(pair.quoteToken?.address));
  const pool = trusted.length ? trusted : basePairs;
  return [...pool].sort(
    (a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0),
  )[0];
}

function aggregateDexData(pairs, mint) {
  const primary = selectPrimaryPair(pairs, mint);
  if (!primary) return null;

  const eligible = pairs.filter(
    (pair) =>
      pair.baseToken?.address === mint && TRUSTED_QUOTES.has(pair.quoteToken?.address),
  );

  const sum = (path) =>
    eligible.reduce((total, pair) => {
      const value = path.split(".").reduce((item, key) => item?.[key], pair);
      return total + Number(value || 0);
    }, 0);

  return {
    primary,
    poolCount: eligible.length,
    volume24h: sum("volume.h24"),
    buys24h: sum("txns.h24.buys"),
    sells24h: sum("txns.h24.sells"),
    liquidity: sum("liquidity.usd"),
  };
}

async function fetchOhlcv(pairAddress) {
  if (!pairAddress) return [];
  const url =
    `https://api.geckoterminal.com/api/v2/networks/solana/pools/${pairAddress}` +
    "/ohlcv/hour?aggregate=1&limit=24&currency=usd&token=base";
  const payload = await fetchJson(url, {
    headers: { Accept: "application/json;version=20230203" },
  });
  return (payload?.data?.attributes?.ohlcv_list || [])
    .map(([time, open, high, low, close, volume]) => ({
      time: Number(time) * 1000,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: Number(volume),
    }))
    .sort((a, b) => a.time - b.time);
}

function mergeChartData(first = [], second = [], labels) {
  const count = Math.min(first.length, second.length);
  if (!count) return [];
  const a = first.slice(-count);
  const b = second.slice(-count);
  const aStart = a[0]?.close || 1;
  const bStart = b[0]?.close || 1;
  return a.map((point, index) => ({
    time: point.time,
    [labels[0]]: ((point.close / aStart) - 1) * 100,
    [labels[1]]: ((b[index].close / bStart) - 1) * 100,
  }));
}

function ValueChange({ value }) {
  const number = Number(value);
  if (!Number.isFinite(number)) return <span className="muted">—</span>;
  const positive = number >= 0;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={positive ? "positive" : "negative"}>
      <Icon size={14} strokeWidth={2.2} />
      {Math.abs(number).toFixed(2)}%
    </span>
  );
}

function CopyButton({ value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <button className="icon-button" onClick={copy} aria-label="Copy mint address">
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}

function TokenIdentity({ token, color }) {
  return (
    <div className="token-identity">
      <div className="token-avatar" style={{ "--token-color": color }}>
        {token.icon ? (
          <img src={normalizeUrl(token.icon)} alt="" />
        ) : (
          token.symbol?.slice(0, 1)
        )}
      </div>
      <div>
        <div className="token-title-row">
          <h2>{token.symbol}</h2>
          {token.isVerified && (
            <span className="verified" title="Verified by Jupiter">
              <ShieldCheck size={14} /> Verified
            </span>
          )}
        </div>
        <p>{token.name}</p>
      </div>
    </div>
  );
}

function HolderPanel({ token, color }) {
  const holderData = PERIODS.map((period) => ({
    period: period.short,
    change: Number(token[period.key]?.holderChange || 0),
  }));
  const max = Math.max(...holderData.map((item) => Math.abs(item.change)), 0.01);

  return (
    <section className="holder-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Holder activity</span>
          <div className="holder-count">
            <Users size={21} />
            {INTEGER.format(token.holderCount || 0)}
          </div>
        </div>
        <span className="live-pill"><i /> Live</span>
      </div>

      <div className="holder-layout">
        <div className="period-list">
          {PERIODS.map((period) => {
            const change = Number(token[period.key]?.holderChange);
            const approximateCount = Number.isFinite(change)
              ? Math.round((Number(token.holderCount) * change) / (100 + change))
              : null;
            return (
              <div className="period-row" key={period.key}>
                <span>{period.label}</span>
                <strong className={change >= 0 ? "positive-text" : "negative-text"}>
                  {approximateCount === null
                    ? "—"
                    : `${approximateCount > 0 ? "+" : ""}${INTEGER.format(approximateCount)}`}
                  <small>{percent(change)}</small>
                </strong>
              </div>
            );
          })}
        </div>

        <div className="holder-bars" aria-label="Holder change by time period">
          {holderData.map((item) => (
            <div className="holder-bar-column" key={item.period}>
              <div className="bar-track">
                <div
                  className={item.change >= 0 ? "bar-fill" : "bar-fill negative-bar"}
                  style={{
                    height: `${Math.max(10, (Math.abs(item.change) / max) * 100)}%`,
                    background: color,
                  }}
                />
              </div>
              <span>{item.period}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value, subvalue, icon: Icon }) {
  return (
    <div className="metric">
      <div className="metric-label">
        {Icon && <Icon size={15} />}
        {label}
      </div>
      <strong>{value}</strong>
      {subvalue && <span>{subvalue}</span>}
    </div>
  );
}

function TokenCard({ data, index }) {
  const { token, dex } = data;
  const color = index === 0 ? "#c8ff47" : "#8aa8ff";
  const stats = token.stats24h || {};
  const buyVolume = Number(stats.buyVolume || 0);
  const sellVolume = Number(stats.sellVolume || 0);
  const flowTotal = buyVolume + sellVolume || 1;
  const buyShare = (buyVolume / flowTotal) * 100;

  return (
    <article className={`token-card token-card-${index + 1}`}>
      <div className="token-card-header">
        <TokenIdentity token={token} color={color} />
        <div className="address-actions">
          <span>{shortAddress(token.id)}</span>
          <CopyButton value={token.id} />
          <a
            className="icon-button"
            href={`https://solscan.io/token/${token.id}`}
            target="_blank"
            rel="noreferrer"
            aria-label="Open on Solscan"
          >
            <ExternalLink size={15} />
          </a>
        </div>
      </div>

      <div className="price-block">
        <div>
          <span>Live price</span>
          <strong>{preciseUsd(token.usdPrice || dex?.primary?.priceUsd)}</strong>
        </div>
        <div className="price-change">
          <ValueChange value={stats.priceChange} />
          <span>24 hours</span>
        </div>
      </div>

      <HolderPanel token={token} color={color} />

      <div className="metric-grid">
        <Metric
          label="Market cap"
          value={compactUsd(token.mcap || dex?.primary?.marketCap)}
          subvalue={`FDV ${compactUsd(token.fdv || dex?.primary?.fdv)}`}
          icon={WalletCards}
        />
        <Metric
          label="24h volume"
          value={compactUsd(buyVolume + sellVolume || dex?.volume24h)}
          subvalue={`${INTEGER.format(stats.numTraders || 0)} traders`}
          icon={BarChart3}
        />
        <Metric
          label="Liquidity"
          value={compactUsd(token.liquidity || dex?.liquidity)}
          subvalue={`${dex?.poolCount || 0} trusted pools`}
          icon={Waves}
        />
        <Metric
          label="Organic score"
          value={Number(token.organicScore || 0).toFixed(1)}
          subvalue={token.organicScoreLabel || "not rated"}
          icon={ShieldCheck}
        />
      </div>

      <div className="flow-panel">
        <div className="flow-heading">
          <span>24h order flow</span>
          <span>{compactUsd(buyVolume + sellVolume)}</span>
        </div>
        <div className="flow-bar">
          <span style={{ width: `${buyShare}%` }} />
        </div>
        <div className="flow-labels">
          <span className="positive-text">
            Buys {compactUsd(buyVolume)} · {INTEGER.format(stats.numBuys || dex?.buys24h || 0)}
          </span>
          <span className="negative-text">
            Sells {compactUsd(sellVolume)} · {INTEGER.format(stats.numSells || dex?.sells24h || 0)}
          </span>
        </div>
      </div>
    </article>
  );
}

function ComparisonChart({ data, tokens }) {
  const labels = tokens.map((item) => item.token.symbol);
  const colors = ["#c8ff47", "#8aa8ff"];
  return (
    <section className="comparison-chart">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Relative performance</span>
          <h2>24-hour price race</h2>
          <p>Both tokens rebased to 0% at the start of the visible window.</p>
        </div>
        <div className="chart-legend">
          {labels.map((label, index) => (
            <span key={`${label}-${index}`}>
              <i style={{ background: colors[index] }} />
              {label}
            </span>
          ))}
        </div>
      </div>
      <div className="chart-wrap">
        {data.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 12, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="#242925" vertical={false} strokeDasharray="4 6" />
              <XAxis
                dataKey="time"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#777f79", fontSize: 11 }}
                tickFormatter={(value) =>
                  new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                }
                minTickGap={44}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#777f79", fontSize: 11 }}
                tickFormatter={(value) => `${value.toFixed(0)}%`}
              />
              <Tooltip content={<ChartTooltip />} />
              {labels.map((label, index) => (
                <Line
                  key={`${label}-${index}`}
                  type="monotone"
                  dataKey={label}
                  stroke={colors[index]}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4, fill: colors[index], stroke: "#0b0d0c", strokeWidth: 2 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="chart-empty">Historical chart is temporarily rate-limited.</div>
        )}
      </div>
      <div className="source-line">
        Historical OHLCV from GeckoTerminal · Live market and pool validation from DEX Screener
      </div>
    </section>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <span>
        {new Date(label).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
      {payload.map((item) => (
        <strong key={item.dataKey} style={{ color: item.color }}>
          {item.dataKey} {percent(item.value)}
        </strong>
      ))}
    </div>
  );
}

function LeadStrip({ tokens }) {
  const [a, b] = tokens;
  const metrics = [
    { label: "Market cap lead", key: "mcap", format: compactUsd },
    { label: "Holder lead", key: "holderCount", format: (v) => INTEGER.format(v) },
    {
      label: "24h growth lead",
      value: (item) => item.token.stats24h?.holderChange,
      format: percent,
    },
  ];
  return (
    <div className="lead-strip">
      {metrics.map((metric) => {
        const aValue = metric.value ? metric.value(a) : a.token[metric.key];
        const bValue = metric.value ? metric.value(b) : b.token[metric.key];
        const winner = Number(aValue) >= Number(bValue) ? a : b;
        const winningValue = Math.max(Number(aValue || 0), Number(bValue || 0));
        return (
          <div key={metric.label}>
            <span>{metric.label}</span>
            <strong>
              {winner.token.symbol}
              <small>{metric.format(winningValue)}</small>
            </strong>
          </div>
        );
      })}
    </div>
  );
}

function AddressEditor({ mints, onLoad, loading }) {
  const [drafts, setDrafts] = useState(mints);
  useEffect(() => setDrafts(mints), [mints]);
  const valid = drafts.every((value) => value.trim().length >= 32) && drafts[0] !== drafts[1];

  const submit = (event) => {
    event.preventDefault();
    if (valid) onLoad(drafts.map((value) => value.trim()));
  };

  return (
    <form className="address-editor" onSubmit={submit}>
      <div className="editor-copy">
        <Search size={18} />
        <div>
          <strong>Compare any two Solana tokens</strong>
          <span>Paste mint addresses, then load live data.</span>
        </div>
      </div>
      <div className="address-fields">
        {drafts.map((value, index) => (
          <label key={index}>
            <span>Token {index + 1}</span>
            <input
              value={value}
              onChange={(event) => {
                const next = [...drafts];
                next[index] = event.target.value;
                setDrafts(next);
              }}
              spellCheck="false"
              aria-label={`Token ${index + 1} mint address`}
            />
          </label>
        ))}
      </div>
      <button className="load-button" type="submit" disabled={!valid || loading}>
        {loading ? <RefreshCw className="spin" size={17} /> : <Search size={17} />}
        Compare
      </button>
    </form>
  );
}

function Skeleton() {
  return (
    <div className="skeleton-grid">
      {[0, 1].map((item) => (
        <div className="skeleton-card" key={item}>
          <div className="skeleton-line wide" />
          <div className="skeleton-line price" />
          <div className="skeleton-panel" />
          <div className="skeleton-metrics">
            <i /><i /><i /><i />
          </div>
        </div>
      ))}
    </div>
  );
}

function App() {
  const [mints, setMints] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("solana-compare-mints")) || DEFAULT_MINTS;
    } catch {
      return DEFAULT_MINTS;
    }
  });
  const [tokens, setTokens] = useState([]);
  const [ohlcv, setOhlcv] = useState([[], []]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);

  const loadData = useCallback(async (nextMints = mints, quiet = false) => {
    quiet ? setRefreshing(true) : setLoading(true);
    setError("");
    try {
      const [jupiterTokens, dexPairs] = await Promise.all([
        fetchJupiterTokens(nextMints),
        fetchDexPairs(nextMints),
      ]);

      const ordered = nextMints.map((mint) => {
        const token = jupiterTokens.find((item) => item.id === mint);
        if (!token) throw new Error(`No Jupiter token data found for ${shortAddress(mint)}`);
        return { token, dex: aggregateDexData(dexPairs, mint) };
      });
      setTokens(ordered);
      setMints(nextMints);
      localStorage.setItem("solana-compare-mints", JSON.stringify(nextMints));
      setUpdatedAt(new Date());

      const histories = [];
      for (const item of ordered) {
        try {
          histories.push(await fetchOhlcv(item.dex?.primary?.pairAddress));
        } catch {
          histories.push([]);
        }
      }
      setOhlcv(histories);
    } catch (loadError) {
      setError(loadError.message || "Could not load token data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [mints]);

  useEffect(() => {
    loadData(mints);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => loadData(mints, true), 60_000);
    return () => clearInterval(interval);
  }, [loadData, mints]);

  const chartData = useMemo(() => {
    if (tokens.length !== 2) return [];
    return mergeChartData(ohlcv[0], ohlcv[1], tokens.map((item) => item.token.symbol));
  }, [ohlcv, tokens]);

  return (
    <main>
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark"><BarChart3 size={19} /></div>
          <div>
            <strong>Solana Compare</strong>
            <span>Token intelligence, side by side</span>
          </div>
        </div>
        <div className="header-status">
          {updatedAt && (
            <span className="updated">
              Updated {updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          <span className="network-pill"><i /> Solana mainnet</span>
          <button
            className="refresh-button"
            onClick={() => loadData(mints, true)}
            disabled={refreshing}
          >
            <RefreshCw className={refreshing ? "spin" : ""} size={16} />
            Refresh
          </button>
        </div>
      </header>

      <div className="page-shell">
        <section className="hero">
          <div>
            <span className="eyebrow">Live token monitor</span>
            <h1>See which Solana token is actually gaining ground.</h1>
            <p>
              Compare holders, market depth, volume, order flow, and price performance
              without jumping between explorers.
            </p>
          </div>
          <div className="hero-note">
            <span>Auto refresh</span>
            <strong>Every 60 seconds</strong>
          </div>
        </section>

        <AddressEditor mints={mints} onLoad={(next) => loadData(next)} loading={loading} />

        {error && (
          <div className="error-banner">
            <strong>Data request failed</strong>
            <span>{error}</span>
            <button onClick={() => loadData(mints)}>Try again</button>
          </div>
        )}

        {loading ? (
          <Skeleton />
        ) : tokens.length === 2 ? (
          <>
            <LeadStrip tokens={tokens} />
            <div className="token-grid">
              {tokens.map((data, index) => (
                <TokenCard data={data} index={index} key={data.token.id} />
              ))}
            </div>
            <ComparisonChart data={chartData} tokens={tokens} />
          </>
        ) : null}

        <footer>
          <span>
            Data: Jupiter Tokens, DEX Screener, and GeckoTerminal. Approximate holder
            deltas are derived from Jupiter’s reported percentage change.
          </span>
          <span>Market data can differ across venues. Not financial advice.</span>
        </footer>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
