import { useEffect, useState } from 'react';
import { ArrowDownToLine, BarChart3, Cloud, Download, FolderTree, Pause, Play, Plus, Search, Settings, Turtle } from 'lucide-react';
import type { AccountInfo } from '../../shared/types';
import type { WindowState } from '../../shared/bridge';
import { useApp, type Page } from '../store';
import { desktop } from '../lib/desktop';
import { api } from '../lib/api';
import { formatSpeed, splitSpeed } from '../lib/format';
import { Logo, Sparkline } from './ui';

export const PAGE_META: Record<Page, { title: string; subtitle: string; icon: typeof Download }> = {
  downloads: { title: 'Downloads', subtitle: 'Everything moving from TorBox to your disk', icon: Download },
  cloud: { title: 'TorBox Cloud', subtitle: 'Torrents stored in your TorBox account', icon: Cloud },
  analytics: { title: 'Analytics', subtitle: 'Download metrics, speeds & trends', icon: BarChart3 },
  organize: { title: 'Tags & Folders', subtitle: 'Route downloads to the right place automatically', icon: FolderTree },
  settings: { title: 'Settings', subtitle: 'Configure every part of Torboxed', icon: Settings },
};

/* ── Window controls, drawn to match Windows 11 ── */
const MinIcon = () => (
  <svg viewBox="0 0 16 16">
    <path d="M3 8h10" stroke="currentColor" strokeWidth="1.1" />
  </svg>
);
const MaxIcon = () => (
  <svg viewBox="0 0 16 16">
    <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.1" />
  </svg>
);
const RestoreIcon = () => (
  <svg viewBox="0 0 16 16">
    <rect x="3.5" y="5.5" width="7" height="7" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1.1" />
    <path d="M5.8 3.5h5.2a1.5 1.5 0 0 1 1.5 1.5v5.2" fill="none" stroke="currentColor" strokeWidth="1.1" />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 16 16">
    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.1" />
  </svg>
);

export function TitleBar() {
  const [state, setState] = useState<WindowState>({ maximized: false, fullscreen: false, focused: true });
  const page = useApp((s) => s.page);
  const speed = useApp((s) => s.tick?.speed ?? 0);
  const active = useApp((s) => s.jobs.filter((j) => j.status === 'downloading').length);
  const closeToTray = useApp((s) => s.settings?.desktop.closeToTray ?? true);

  useEffect(() => {
    if (!desktop) return;
    void desktop.window.getState().then(setState);
    return desktop.window.onState(setState);
  }, []);

  if (!desktop || state.fullscreen) return null;
  return (
    <header className={`titlebar ${state.focused ? '' : 'blurred'}`}>
      <div className="titlebar-brand">
        <Logo size={18} />
        <span>Torboxed</span>
        <span className="titlebar-crumb">/ {PAGE_META[page].title}</span>
      </div>
      <div className="titlebar-center">
        {active > 0 && (
          <span className="titlebar-speed">
            <ArrowDownToLine size={13} />
            {formatSpeed(speed)} · {active} active
          </span>
        )}
      </div>
      <div className="titlebar-controls">
        <button className="wc-btn" aria-label="Minimize" onClick={() => desktop!.window.minimize()}>
          <MinIcon />
        </button>
        <button className="wc-btn" aria-label={state.maximized ? 'Restore' : 'Maximize'} onClick={() => desktop!.window.toggleMaximize()}>
          {state.maximized ? <RestoreIcon /> : <MaxIcon />}
        </button>
        <button className="wc-btn close" aria-label={closeToTray ? 'Close to tray' : 'Exit'} onClick={() => desktop!.window.close()}>
          <CloseIcon />
        </button>
      </div>
    </header>
  );
}

const NAV: { page: Page; icon: typeof Download; label: string }[] = [
  { page: 'downloads', icon: Download, label: 'Downloads' },
  { page: 'cloud', icon: Cloud, label: 'TorBox Cloud' },
  { page: 'analytics', icon: BarChart3, label: 'Analytics' },
  { page: 'organize', icon: FolderTree, label: 'Tags & Folders' },
];

export function useAccount() {
  const key = useApp((s) => s.settings?.torboxApiKey ?? '');
  const [account, setAccount] = useState<AccountInfo | null>(null);
  useEffect(() => {
    let alive = true;
    if (!key) {
      setAccount(null);
      return;
    }
    api
      .account()
      .then((a) => alive && setAccount(a))
      .catch(() => alive && setAccount(null));
    return () => {
      alive = false;
    };
  }, [key]);
  return account;
}

