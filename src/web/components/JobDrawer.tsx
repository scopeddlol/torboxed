import { useEffect, useState } from 'react';
import { AlertTriangle, Copy, File, FolderOpen, Pause, Play, RotateCcw, Trash2, X } from 'lucide-react';
import type { Job } from '../../shared/types';
import { attempt, useApp } from '../store';
import { api } from '../lib/api';
import { copyText, desktop } from '../lib/desktop';
import { formatBytes, formatDate, formatDuration, formatEta, formatSpeed } from '../lib/format';
import { jobLabel, jobTone, ProgressBar, TagChip } from './ui';
import { openJobFolder } from './jobMenu';

const ORIGIN: Record<string, string> = { ui: 'Added in Torboxed', qbit: 'Sonarr / Radarr (qBittorrent API)', cloud: 'Imported from TorBox Cloud' };

export function JobDrawer() {
  const drawerId = useApp((s) => s.drawerId);
  const summary = useApp((s) => s.jobs.find((j) => j.id === s.drawerId));
  const tags = useApp((s) => s.tags);
  const globalPaused = useApp((s) => !!s.settings?.globalPaused);
  const close = () => useApp.getState().openDrawer(null);
  const [job, setJob] = useState<Job | null>(null);

  useEffect(() => {
    if (!drawerId) return setJob(null);
    let alive = true;
    const load = () =>
      api
        .job(drawerId)
        .then((j) => alive && setJob(j))
        .catch(() => alive && setJob(null));
    void load();
    const t = setInterval(load, 1000);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [drawerId]);

  if (!drawerId || !summary) return null;
  const j = { ...summary, ...(job ?? {}) } as Job;
  const tone = jobTone(summary);
  const tag = tags.find((t) => t.id === j.tagId);
  const copy = async (label: string, text: string) => (await copyText(text)) && useApp.getState().toast('success', `${label} copied`);

  return (
    <>
      <div className="drawer-overlay" onClick={close} />
      <aside className="drawer" data-menu="job" data-id={j.id}>
        <div className="drawer-head">
          <div className="row">
            <span className={`badge tone-${tone}`}>{jobLabel(summary, globalPaused)}</span>
            <TagChip tag={tag} />
            <span className="grow" />
            {j.status === 'error' || j.warning ? (
              <button className="icon-btn" data-tip="Retry" onClick={() => void attempt(() => api.action([j.id], 'retry'))}>
                <RotateCcw />
              </button>
            ) : j.status !== 'completed' ? (
              <button className="icon-btn" data-tip={j.paused ? 'Resume' : 'Pause'} onClick={() => void attempt(() => api.action([j.id], j.paused ? 'resume' : 'pause'))}>
                {j.paused ? <Play /> : <Pause />}
              </button>
            ) : null}
            {desktop && (
              <button className="icon-btn" data-tip="Open folder" onClick={() => openJobFolder(summary)}>
                <FolderOpen />
              </button>
            )}
            <button className="icon-btn danger" data-tip="Remove" onClick={() => useApp.getState().askRemove([j.id])}>
              <Trash2 />
            </button>
            <button className="icon-btn" onClick={close} aria-label="Close">
              <X />
            </button>
          </div>
          <h2>{j.name}</h2>
        </div>
        <div className="drawer-body">
          {j.error && (
            <div className="callout tone-danger">
              <AlertTriangle />
              <div>{j.error}</div>
            </div>
          )}
          {!j.error && j.warning && (
            <div className="callout tone-warning">
              <AlertTriangle />
              <div>{j.warning}</div>
            </div>
          )}
          <section className="drawer-section">
            <h4>Progress</h4>
            <ProgressBar job={summary} />
            <div className="row mt" style={{ justifyContent: 'space-between', fontSize: 13 }}>
              <span>
                <b>{formatBytes(j.downloaded)}</b> <span className="muted">of {formatBytes(j.size)}</span>
              </span>
              {j.status === 'downloading' && (
                <span>
                  <b>{formatSpeed(j.speed)}</b> <span className="muted">· {formatEta(j.eta)} left</span>
                </span>
              )}
              {j.status === 'torbox' && (
                <span className="muted">
                  TorBox: {j.torboxState || 'working'} · {Math.round(j.torboxProgress * 100)}%{j.torboxSpeed ? ` · ${formatSpeed(j.torboxSpeed)}` : ''}
                </span>
              )}
            </div>
          </section>

          <section className="drawer-section">
            <h4>Details</h4>
            <dl className="info-grid">
              <dt>Source</dt>
              <dd>{ORIGIN[j.origin] ?? j.origin}</dd>
              <dt>Info hash</dt>
              <dd className="mono">
                {j.hash ?? '—'}
                {j.hash && (
                  <button className="icon-btn sm" onClick={() => copy('Hash', j.hash!)} aria-label="Copy hash">
                    <Copy />
                  </button>
                )}
              </dd>
              <dt>TorBox ID</dt>
              <dd>
                {j.torboxId ?? '—'}
                {j.removedFromTorbox && <span className="badge tone-muted">removed from TorBox</span>}
              </dd>
              <dt>Save path</dt>
              <dd className="mono">
                {j.contentPath || j.savePath}
                <button className="icon-btn sm" onClick={() => copy('Path', j.contentPath || j.savePath)} aria-label="Copy path">
                  <Copy />
                </button>
              </dd>
              {j.category && (
                <>
                  <dt>Category</dt>
                  <dd>{j.category}</dd>
                </>
              )}
              <dt>Instant (cached)</dt>
              <dd>{j.cached === null ? '—' : j.cached ? 'Yes ⚡' : 'No'}</dd>
              <dt>Added</dt>
              <dd>{formatDate(j.addedAt)}</dd>
              {j.readyAt && (
                <>
                  <dt>Ready on TorBox</dt>
                  <dd>
                    {formatDate(j.readyAt)} <span className="muted">({formatDuration(j.readyAt - j.addedAt)})</span>
                  </dd>
                </>
              )}
              {j.completedAt && (
                <>
                  <dt>Completed</dt>
                  <dd>{formatDate(j.completedAt)}</dd>
                  <dt>Download time</dt>
                  <dd>
                    {formatDuration(j.completedAt - (j.startedAt ?? j.completedAt))}
                    {j.startedAt && j.completedAt > j.startedAt && (
                      <span className="muted"> · avg {formatSpeed(j.size / ((j.completedAt - j.startedAt) / 1000))}</span>
                    )}
                  </dd>
                </>
              )}
            </dl>
          </section>

          {job && job.files.length > 0 && (
            <section className="drawer-section">
              <h4>
                Files · {job.files.filter((f) => f.state !== 'skipped').length}
                {job.files.some((f) => f.state === 'skipped') && ` (${job.files.filter((f) => f.state === 'skipped').length} skipped)`}
              </h4>
              <div>
                {job.files.map((f) => (
                  <div key={f.id} className="file-row" style={{ opacity: f.state === 'skipped' ? 0.45 : 1 }}>
                    <span className="name row" style={{ gap: 8 }} title={f.path}>
                      <File size={14} className="muted" />
                      <span className="truncate">{f.path.split(/[\\/]/).slice(-1)[0]}</span>
                    </span>
                    <span className="size">{f.state === 'skipped' ? 'skipped' : `${formatBytes(f.downloaded)} / ${formatBytes(f.size)}`}</span>
                    {f.state !== 'skipped' && (
                      <div className={`progress thin ${f.state === 'done' ? 'done' : f.state === 'downloading' ? 'active' : 'muted'}`}>
                        <span style={{ width: `${f.size ? (f.downloaded / f.size) * 100 : f.state === 'done' ? 100 : 0}%` }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </aside>
    </>
  );
}
