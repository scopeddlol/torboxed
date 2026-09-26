import { memo, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  CheckCircle2,
  Cloud,
  CloudCog,
  Download,
  FolderOpen,
  Hourglass,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Tag as TagIcon,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react';
import type { JobSummary, Tag } from '../../shared/types';
import { attempt, useApp } from '../store';
import { api } from '../lib/api';
import { desktop } from '../lib/desktop';
import { formatBytes, formatEta, formatSpeed, splitSpeed, timeAgo } from '../lib/format';
import { Check, Empty, jobLabel, jobProgress, jobTone, Logo, ProgressBar, Ring, Segmented, Sparkline, TagChip } from '../components/ui';
import { openMenuAt, useMenuProvider } from '../components/ContextMenu';
import { jobMenu, openJobFolder } from '../components/jobMenu';

type Filter = 'all' | 'active' | 'torbox' | 'completed' | 'errors';

const matches = (j: JobSummary, f: Filter) => {
  switch (f) {
    case 'active':
      return j.status === 'downloading' || j.status === 'waiting' || j.status === 'queued' || j.status === 'submitting';
    case 'torbox':
      return j.status === 'torbox' || j.status === 'submitting';
    case 'completed':
      return j.status === 'completed';
    case 'errors':
      return j.status === 'error' || !!j.warning;
    default:
      return true;
  }
};

const STATUS_ICON: Record<string, typeof Download> = {
  completed: CheckCircle2,
  error: XCircle,
  paused: Pause,
  downloading: ArrowDownToLine,
  torbox: Cloud,
  submitting: CloudCog,
  queued: Hourglass,
  waiting: Hourglass,
};

const JobRow = memo(function JobRow({
  job,
  tag,
  selected,
  globalPaused,
  index,
}: {
  job: JobSummary;
  tag: Tag | undefined;
  selected: boolean;
  globalPaused: boolean;
  index: number;
}) {
  const tone = jobTone(job);
  const Icon = STATUS_ICON[job.paused ? 'paused' : job.status] ?? Download;
  const st = useApp.getState();
  const progress = jobProgress(job);
  const inTorbox = job.status === 'torbox' || job.status === 'submitting' || job.status === 'queued';

  return (
    <div
      className={`job ${selected ? 'selected' : ''}`}
      data-menu="job"
      data-id={job.id}
      style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        const s = useApp.getState();
        if (e.shiftKey && s.selected.length) {
          const rows = [...document.querySelectorAll<HTMLElement>('.job[data-id]')].map((el) => el.dataset.id!);
          const a = rows.indexOf(s.selected[s.selected.length - 1]);
          const b = rows.indexOf(job.id);
          const range = rows.slice(Math.min(a, b), Math.max(a, b) + 1);
          s.setSelected([...new Set([...s.selected, ...range])]);
        } else s.toggleSelected(job.id, e.ctrlKey || e.metaKey);
      }}
      onDoubleClick={() => st.openDrawer(job.id)}
    >
      <Check on={selected} onChange={() => st.toggleSelected(job.id)} label="Select" />
      <Ring value={job.status === 'completed' ? 1 : progress} tone={tone}>
        <Icon className={job.status === 'submitting' ? 'spin' : ''} />
      </Ring>
      <div className="job-main">
        <div className="job-title">
          <span
            className="job-name"
            onClick={(e) => {
              e.stopPropagation();
              st.openDrawer(job.id);
            }}
            title={job.name}
          >
            {job.name}
          </span>
          <TagChip tag={tag} />
        </div>
        <ProgressBar job={job} />
        <div className="job-meta">
          <span className={`badge tone-${tone}`}>
            {job.status === 'downloading' && !job.paused && <span className="pulse" />}
            {jobLabel(job, globalPaused)}
          </span>
          <span>
            {job.status === 'completed' || inTorbox ? formatBytes(job.size) : `${formatBytes(job.downloaded)} of ${formatBytes(job.size)}`}
          </span>
          {job.fileCount > 1 && (
            <>
              <span className="sep" />
              <span>
                {job.status === 'completed' ? job.fileCount : `${job.filesDone}/${job.fileCount}`} files
              </span>
            </>
          )}
          {job.cached && (
            <>
              <span className="sep" />
              <span style={{ color: 'var(--accent-2)', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                <Zap size={11} /> Instant
              </span>
            </>
          )}
          <span className="sep" />
          <span>{job.status === 'completed' ? `Finished ${timeAgo(job.completedAt)}` : `Added ${timeAgo(job.addedAt)}`}</span>
          {job.error && (
            <>
              <span className="sep" />
              <span className="err" title={job.error}>
                {job.error}
              </span>
            </>
          )}
          {!job.error && job.warning && (
            <>
              <span className="sep" />
              <span className="warn" title={job.warning}>
                {job.warning}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="job-side">
        <div className="job-numbers">
          {job.status === 'downloading' ? (
            <>
              <span className="job-speed">{formatSpeed(job.speed)}</span>
              <span className="job-eta">{formatEta(job.eta)} left</span>
            </>
          ) : job.status === 'torbox' ? (
            <>
              <span className="job-speed" style={{ color: 'var(--info)' }}>
                {job.torboxSpeed ? formatSpeed(job.torboxSpeed) : `${Math.round(job.torboxProgress * 100)}%`}
              </span>
              <span className="job-eta">{job.torboxSeeds ? `${job.torboxSeeds} seeds` : job.torboxState || 'on TorBox'}</span>
            </>
          ) : job.status === 'completed' ? (
            <>
              <span className="job-speed" style={{ color: 'var(--success)' }}>
                {formatBytes(job.size)}
              </span>
              <span className="job-eta">{job.removedFromTorbox ? 'cleared from TorBox' : 'on disk'}</span>
            </>
          ) : (
            <>
              <span className="job-speed muted">—</span>
              <span className="job-eta">{Math.round(progress * 100)}%</span>
            </>
          )}
        </div>
        <div className="job-actions">
          {job.status === 'error' || job.warning ? (
            <button className="icon-btn" data-tip="Retry" onClick={() => void attempt(() => api.action([job.id], 'retry'))}>
              <RotateCcw />
            </button>
          ) : job.status !== 'completed' ? (
            <button
              className="icon-btn"
              data-tip={job.paused ? 'Resume' : 'Pause'}
              onClick={() => void attempt(() => api.action([job.id], job.paused ? 'resume' : 'pause'))}
            >
              {job.paused ? <Play /> : <Pause />}
            </button>
          ) : desktop ? (
            <button className="icon-btn" data-tip="Show in folder" onClick={() => openJobFolder(job)}>
              <FolderOpen />
            </button>
          ) : null}
          <button className="icon-btn danger" data-tip="Remove" onClick={() => st.askRemove([job.id])}>
            <Trash2 />
          </button>
          <button className="icon-btn" data-tip="More" data-tip-pos="left" onClick={(e) => openMenuAt(e.currentTarget, jobMenu(job))}>
            <MoreHorizontal />
          </button>
        </div>
      </div>
    </div>
  );
});

function Welcome() {
  const saveSettings = useApp((s) => s.saveSettings);
  const toast = useApp((s) => s.toast);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    if (!key.trim()) return;
    setBusy(true);
    try {
      const acct = await api.testKey(key.trim());
      await saveSettings({ torboxApiKey: key.trim(), onboarded: true });
      toast('success', 'TorBox connected', `Signed in as ${acct.email ?? 'your account'} (${acct.planName})`);
    } catch (e) {
      toast('error', 'That key did not work', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card welcome">
      <div>
        <span className="badge tone-accent" style={{ marginBottom: 14 }}>
          <Sparkles /> Welcome to Torboxed
        </span>
        <h2>Connect your TorBox account</h2>
        <p>
          Paste your API key and Torboxed will send torrents to TorBox, then download the finished files straight to your folders — automatically. Find
          it in{' '}
          <a href="https://torbox.app/settings" target="_blank" rel="noreferrer">
            TorBox → Settings → API Key
          </a>
          .
        </p>
        <div className="welcome-form">
          <div className="input-with-icon">
            <KeyRound />
            <input
              className="input"
              type="password"
              placeholder="Your TorBox API key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && connect()}
            />
          </div>
          <button className="btn btn-primary" onClick={connect} disabled={busy || !key.trim()}>
            {busy ? <Loader2 className="spin" /> : <Zap />}
            Connect
          </button>
        </div>
      </div>
      <Logo size={150} />
    </div>
  );
}

export function Downloads() {
  const { jobs, tags, selected, settings, speedHistory, tick, search, openAdd, setSelected, askRemove } = useApp();
  const [filter, setFilter] = useState<Filter>('all');
  const [tagFilter, setTagFilter] = useState('');
  const [sort, setSort] = useState<'queue' | 'added' | 'name' | 'size' | 'progress'>('queue');
  const tagMap = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags]);

  useMenuProvider('job', (el) => {
    const job = useApp.getState().jobs.find((j) => j.id === el.dataset.id);
    return job ? jobMenu(job) : null;
  });

  const counts = useMemo(() => {
    const c = { all: jobs.length, active: 0, torbox: 0, completed: 0, errors: 0 };
    for (const j of jobs) for (const f of ['active', 'torbox', 'completed', 'errors'] as const) if (matches(j, f)) c[f]++;
    return c;
  }, [jobs]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = jobs.filter(
      (j) => matches(j, filter) && (!tagFilter || (tagFilter === 'none' ? !j.tagId : j.tagId === tagFilter)) && (!q || j.name.toLowerCase().includes(q) || j.hash?.includes(q)),
    );
    const rank = (j: JobSummary) => (j.status === 'downloading' ? 0 : j.status === 'error' ? 1 : j.status === 'completed' ? 4 : j.status === 'torbox' ? 2 : 3);
    return list.sort((a, b) => {
      switch (sort) {
        case 'added':
          return b.addedAt - a.addedAt;
        case 'name':
          return a.name.localeCompare(b.name);
        case 'size':
          return b.size - a.size;
        case 'progress':
          return jobProgress(b) - jobProgress(a);
        default:
          return rank(a) - rank(b) || (a.status === 'completed' ? (b.completedAt ?? 0) - (a.completedAt ?? 0) : a.order - b.order);
      }
    });
  }, [jobs, filter, tagFilter, search, sort]);

  // Keyboard shortcuts for the list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('.overlay, .drawer')) return;
      const st = useApp.getState();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        st.setSelected(visible.map((j) => j.id));
      } else if (e.key === 'Delete' && st.selected.length) {
        st.askRemove(st.selected);
      } else if (e.key === 'Escape' && st.selected.length) {
        st.setSelected([]);
      } else if (e.key === 'Enter' && st.selected.length === 1) {
        st.openDrawer(st.selected[0]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible]);

  const active = jobs.filter((j) => j.status === 'downloading').length;
  const inCloud = jobs.filter((j) => j.status === 'torbox' || j.status === 'submitting' || j.status === 'queued').length;
  const done = jobs.filter((j) => j.status === 'completed');
  const remaining = jobs.filter((j) => j.status !== 'completed' && j.status !== 'error').reduce((a, j) => a + Math.max(0, j.size - j.downloaded), 0);
  const [spd, unit] = splitSpeed(tick?.speed ?? 0);
  const allSelected = visible.length > 0 && visible.every((j) => selected.includes(j.id));
  const selJobs = jobs.filter((j) => selected.includes(j.id));

  return (
    <div className="page">
      {!settings?.torboxApiKey && <Welcome />}

      <div className="stats-row">
        <div className="card stat tone-accent">
          <div className="stat-top">
            <span className="stat-icon">
              <ArrowDownToLine />
            </span>
            Download speed
          </div>
          <div className="stat-value">
            {spd}
            <small>{unit}</small>
          </div>
          <div className="stat-sub">{tick?.limit ? `Limited to ${formatSpeed(tick.limit)}${tick.slowMode ? ' · slow mode' : ''}` : 'Unlimited'}</div>
          <Sparkline data={speedHistory.slice(-90)} />
        </div>
        <div className="card stat tone-accent2">
          <div className="stat-top">
            <span className="stat-icon">
              <Download />
            </span>
            Active downloads
          </div>
          <div className="stat-value">
            {active}
            <small>/ {settings?.maxConcurrentDownloads ?? 0} slots</small>
          </div>
          <div className="stat-sub">{formatBytes(remaining)} left to download</div>
        </div>
        <div className="card stat tone-info">
          <div className="stat-top">
            <span className="stat-icon">
              <Cloud />
            </span>
            In TorBox
          </div>
          <div className="stat-value">{inCloud}</div>
          <div className="stat-sub">Being fetched or queued in the cloud</div>
        </div>
        <div className="card stat tone-success">
          <div className="stat-top">
            <span className="stat-icon">
              <CheckCircle2 />
            </span>
            Completed
          </div>
          <div className="stat-value">{done.length}</div>
          <div className="stat-sub">{formatBytes(tick?.sessionBytes ?? 0)} downloaded this session</div>
        </div>
      </div>

      <div className="toolbar">
        <Check
          on={allSelected}
          partial={selected.length > 0}
          onChange={(v) => setSelected(v ? visible.map((j) => j.id) : [])}
          label="Select all"
        />
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'active', label: 'Active', count: counts.active },
            { value: 'torbox', label: 'In TorBox', count: counts.torbox },
            { value: 'completed', label: 'Completed', count: counts.completed },
            { value: 'errors', label: 'Issues', count: counts.errors },
          ]}
        />
        <span className="spacer" />
        {tags.length > 0 && (
          <div className="input-with-icon" style={{ flex: 'none', width: 170 }}>
            <TagIcon />
            <select className="select" style={{ paddingLeft: 36, height: 36 }} value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
              <option value="">All tags</option>
              <option value="none">Untagged</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <select className="select" style={{ width: 150, height: 36 }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="queue">Sort: Smart</option>
          <option value="added">Sort: Newest</option>
          <option value="name">Sort: Name</option>
          <option value="size">Sort: Size</option>
          <option value="progress">Sort: Progress</option>
        </select>
        {counts.completed > 0 && (
          <button className="btn btn-sm btn-ghost" onClick={() => void attempt(() => api.clear('completed'), 'Cleared completed downloads')}>
            <CheckCircle2 />
            Clear completed
          </button>
        )}
      </div>

      {visible.length ? (
        <div className="job-list">
          {visible.map((j, i) => (
            <JobRow
              key={j.id}
              job={j}
              index={i}
              tag={j.tagId ? tagMap.get(j.tagId) : undefined}
              selected={selected.includes(j.id)}
              globalPaused={!!settings?.globalPaused}
            />
          ))}
        </div>
      ) : jobs.length ? (
        <div className="card">
          <Empty icon={<AlertTriangle />} title="Nothing matches">
            Try another filter or clear your search.
          </Empty>
        </div>
      ) : (
        <div className="card">
          <Empty
            icon={<Download />}
            title="No downloads yet"
            actions={
              <button className="btn btn-primary btn-lg" onClick={() => openAdd()}>
                <Plus />
                Add your first torrent
              </button>
            }
          >
            Paste a magnet link, drop .torrent files anywhere on this window, or connect Sonarr & Radarr from Settings → Integrations.
          </Empty>
        </div>
      )}

      {selected.length > 0 && (
        <div className="bulk-bar">
          <span className="count">{selected.length} selected</span>
          <button className="btn btn-sm btn-ghost" onClick={() => void attempt(() => api.action(selected, 'pause'))}>
            <Pause /> Pause
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => void attempt(() => api.action(selected, 'resume'))}>
            <Play /> Resume
          </button>
          {selJobs.some((j) => j.status === 'error') && (
            <button className="btn btn-sm btn-ghost" onClick={() => void attempt(() => api.action(selected, 'retry'))}>
              <RotateCcw /> Retry
            </button>
          )}
          <button className="btn btn-sm btn-ghost" onClick={(e) => openMenuAt(e.currentTarget, jobMenu(selJobs[0]))}>
            <MoreHorizontal /> More
          </button>
          <button className="btn btn-sm btn-danger" onClick={() => askRemove(selected)}>
            <Trash2 /> Remove
          </button>
        </div>
      )}
    </div>
  );
}
