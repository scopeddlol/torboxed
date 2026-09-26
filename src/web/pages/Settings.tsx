import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Bell,
  Check as CheckIcon,
  CheckCircle2,
  Cloud,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileDown,
  FileUp,
  FolderOpen,
  Gauge,
  Info,
  KeyRound,
  Loader2,
  Monitor,
  Palette,
  Plug,
  RefreshCw,
  ScrollText,
  Sparkles,
  Trash2,
  Wand2,
  XCircle,
} from 'lucide-react';
import type { AccountInfo, LogEntry, Settings as SettingsT } from '../../shared/types';
import { THEMES } from '../../shared/themes';
import { attempt, useApp } from '../store';
import { api } from '../lib/api';
import { copyText, desktop, isDesktop } from '../lib/desktop';
import { formatDate, formatSpeed } from '../lib/format';
import { Logo, Segmented, Switch } from '../components/ui';

type Section = 'torbox' | 'downloads' | 'speed' | 'automation' | 'integrations' | 'appearance' | 'desktop' | 'data' | 'logs' | 'about';

const SECTIONS: { id: Section; label: string; icon: typeof Cloud; desktopOnly?: boolean }[] = [
  { id: 'torbox', label: 'TorBox account', icon: Cloud },
  { id: 'downloads', label: 'Downloads', icon: Download },
  { id: 'speed', label: 'Speed', icon: Gauge },
  { id: 'automation', label: 'Automation', icon: Wand2 },
  { id: 'integrations', label: 'Sonarr & Radarr', icon: Plug },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'desktop', label: 'Desktop app', icon: Monitor, desktopOnly: true },
  { id: 'data', label: 'Backup & data', icon: Database },
  { id: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'about', label: 'About', icon: Info },
];

function Row({ title, desc, children, stack }: { title: ReactNode; desc?: ReactNode; children?: ReactNode; stack?: boolean }) {
  return (
    <div className={`setting ${stack ? 'stack' : ''}`}>
      <div>
        <div className="setting-title">{title}</div>
        {desc && <div className="setting-desc">{desc}</div>}
      </div>
      {children && <div className="setting-control">{children}</div>}
    </div>
  );
}

function Intro({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div className="section-intro">
      <span className="icon">{icon}</span>
      <div>
        <h2>{title}</h2>
        <p>{desc}</p>
      </div>
    </div>
  );
}

function NumField({ value, onSave, min, max, unit, width = 140 }: { value: number; onSave: (n: number) => void; min?: number; max?: number; unit?: string; width?: number }) {
  const [v, setV] = useState(String(value));
  useEffect(() => setV(String(value)), [value]);
  const commit = () => {
    let n = Number(v);
    if (!Number.isFinite(n)) return setV(String(value));
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    setV(String(n));
    if (n !== value) onSave(n);
  };
  return (
    <div className="input-suffix" style={{ width }}>
      <input className="input" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} style={{ width }} />
      {unit && <span>{unit}</span>}
    </div>
  );
}