export function Sidebar() {
  const page = useApp((s) => s.page);
  const go = useApp((s) => s.go);
  const jobs = useApp((s) => s.jobs);
  const history = useApp((s) => s.speedHistory);
  const speed = useApp((s) => s.tick?.speed ?? 0);
  const torbox = useApp((s) => s.tick?.torbox);
  const account = useAccount();
  const active = jobs.filter((j) => j.status !== 'completed' && j.status !== 'error').length;
  const errors = jobs.filter((j) => j.status === 'error').length;
  const downloading = jobs.filter((j) => j.status === 'downloading').length;
  const [value, unit] = splitSpeed(speed);

  const statusDot = !torbox?.configured ? '' : torbox.ok === false ? 'bad' : 'ok';
  return (
    <aside className="sidebar">
      <div className="brand">
        <Logo size={38} />
        <div className="brand-text">
          <div className="brand-name">Torboxed</div>
          <div className="brand-sub">TorBox Downloader</div>
        </div>
      </div>
      <div className="nav-label">Library</div>
      {NAV.map(({ page: p, icon: Icon, label }) => (
        <button key={p} className={`nav-item ${page === p ? 'active' : ''}`} onClick={() => go(p)} data-menu="nav" data-page={p}>
          <Icon />
          <span>{label}</span>
          {p === 'downloads' && errors > 0 && <span className="nav-count danger">{errors}</span>}
          {p === 'downloads' && errors === 0 && active > 0 && <span className="nav-count">{active}</span>}
        </button>
      ))}
      <div className="nav-label">System</div>
      <button className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => go('settings')} data-menu="nav" data-page="settings">
        <Settings />
        <span>Settings</span>
      </button>

      <div className="sidebar-foot">
        <div className="speed-widget">
          <div className="speed-widget-top">
            <span className="speed-widget-label">Download</span>
            <span className="speed-widget-label" style={{ textTransform: 'none' }}>
              {downloading} downloading
            </span>
          </div>
          <div className="speed-widget-value">
            {value}
            <small>{unit}</small>
          </div>
          <Sparkline data={history.slice(-60)} />
        </div>
        <button className="account-chip" onClick={() => go('settings', 'torbox')}>
          <span className={`dot ${statusDot}`} />
          <span className="account-chip-text">
            <div className="account-chip-title">{account?.email ?? (torbox?.configured ? 'TorBox connected' : 'Connect TorBox')}</div>
            <div className="account-chip-sub">
              {!torbox?.configured
                ? 'Add your API key'
                : torbox.ok === false
                  ? (torbox.error ?? 'Connection problem')
                  : account
                    ? `${account.planName} plan`
                    : 'Checking…'}
            </div>
          </span>
        </button>
      </div>
    </aside>
  );
}

export function TopBar() {
  const page = useApp((s) => s.page);
  const settings = useApp((s) => s.settings);
  const tick = useApp((s) => s.tick);
  const control = useApp((s) => s.control);
  const openAdd = useApp((s) => s.openAdd);
  const search = useApp((s) => s.search);
  const setSearch = useApp((s) => s.setSearch);
  const meta = PAGE_META[page];
  const paused = !!settings?.globalPaused;
  const slow = !!settings?.slowMode;
  const limit = tick?.limit ?? 0;

  return (
    <div className="topbar">
      <div className="topbar-title">
        <h1>{meta.title}</h1>
        <p>{meta.subtitle}</p>
      </div>
      <div className="topbar-actions">
        {(page === 'downloads' || page === 'cloud') && (
          <div className="input-with-icon search">
            <Search />
            <input
              id="global-search"
              className="input"
              placeholder="Search…  /"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && (setSearch(''), (e.target as HTMLInputElement).blur())}
            />
          </div>
        )}
        <div className="speed-pill" data-tip="Current download speed" data-tip-pos="bottom">
          <ArrowDownToLine />
          {formatSpeed(tick?.speed ?? 0)}
          <span className="limit">{limit ? `≤ ${formatSpeed(limit)}` : '∞'}</span>
        </div>
        <button
          className={`btn btn-toggle ${slow ? 'on info' : ''}`}
          onClick={() => void control({ slowMode: !slow })}
          data-tip={slow ? 'Slow mode is on' : `Slow mode (${formatSpeed((settings?.slowModeLimitKBps ?? 0) * 1024)})`}
          data-tip-pos="bottom"
        >
          <Turtle />
          <span>Slow</span>
        </button>
        <button
          className={`btn btn-toggle ${paused ? 'on' : ''}`}
          onClick={() => void control({ globalPaused: !paused })}
          data-tip={paused ? 'Resume all downloads' : 'Pause all downloads'}
          data-tip-pos="bottom"
        >
          {paused ? <Play /> : <Pause />}
          <span>{paused ? 'Resume' : 'Pause'}</span>
        </button>
        <button className="btn btn-primary" onClick={() => openAdd()}>
          <Plus />
          Add
        </button>
      </div>
    </div>
  );
}
