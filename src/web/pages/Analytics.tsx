import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, CheckCircle2, Clock, Gauge, HardDrive, Loader2, Rocket, Trophy, Zap } from 'lucide-react';
import type { AnalyticsData } from '../../shared/types';
import { useApp } from '../store';
import { api } from '../lib/api';
import { currentTheme } from '../lib/theme';
import { formatBytes, formatDate, formatDuration, formatNumber, formatSpeed, pct, timeAgo } from '../lib/format';
import { Empty, Segmented } from '../components/ui';

const DAY = 86_400_000;
const RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
] as const;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SIZE_BINS = [
  { label: '< 100 MB', max: 100 * 2 ** 20 },
  { label: '100 MB – 1 GB', max: 2 ** 30 },
  { label: '1 – 5 GB', max: 5 * 2 ** 30 },
  { label: '5 – 20 GB', max: 20 * 2 ** 30 },
  { label: '20 GB +', max: Infinity },
];

function dayKey(ts: number) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function Tip({ title, value, color }: { title: string; value: string; color?: string }) {
  return (
    <div className="chart-tip">
      <div className="t">{title}</div>
      <div className="v">
        {color && <i style={{ '--c': color } as React.CSSProperties} />}
        {value}
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, unit, sub, tone = 'accent' }: { icon: React.ReactNode; label: string; value: string; unit?: string; sub?: string; tone?: string }) {
  return (
    <div className={`card stat tone-${tone}`}>
      <div className="stat-top">
        <span className="stat-icon">{icon}</span>
        {label}
      </div>
      <div className="stat-value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

const splitBytes = (n: number) => {
  const s = formatBytes(n);
  const i = s.indexOf(' ');
  return [s.slice(0, i), s.slice(i + 1)] as const;
};

export function Analytics() {
  const theme = useApp((s) => `${s.settings?.theme}${s.settings?.accent}`);
  const [range, setRange] = useState<(typeof RANGES)[number]['value']>('30');
  const [data, setData] = useState<AnalyticsData | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => api.analytics(Number(range)).then((d) => alive && setData(d)).catch(() => undefined);
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [range]);

  const c = useMemo(() => currentTheme().colors, [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const derived = useMemo(() => {
    if (!data) return null;
    const days = Number(range);
    const start = dayKey(Date.now() - (days - 1) * DAY);
    const byDay = new Map<number, number>();
    for (let d = start; d <= Date.now(); d = dayKey(d + DAY * 1.5)) byDay.set(d, 0);
    const heat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    let rangeBytes = 0;
    for (const [ts, bytes] of data.hourly) {
      const k = dayKey(ts);
      if (byDay.has(k)) byDay.set(k, (byDay.get(k) ?? 0) + bytes);
      const d = new Date(ts);
      heat[(d.getDay() + 6) % 7][d.getHours()] += bytes;
      rangeBytes += bytes;
    }
    const daily = [...byDay.entries()].map(([ts, bytes]) => ({
      ts,
      bytes,
      label: new Date(ts).toLocaleDateString(undefined, days > 90 ? { month: 'short' } : { month: 'short', day: 'numeric' }),
    }));
    const heatMax = Math.max(1, ...heat.flat());

    // Speed over the last 24h, averaged into 10-minute buckets.
    const buckets = new Map<number, { sum: number; n: number }>();
    for (const [ts, bps] of data.minutes) {
      const k = Math.floor(ts / 600_000) * 600_000;
      const b = buckets.get(k) ?? { sum: 0, n: 0 };
      b.sum += bps;
      b.n++;
      buckets.set(k, b);
    }
    const now = Math.floor(Date.now() / 600_000) * 600_000;
    const speed = [];
    for (let t = now - 24 * 3_600_000; t <= now; t += 600_000) {
      const b = buckets.get(t);
      speed.push({ ts: t, bps: b ? b.sum / b.n : 0 });
    }

    const h = data.history;
    const totalMs = h.reduce((a, r) => a + r.downloadMs, 0);
    const totalBytes = h.reduce((a, r) => a + r.size, 0);
    const avgSpeed = totalMs ? totalBytes / (totalMs / 1000) : 0;
    const withReady = h.filter((r) => r.readyAt);
    const avgReady = withReady.length ? withReady.reduce((a, r) => a + (r.readyAt! - r.addedAt), 0) / withReady.length : 0;
    const avgTotal = h.length ? h.reduce((a, r) => a + (r.completedAt - r.addedAt), 0) / h.length : 0;
    const cachedKnown = h.filter((r) => r.cached !== null);
    const cacheRate = cachedKnown.length ? cachedKnown.filter((r) => r.cached).length / cachedKnown.length : null;
    const successRate = data.totals.completed + data.totals.failed ? data.totals.completed / (data.totals.completed + data.totals.failed) : null;

    const tagMap = new Map<string, { name: string; color: string; bytes: number; count: number }>();
    for (const r of h) {
      const name = r.tag ?? 'Untagged';
      const e = tagMap.get(name) ?? { name, color: r.tagColor ?? (r.tag ? c.accent2 : c.muted), bytes: 0, count: 0 };
      e.bytes += r.size;
      e.count++;
      tagMap.set(name, e);
    }
    let tags = [...tagMap.values()].sort((a, b) => b.bytes - a.bytes);
    if (tags.length > 6) {
      const rest = tags.slice(5);
      tags = [...tags.slice(0, 5), { name: 'Other', color: c.muted, bytes: rest.reduce((a, t) => a + t.bytes, 0), count: rest.reduce((a, t) => a + t.count, 0) }];
    }
    const sizes = SIZE_BINS.map((b, i) => ({
      label: b.label,
      count: h.filter((r) => r.size < b.max && (i === 0 || r.size >= SIZE_BINS[i - 1].max)).length,
    }));
    const origins = { ui: 0, qbit: 0, cloud: 0 } as Record<string, number>;
    for (const r of h) origins[r.origin] = (origins[r.origin] ?? 0) + 1;
    const largest = [...h].sort((a, b) => b.size - a.size).slice(0, 5);
    const busiest = daily.reduce((m, d) => (d.bytes > m.bytes ? d : m), daily[0] ?? { bytes: 0, ts: 0, label: '' });
    return { daily, heat, heatMax, speed, avgSpeed, avgReady, avgTotal, cacheRate, successRate, tags, sizes, origins, largest, rangeBytes, busiest };
  }, [data, range, c]);

  if (!data || !derived) {
    return (
      <div className="page">
        <div className="card">
          <Empty icon={<Loader2 className="spin" />} title="Crunching the numbers…" />
        </div>
      </div>
    );
  }

  const [tb, tu] = splitBytes(data.totals.bytes);
  const [rb, ru] = splitBytes(derived.rangeBytes);
  const axis = { stroke: c.muted, fontSize: 11, tickLine: false, axisLine: false } as const;
  const tagTotal = derived.tags.reduce((a, t) => a + t.bytes, 0);
  const rangeLabel = RANGES.find((r) => r.value === range)!.label;

  return (
    <div className="page">
      <div className="toolbar">
        <Segmented value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.value, label: r.label }))} />
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 12.5 }}>
          Tracking since {new Date(data.totals.firstUseAt).toLocaleDateString()}
        </span>
      </div>

      <div className="stats-row">
        <Kpi icon={<HardDrive />} label="Downloaded all-time" value={tb} unit={tu} sub={`${rb} ${ru} in the last ${rangeLabel}`} />
        <Kpi
          icon={<CheckCircle2 />}
          tone="success"
          label="Completed"
          value={formatNumber(data.totals.completed)}
          sub={derived.successRate === null ? 'No downloads yet' : `${pct(derived.successRate)} success rate · ${data.totals.failed} failed`}
        />
        <Kpi
          icon={<Gauge />}
          tone="accent2"
          label="Average speed"
          value={formatSpeed(derived.avgSpeed).split(' ')[0]}
          unit={formatSpeed(derived.avgSpeed).split(' ')[1]}
          sub={`Peak ${formatSpeed(data.totals.peakSpeed)}${data.totals.peakSpeedAt ? ` · ${timeAgo(data.totals.peakSpeedAt)}` : ''}`}
        />
        <Kpi
          icon={<Zap />}
          tone="info"
          label="Instant from cache"
          value={derived.cacheRate === null ? '—' : pct(derived.cacheRate)}
          sub={`Avg ${formatDuration(derived.avgReady)} to ready · ${formatDuration(derived.avgTotal)} end-to-end`}
        />
      </div>

      <div className="grid-3">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Daily volume</h3>
              <p>
                Data downloaded per day
                {derived.busiest.bytes > 0 && ` · busiest: ${derived.busiest.label} (${formatBytes(derived.busiest.bytes)})`}
              </p>
            </div>
          </div>
          <div className="chart-box">
            <ResponsiveContainer>
              <BarChart data={derived.daily} margin={{ top: 10, right: 8, left: 8, bottom: 0 }} barCategoryGap={derived.daily.length > 60 ? 1 : 3}>
                <CartesianGrid vertical={false} stroke={c.border} />
                <XAxis dataKey="label" {...axis} minTickGap={24} />
                <YAxis {...axis} width={62} tickFormatter={(v) => formatBytes(v, 0)} />
                <Tooltip
                  cursor={{ fill: c.text, fillOpacity: 0.05 }}
                  content={({ active, payload }) =>
                    active && payload?.[0] ? (
                      <Tip title={new Date(payload[0].payload.ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} value={formatBytes(payload[0].payload.bytes)} color={c.accent} />
                    ) : null
                  }
                />
                <Bar dataKey="bytes" fill={c.accent} radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3>By tag</h3>
              <p>Share of data in the last {rangeLabel}</p>
            </div>
          </div>
          {derived.tags.length ? (
            <div className="card-pad" style={{ paddingTop: 8 }}>
              <div style={{ height: 180 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={derived.tags} dataKey="bytes" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={derived.tags.length > 1 ? 2 : 0} stroke={c.surface} strokeWidth={2} cornerRadius={4}>
                      {derived.tags.map((t) => (
                        <Cell key={t.name} fill={t.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) =>
                        active && payload?.[0] ? (
                          <Tip title={`${payload[0].payload.name} · ${payload[0].payload.count} downloads`} value={formatBytes(payload[0].payload.bytes)} color={payload[0].payload.color} />
                        ) : null
                      }
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="legend mt">
                {derived.tags.map((t) => (
                  <div key={t.name} className="legend-row">
                    <i style={{ '--c': t.color } as React.CSSProperties} />
                    <span className="truncate">{t.name}</span>
                    <span>{formatBytes(t.bytes)}</span>
                    <span>{tagTotal ? pct(t.bytes / tagTotal) : '—'}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <Empty icon={<Activity />} title="No data yet">
              Completed downloads will be broken down by tag here.
            </Empty>
          )}
        </div>
      </div>

      <div className="grid-2 mt">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Speed · last 24 hours</h3>
              <p>10-minute averages · peak {formatSpeed(Math.max(0, ...derived.speed.map((s) => s.bps)))}</p>
            </div>
          </div>
          <div className="chart-box">
            <ResponsiveContainer>
              <AreaChart data={derived.speed} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="speed-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c.accent2} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={c.accent2} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={c.border} />
                <XAxis dataKey="ts" {...axis} minTickGap={40} tickFormatter={(v) => new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} />
                <YAxis {...axis} width={70} tickFormatter={(v) => formatSpeed(v)} />
                <Tooltip
                  cursor={{ stroke: c.muted, strokeWidth: 1 }}
                  content={({ active, payload }) =>
                    active && payload?.[0] ? (
                      <Tip title={new Date(payload[0].payload.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} value={formatSpeed(payload[0].payload.bps)} color={c.accent2} />
                    ) : null
                  }
                />
                <Area type="monotone" dataKey="bps" stroke={c.accent2} strokeWidth={2} fill="url(#speed-fill)" activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3>Activity heatmap</h3>
              <p>When you download the most (your local time)</p>
            </div>
            <span className="spacer" />
            <div className="heat-scale">
              Less
              {[0.12, 0.3, 0.5, 0.75, 1].map((a) => (
                <i key={a} style={{ '--a': a } as React.CSSProperties} />
              ))}
              More
            </div>
          </div>
          <div className="card-pad">
            <div className="heatmap">
              <span />
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} style={{ textAlign: 'center' }}>
                  {h % 6 === 0 ? h : ''}
                </span>
              ))}
              {derived.heat.map((row, d) => (
                <FragmentRow key={d} day={WEEKDAYS[d]} row={row} max={derived.heatMax} />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2 mt">
        <div className="card">
          <div className="card-head">
            <div>
              <h3>Download sizes</h3>
              <p>How big your downloads are</p>
            </div>
          </div>
          <div className="chart-box" style={{ height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={derived.sizes} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke={c.border} />
                <XAxis dataKey="label" {...axis} />
                <YAxis {...axis} width={40} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: c.text, fillOpacity: 0.05 }}
                  content={({ active, payload }) =>
                    active && payload?.[0] ? <Tip title={payload[0].payload.label} value={`${payload[0].payload.count} downloads`} color={c.accent} /> : null
                  }
                />
                <Bar dataKey="count" fill={c.accent} radius={[4, 4, 0, 0]} maxBarSize={56} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h3>Storage</h3>
              <p>Free space in your download folders</p>
            </div>
          </div>
          <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {data.folders.map((f) => {
              const used = f.total && f.free !== null ? 1 - f.free / f.total : 0;
              return (
                <div key={f.id}>
                  <div className="row" style={{ justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                    <span>
                      <b>{f.name}</b> <span className="muted mono" style={{ fontSize: 11.5 }}>{f.path}</span>
                    </span>
                    <span className="muted">{f.free !== null ? `${formatBytes(f.free)} free of ${formatBytes(f.total)}` : 'unavailable'}</span>
                  </div>
                  <div className={`disk-bar ${used > 0.95 ? 'crit' : used > 0.85 ? 'warn' : ''}`}>
                    <span style={{ width: `${used * 100}%` }} />
                  </div>
                </div>
              );
            })}
            <div className="row" style={{ gap: 18, marginTop: 6, fontSize: 12.5 }}>
              <span className="muted">Sources ({rangeLabel}):</span>
              <span>
                <b>{derived.origins.ui}</b> <span className="muted">manual</span>
              </span>
              <span>
                <b>{derived.origins.qbit}</b> <span className="muted">Sonarr/Radarr</span>
              </span>
              <span>
                <b>{derived.origins.cloud}</b> <span className="muted">from cloud</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid-3 mt">
        <div className="card" style={{ overflow: 'hidden' }}>
          <div className="card-head">
            <div>
              <h3>Recent completions</h3>
              <p>Latest finished downloads</p>
            </div>
          </div>
          {data.history.length ? (
            <table className="table mt">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="num">Size</th>
                  <th className="num">Avg speed</th>
                  <th className="num">Finished</th>
                </tr>
              </thead>
              <tbody>
                {data.history.slice(0, 10).map((r) => (
                  <tr key={r.id + r.completedAt}>
                    <td className="name-cell">
                      <div title={r.name}>{r.name}</div>
                      <small>
                        {r.tag ?? 'Untagged'}
                        {r.cached ? ' · ⚡ instant' : ''} · {formatDuration(r.completedAt - r.addedAt)} total
                      </small>
                    </td>
                    <td className="num">{formatBytes(r.size)}</td>
                    <td className="num">{formatSpeed(r.avgSpeed)}</td>
                    <td className="num muted" title={formatDate(r.completedAt)}>
                      {timeAgo(r.completedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty icon={<Clock />} title="Nothing finished yet" />
          )}
        </div>
        <div className="card">
          <div className="card-head">
            <div>
              <h3>
                <Trophy size={15} style={{ verticalAlign: -2, color: 'var(--warning)' }} /> Biggest downloads
              </h3>
              <p>Top 5 in the last {rangeLabel}</p>
            </div>
          </div>
          <div className="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {derived.largest.length ? (
              derived.largest.map((r, i) => (
                <div key={r.id + r.completedAt} className="row" style={{ gap: 12 }}>
                  <span className="badge tone-accent" style={{ width: 26, justifyContent: 'center', padding: 0 }}>
                    {i + 1}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="truncate" style={{ fontWeight: 600, fontSize: 13 }} title={r.name}>
                      {r.name}
                    </div>
                    <div className="muted" style={{ fontSize: 11.5 }}>
                      {formatSpeed(r.avgSpeed)} avg
                    </div>
                  </div>
                  <b style={{ fontSize: 13 }}>{formatBytes(r.size)}</b>
                </div>
              ))
            ) : (
              <Empty icon={<Rocket />} title="No downloads yet" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FragmentRow({ day, row, max }: { day: string; row: number[]; max: number }) {
  return (
    <>
      <span className="lbl">{day}</span>
      {row.map((v, h) => (
        <span
          key={h}
          className={`cell ${v ? '' : 'zero'}`}
          style={{ '--a': v ? 0.12 + 0.88 * Math.sqrt(v / max) : 0 } as React.CSSProperties}
          data-tip={`${day} ${String(h).padStart(2, '0')}:00 · ${formatBytes(v)}`}
        />
      ))}
    </>
  );
}