function TextField({ value, onSave, placeholder, width = 260, mono }: { value: string; onSave: (s: string) => void; placeholder?: string; width?: number; mono?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      className={`input ${mono ? 'mono' : ''}`}
      style={{ width }}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/* ─────────── Sections ─────────── */

function TorBoxSection({ s, save }: { s: SettingsT; save: (p: Partial<SettingsT>) => void }) {
  const toast = useApp((st) => st.toast);
  const torbox = useApp((st) => st.tick?.torbox);
  const [key, setKey] = useState(s.torboxApiKey);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!s.torboxApiKey) return;
    api
      .account(true)
      .then((a) => (setAccount(a), setError(null)))
      .catch((e) => setError(e.message));
  }, [s.torboxApiKey]);

  const test = async () => {
    setBusy(true);
    try {
      const a = await api.testKey(key.trim());
      setAccount(a);
      setError(null);
      if (key.trim() !== s.torboxApiKey) save({ torboxApiKey: key.trim(), onboarded: true });
      toast('success', 'Connected to TorBox', `${a.email ?? 'Account'} · ${a.planName} plan`);
    } catch (e) {
      setError((e as Error).message);
      toast('error', 'Could not connect', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <Intro icon={<Cloud />} title="TorBox account" desc="Torboxed uses your API key to add torrents and fetch download links." />
      <Row
        stack
        title="API key"
        desc={
          <>
            Find it at{' '}
            <a href="https://torbox.app/settings" target="_blank" rel="noreferrer">
              torbox.app/settings
            </a>{' '}
            → API Key. It is stored only on this machine.
          </>
        }
      >
        <div className="input-group" style={{ width: '100%' }}>
          <div className="input-with-icon">
            <KeyRound />
            <input
              className="input mono"
              type={show ? 'text' : 'password'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              onKeyDown={(e) => e.key === 'Enter' && test()}
            />
          </div>
          <button className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? 'Hide key' : 'Show key'}>
            {show ? <EyeOff /> : <Eye />}
          </button>
          <button className="btn btn-primary" onClick={test} disabled={busy || !key.trim()}>
            {busy ? <Loader2 className="spin" /> : <CheckCircle2 />}
            {key.trim() === s.torboxApiKey ? 'Test' : 'Save & test'}
          </button>
          {s.torboxApiKey && (
            <button className="btn btn-ghost" onClick={() => (setKey(''), setAccount(null), save({ torboxApiKey: '' }))}>
              Disconnect
            </button>
          )}
        </div>
      </Row>
      {(account || error || torbox?.error) && (
        <Row stack title="Status">
          {account && !error ? (
            <div className="connect-card" style={{ width: '100%' }}>
              <div>
                <label>Account</label>
                <span>{account.email ?? '—'}</span>
              </div>
              <div>
                <label>Plan</label>
                <span>{account.planName}</span>
              </div>
              <div>
                <label>Premium until</label>
                <span>{account.premiumExpiresAt ? new Date(account.premiumExpiresAt).toLocaleDateString() : '—'}</span>
              </div>
              <div>
                <label>Status</label>
                <span style={{ color: 'var(--success)' }}>
                  <CheckIcon size={14} /> Connected
                </span>
              </div>
            </div>
          ) : (
            <div className="callout tone-danger" style={{ width: '100%' }}>
              <XCircle />
              {error ?? torbox?.error}
            </div>
          )}
        </Row>
      )}
      <Row title="Seeding on TorBox" desc="Whether TorBox should keep seeding torrents after they finish in the cloud.">
        <Segmented
          value={String(s.seedMode) as '1' | '2' | '3'}
          onChange={(v) => save({ seedMode: Number(v) as 1 | 2 | 3 })}
          options={[
            { value: '1', label: 'Account default' },
            { value: '2', label: 'Seed' },
            { value: '3', label: "Don't seed" },
          ]}
        />
      </Row>
      <Row title="Check interval" desc="How often Torboxed asks TorBox for progress while torrents are in the cloud.">
        <NumField value={s.pollIntervalSec} min={2} max={300} unit="sec" onSave={(n) => save({ pollIntervalSec: n })} />
      </Row>
    </div>
  );
}

function DownloadsSection({ s, save }: { s: SettingsT; save: (p: Partial<SettingsT>) => void }) {
  const folders = useApp((st) => st.folders);
  const go = useApp((st) => st.go);
  return (
    <div className="card">
      <Intro icon={<Download />} title="Downloads" desc="How files come down from TorBox to your disk." />
      <Row title="Default folder" desc={<>Used when a download has no tag. Manage folders in <a onClick={() => go('organize')} style={{ cursor: 'pointer' }}>Tags & Folders</a>.</>}>
        <select className="select" style={{ width: 240 }} value={s.defaultFolderId} onChange={(e) => save({ defaultFolderId: e.target.value })}>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} — {f.path}
            </option>
          ))}
        </select>
      </Row>
      <Row title="Simultaneous downloads" desc="How many torrents download at the same time.">
        <NumField value={s.maxConcurrentDownloads} min={1} max={20} unit="at once" onSave={(n) => save({ maxConcurrentDownloads: n })} />
      </Row>
      <Row title="Retry attempts" desc="Failed downloads are retried automatically with increasing back-off.">
        <NumField value={s.retryAttempts} min={0} max={50} unit="times" onSave={(n) => save({ retryAttempts: n })} />
      </Row>
      <Row title="Create a sub-folder" desc="Auto: multi-file torrents get their own folder, single files don't (like qBittorrent's “Original”).">
        <Segmented
          value={s.subfolderMode}
          onChange={(v) => save({ subfolderMode: v })}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'always', label: 'Always' },
            { value: 'never', label: 'Never' },
          ]}
        />
      </Row>
      <Row title="Skip file types" desc="Comma-separated extensions that won't be downloaded, e.g. nfo, txt, exe, url.">
        <TextField value={s.skipExtensions} onSave={(v) => save({ skipExtensions: v })} placeholder="nfo, txt, exe" mono />
      </Row>
    </div>
  );
}

const PRESETS = [512, 1024, 2048, 5120, 10240, 25600];

function SpeedSection({ s, save }: { s: SettingsT; save: (p: Partial<SettingsT>) => void }) {
  const control = useApp((st) => st.control);
  return (
    <div className="card">
      <Intro icon={<Gauge />} title="Speed" desc="Cap bandwidth globally, or flip into slow mode with one click." />
      <Row title="Speed limit" desc="Maximum combined download speed. 0 = unlimited.">
        <NumField value={s.speedLimitKBps} min={0} unit="KB/s" width={160} onSave={(n) => save({ speedLimitKBps: n })} />
      </Row>
      <Row
        stack
        title="Slow mode limit"
        desc="The speed used while slow mode is on — handy for gaming, video calls or busy evenings. Toggle it from the top bar, the tray icon or right-click anywhere."
      >
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <NumField value={s.slowModeLimitKBps} min={1} unit="KB/s" width={160} onSave={(n) => save({ slowModeLimitKBps: n })} />
          {PRESETS.map((p) => (
            <button key={p} className={`btn btn-sm ${s.slowModeLimitKBps === p ? 'btn-toggle on info' : ''}`} onClick={() => save({ slowModeLimitKBps: p })}>
              {formatSpeed(p * 1024)}
            </button>
          ))}
        </div>
      </Row>
      <Row title="Slow mode" desc={s.slowMode ? `On — limited to ${formatSpeed(s.slowModeLimitKBps * 1024)}` : 'Off'}>
        <Switch on={s.slowMode} onChange={(v) => void control({ slowMode: v })} />
      </Row>
      <Row title="Pause everything" desc="Stops all local downloads. TorBox keeps working in the cloud.">
        <Switch on={s.globalPaused} onChange={(v) => void control({ globalPaused: v })} />
      </Row>
    </div>
  );
}

function AutomationSection({ s, save }: { s: SettingsT; save: (p: Partial<SettingsT>) => void }) {
  return (
    <div className="card">
      <Intro icon={<Wand2 />} title="Automation" desc="Keep TorBox and your list tidy without lifting a finger." />
      <Row title="Remove from TorBox when downloaded" desc="Deletes the torrent from your TorBox account as soon as the files are safely on disk — frees up active slots.">
        <Switch on={s.autoRemoveFromTorbox} onChange={(v) => save({ autoRemoveFromTorbox: v })} />
      </Row>
      <Row title="Remove from list when downloaded" desc="Clears finished downloads from the Downloads page (files are kept).">
        <Switch on={s.autoRemoveFromList} onChange={(v) => save({ autoRemoveFromList: v })} />
      </Row>
      {s.autoRemoveFromList && (
        <>
          <Row title="…after" desc="Wait this long before clearing.">
            <NumField value={s.autoRemoveDelayMin} min={0} unit="min" onSave={(n) => save({ autoRemoveDelayMin: n })} />
          </Row>
          <Row title="Leave Sonarr / Radarr items alone" desc="Recommended. The *arr apps need to see the finished download to import it, and remove it themselves afterwards.">
            <Switch on={s.autoRemoveSkipArr} onChange={(v) => save({ autoRemoveSkipArr: v })} />
          </Row>
        </>
      )}
      <Row title="When removing, also delete from TorBox" desc="Default for the remove dialog and for removals requested by Sonarr/Radarr.">
        <Switch on={s.removeDefaults.fromTorbox} onChange={(v) => save({ removeDefaults: { ...s.removeDefaults, fromTorbox: v } })} />
      </Row>
      <Row title="When removing, also delete files" desc="Default for the remove dialog.">
        <Switch on={s.removeDefaults.deleteFiles} onChange={(v) => save({ removeDefaults: { ...s.removeDefaults, deleteFiles: v } })} />
      </Row>
    </div>
  );
}

function IntegrationsSection({ s, save }: { s: SettingsT; save: (p: Partial<SettingsT>) => void }) {
  const system = useApp((st) => st.system);
  const host = location.hostname || 'localhost';
  const port = location.port || (location.protocol === 'https:' ? '443' : '80');
  const base = location.pathname.replace(/\/[^/]*$/, '').replace(/\/$/, '');
  const Cell = ({ label, value }: { label: string; value: string }) => (
    <div>
      <label>{label}</label>
      <span>
        <span className="truncate">{value}</span>
        <button className="icon-btn sm" onClick={() => void copyText(value)} aria-label={`Copy ${label}`}>
          <Copy />
        </button>
      </span>
    </div>
  );
  return (
    <>
      <div className="card">
        <Intro icon={<Plug />} title="Sonarr, Radarr & friends" desc="Torboxed speaks the qBittorrent Web API, so any *arr app can use it as a download client." />
        <Row title="qBittorrent-compatible API" desc="Served at /api/v2 on the same port as this UI.">
          <Switch on={s.qbitEnabled} onChange={(v) => save({ qbitEnabled: v })} />
        </Row>
        <Row stack title="Connection details">
          <div className="connect-card" style={{ width: '100%' }}>
            <Cell label="Host" value={host} />
            <Cell label="Port" value={port} />
            <Cell label="URL base" value={base || '(empty)'} />
            <Cell label="Username / password" value="anything" />
          </div>
        </Row>
      </div>
      <div className="card card-pad">
        <h3 style={{ margin: '0 0 14px', fontSize: 15 }}>Set up in Sonarr / Radarr / Lidarr</h3>
        <ol className="steps">
          <li>
            <span>
              Open <b>Settings → Download Clients</b>, click <b>+</b> and choose <b>qBittorrent</b>.
            </span>
          </li>
          <li>
            <span>
              Set <b>Host</b> to <span className="mono">{host}</span> and <b>Port</b> to <span className="mono">{port}</span>
              {base && (
                <>
                  , <b>URL Base</b> to <span className="mono">{base}</span>
                </>
              )}
              . Enable <b>Use SSL</b> only if you reach Torboxed over https. Any username/password works.
            </span>
          </li>
          <li>
            <span>
              Set <b>Category</b> (e.g. <span className="mono">tv-sonarr</span> or <span className="mono">radarr</span>). Torboxed creates a matching tag and
              downloads to <span className="mono">&lt;default folder&gt;/&lt;category&gt;</span> — change that in Tags & Folders.
            </span>
          </li>
          <li>
            <span>
              Click <b>Test</b>, then <b>Save</b>. Tick <b>Remove Completed</b> so the *arr removes items after importing.
            </span>
          </li>
          <li>
            <span>
              {system?.docker ? (
                <>
                  <b>Docker:</b> mount the same host folder into both containers at the same path (e.g. <span className="mono">/downloads</span>), or add a{' '}
                  <b>Remote Path Mapping</b> in the *arr app.
                </>
              ) : (
                <>
                  If Sonarr/Radarr run on another machine, add a <b>Remote Path Mapping</b> so they can find the downloaded files.
                </>
              )}
            </span>
          </li>
        </ol>
      </div>
    </>
  );
}

function ThemePreview({ id }: { id: string }) {
  const t = THEMES.find((x) => x.id === id)!;
  const c = t.colors;
  return (
    <div className="theme-preview" style={{ background: c.bg }}>
      <div className="tp-side" style={{ background: c.panel }}>
        <i style={{ background: `linear-gradient(90deg, ${c.accent}, ${c.accent2})`, width: '80%' }} />
        <i style={{ background: c.muted, opacity: 0.5, width: '60%' }} />
        <i style={{ background: c.muted, opacity: 0.5, width: '70%' }} />
        <i style={{ background: c.muted, opacity: 0.5, width: '50%' }} />
      </div>
      <div className="tp-main">
        {[0.8, 0.45].map((w, i) => (
          <div key={i} className="tp-card" style={{ background: c.surface, border: `1px solid ${c.border}` }}>
            <i style={{ background: c.text, opacity: 0.8, width: '55%' }} />
            <i style={{ background: c.border, width: '100%' }} />
            <i style={{ background: `linear-gradient(90deg, ${c.accent}, ${c.accent2})`, width: `${w * 100}%`, marginTop: -8 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

const ACCENTS = ['#8b5cf6', '#6366f1', '#3b82f6', '#06b6d4', '#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444', '#ec4899'];

function AppearanceSection({ s, save }: { s: SettingsT; save: (p: Partial<SettingsT>) => void }) {
  const toast = useApp((st) => st.toast);
  return (
    <div className="card">
      <Intro icon={<Palette />} title="Appearance" desc="Make Torboxed yours. Changes apply instantly on every device." />
      <Row stack title="Theme">
        <div className="theme-grid" style={{ width: '100%' }}>
          {THEMES.map((t) => (
            <button key={t.id} className={`theme-card ${s.theme === t.id ? 'active' : ''}`} onClick={() => save({ theme: t.id, accent: null })}>
              <ThemePreview id={t.id} />
              <div className="theme-name">
                {t.name}
                {s.theme === t.id && <CheckCircle2 size={15} color="var(--accent)" />}
              </div>
            </button>
          ))}
        </div>
      </Row>
      <Row title="Accent colour" desc="Override the theme's accent.">
        <div className="swatches">
          <button className={`swatch auto ${!s.accent ? 'active' : ''}`} style={{ '--c': 'var(--accent)' } as React.CSSProperties} onClick={() => save({ accent: null })} data-tip="Theme default">
            {!s.accent && <CheckIcon />}
          </button>
          {ACCENTS.map((a) => (
            <button key={a} className={`swatch ${s.accent === a ? 'active' : ''}`} style={{ '--c': a } as React.CSSProperties} onClick={() => save({ accent: a })} aria-label={a}>
              {s.accent === a && <CheckIcon />}
            </button>
          ))}
        </div>
      </Row>
      <Row title="Density" desc="Compact fits more downloads on screen.">
        <Segmented
          value={s.density}
          onChange={(v) => save({ density: v })}
          options={[
            { value: 'comfortable', label: 'Comfortable' },
            { value: 'compact', label: 'Compact' },
          ]}
        />
      </Row>
      <Row title="Reduce motion" desc="Turns off animations.">
        <Switch on={s.reduceMotion} onChange={(v) => save({ reduceMotion: v })} />
      </Row>
      {!isDesktop && (
        <>
          <Row title="Custom right-click menu" desc="Use Torboxed's context menu in the browser. Hold Shift while right-clicking for the browser's own menu.">
            <Switch on={s.customContextMenu} onChange={(v) => save({ customContextMenu: v })} />
          </Row>
          <Row title="Browser notifications" desc="Get notified when downloads finish while this tab is in the background.">
            <Switch
              on={s.browserNotifications}
              onChange={async (v) => {
                if (v && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
                  const p = await Notification.requestPermission();
                  if (p !== 'granted') return toast('warning', 'Notifications are blocked', 'Allow them in your browser settings.');
                }
                save({ browserNotifications: v });
              }}
            />
          </Row>
        </>
      )}
    </div>
  );
}

function DesktopSection({ s, save }: { s: SettingsT; save: (p: Partial<SettingsT>) => void }) {
  const system = useApp((st) => st.system);
  const d = s.desktop;
  const set = (p: Partial<SettingsT['desktop']>) => save({ desktop: { ...d, ...p } } as Partial<SettingsT>);
  return (
    <div className="card">
      <Intro icon={<Monitor />} title="Desktop app" desc="Windows integration: tray, startup and notifications." />
      <Row title="Close to system tray" desc="The close button hides Torboxed to the tray so downloads keep going. Quit from the tray menu.">
        <Switch on={d.closeToTray} onChange={(v) => set({ closeToTray: v })} />
      </Row>
      <Row title="Launch when Windows starts">
        <Switch on={d.launchOnStartup} onChange={(v) => set({ launchOnStartup: v })} />
      </Row>
      <Row title="Start minimised to tray">
        <Switch on={d.startMinimized} onChange={(v) => set({ startMinimized: v })} />
      </Row>
      <Row title="Desktop notifications" desc="Show a Windows notification when a download finishes or fails.">
        <Switch on={d.notifications} onChange={(v) => set({ notifications: v })} />
      </Row>
      <Row title="Allow network access" desc="Let Sonarr/Radarr (or your phone) on other devices reach Torboxed. Requires restart.">
        <Switch on={d.allowLan} onChange={(v) => set({ allowLan: v })} />
      </Row>
      <Row title="Port" desc={`Currently running on port ${system?.port}. Requires restart.`}>
        <NumField value={s.port} min={1024} max={65535} onSave={(n) => save({ port: n })} />
        <button className="btn" onClick={() => desktop?.app.relaunch()}>
          <RefreshCw />
          Restart
        </button>
      </Row>
    </div>
  );
}

function DataSection() {
  const { system, toast, refreshMeta } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [includeKey, setIncludeKey] = useState(false);
  const restore = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      await api.restore(data);
      await refreshMeta();
      toast('success', 'Backup restored', 'Settings, folders and tags were imported.');
    } catch (e) {
      toast('error', 'Could not restore', (e as Error).message);
    }
  };
  return (
    <div className="card">
      <Intro icon={<Database />} title="Backup & data" desc="Everything is stored in one managed file — export it or move it to another machine." />
      <Row title="Export settings" desc="Downloads a backup of your settings, folders and tags.">
        <label className="row muted" style={{ fontSize: 12.5, cursor: 'pointer' }}>
          <Switch on={includeKey} onChange={setIncludeKey} /> include API key
        </label>
        <a className="btn" href={`api/backup${includeKey ? '?includeKey=1' : ''}`} download>
          <FileDown />
          Export
        </a>
      </Row>
      <Row title="Import settings" desc="Restore from a Torboxed backup file.">
        <button className="btn" onClick={() => fileRef.current?.click()}>
          <FileUp />
          Import…
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && restore(e.target.files[0])} />
      </Row>
      <Row title="Clear finished downloads" desc="Removes completed items from the list (files stay on disk).">
        <button className="btn" onClick={() => void attempt(() => api.clear('completed'), 'Cleared completed downloads')}>
          <CheckCircle2 />
          Clear completed
        </button>
        <button className="btn" onClick={() => void attempt(() => api.clear('error'), 'Cleared failed downloads')}>
          <XCircle />
          Clear failed
        </button>
      </Row>
      <Row title="Reset analytics" desc="Erases download history and statistics.">
        <button className="btn btn-danger" onClick={() => void attempt(() => api.resetAnalytics(), 'Analytics reset')}>
          <Trash2 />
          Reset
        </button>
      </Row>
      <Row title="Data location" desc={<span className="mono">{system?.dataDir}</span>}>
        {desktop && system && (
          <button className="btn" onClick={() => void desktop!.shell.openPath(system.dataDir)}>
            <FolderOpen />
            Open
          </button>
        )}
      </Row>
    </div>
  );
}

function LogsSection() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [level, setLevel] = useState<'all' | 'warn' | 'error'>('all');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.logs().then((l) => alive && setLogs(l)).catch(() => undefined);
    void load();
    const t = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [logs.length]);
  const shown = logs.filter((l) => level === 'all' || l.level === level || (level === 'warn' && l.level === 'error'));
  return (
    <div className="card">
      <Intro icon={<ScrollText />} title="Logs" desc="What Torboxed has been up to. Useful when something doesn't work." />
      <div style={{ padding: '0 22px 22px' }}>
        <div className="toolbar">
          <Segmented
            value={level}
            onChange={setLevel}
            options={[
              { value: 'all', label: 'All' },
              { value: 'warn', label: 'Warnings' },
              { value: 'error', label: 'Errors' },
            ]}
          />
          <span className="spacer" />
          <button className="btn btn-sm" onClick={() => void copyText(logs.map((l) => `${new Date(l.t).toISOString()} ${l.level.toUpperCase()} ${l.msg}`).join('\n'))}>
            <Copy /> Copy
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => void api.clearLogs().then(() => setLogs([]))}>
            <Trash2 /> Clear
          </button>
        </div>
        <div className="log-view" ref={ref}>
          {shown.length === 0 && <span className="muted">No log entries.</span>}
          {shown.map((l, i) => (
            <div key={i} className={`log-line ${l.level}`}>
              <span className="t">{new Date(l.t).toLocaleTimeString()}</span>
              <span className="l">{l.level.toUpperCase()}</span>
              <span className="m">{l.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AboutSection() {
  const system = useApp((s) => s.system);
  const [latest, setLatest] = useState<{ tag: string; url: string } | null | 'checking' | 'error'>(null);
  const check = async () => {
    setLatest('checking');
    try {
      const r = await fetch('https://api.github.com/repos/scopeddlol/torboxed/releases/latest');
      if (!r.ok) throw new Error();
      const j = await r.json();
      setLatest({ tag: j.tag_name, url: j.html_url });
    } catch {
      setLatest('error');
    }
  };
  const current = system?.version ?? '';
  const upToDate = latest && typeof latest === 'object' && latest.tag.replace(/^v/, '') === current;
  return (
    <>
      <div className="card about-hero">
        <Logo size={84} />
        <div>
          <h2 className="brand-name" style={{ fontSize: 28 }}>
            Torboxed
          </h2>
          <div className="muted">Version {current} · {system?.desktop ? 'Desktop' : system?.docker ? 'Docker' : 'Server'} edition</div>
          <div className="row mt">
            <button className="btn btn-sm" onClick={check} disabled={latest === 'checking'}>
              {latest === 'checking' ? <Loader2 className="spin" /> : <Sparkles />}
              Check for updates
            </button>
            <a className="btn btn-sm btn-ghost" href="https://github.com/scopeddlol/torboxed" target="_blank" rel="noreferrer">
              <ExternalLink /> GitHub
            </a>
            {latest === 'error' && <span className="muted">Couldn't check right now.</span>}
            {latest && typeof latest === 'object' &&
              (upToDate ? (
                <span className="badge tone-success">
                  <CheckIcon /> Up to date
                </span>
              ) : (
                <a className="badge tone-accent" href={latest.url} target="_blank" rel="noreferrer">
                  <Bell /> {latest.tag} available
                </a>
              ))}
          </div>
        </div>
      </div>
      <div className="card">
        <Row title="Platform">{system && `${system.platform} · ${system.arch}`}</Row>
        <Row title="Node.js">{system?.node}</Row>
        <Row title="Running since">{formatDate(system?.startedAt)}</Row>
        <Row title="Keyboard shortcuts" stack>
          <div className="connect-card" style={{ width: '100%', gridTemplateColumns: 'repeat(3, 1fr)' }}>
            {[
              ['Ctrl + N', 'Add torrents'],
              ['Ctrl + V', 'Paste magnets'],
              ['/', 'Search'],
              ['Ctrl + A', 'Select all'],
              ['Delete', 'Remove selected'],
              ['Enter', 'Open details'],
              ['Alt + 1–5', 'Switch pages'],
              ['Ctrl + ,', 'Settings'],
              ['Esc', 'Close / deselect'],
            ].map(([k, v]) => (
              <div key={k}>
                <label>{v}</label>
                <span>{k}</span>
              </div>
            ))}
          </div>
        </Row>
      </div>
    </>
  );
}

export function Settings() {
  const { settings, saveSettings, section, go } = useApp();
  if (!settings) return null;
  const current = (SECTIONS.find((x) => x.id === section && (!x.desktopOnly || isDesktop))?.id ?? 'torbox') as Section;
  const save = (p: Partial<SettingsT>) => void saveSettings(p);

  return (
    <div className="page">
      <div className="settings-layout">
        <nav className="settings-nav">
          {SECTIONS.filter((x) => !x.desktopOnly || isDesktop).map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${current === id ? 'active' : ''}`} onClick={() => go('settings', id)}>
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="settings-content" key={current}>
          {current === 'torbox' && <TorBoxSection s={settings} save={save} />}
          {current === 'downloads' && <DownloadsSection s={settings} save={save} />}
          {current === 'speed' && <SpeedSection s={settings} save={save} />}
          {current === 'automation' && <AutomationSection s={settings} save={save} />}
          {current === 'integrations' && <IntegrationsSection s={settings} save={save} />}
          {current === 'appearance' && <AppearanceSection s={settings} save={save} />}
          {current === 'desktop' && <DesktopSection s={settings} save={save} />}
          {current === 'data' && <DataSection />}
          {current === 'logs' && <LogsSection />}
          {current === 'about' && <AboutSection />}
        </div>
      </div>
    </div>
  );
}
