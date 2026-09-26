import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronUp,
  Cloud,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Info,
  List,
  Loader2,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import type { BrowseResult } from '../../shared/types';
import { attempt, useApp } from '../store';
import { api } from '../lib/api';
import { desktop } from '../lib/desktop';
import { Check, Modal, X } from './ui';

/* ─────────── Remove dialog ─────────── */

export function RemoveDialog() {
  const { removeIds, closeRemove, jobs, settings, saveSettings, toast } = useApp();
  const [fromList, setFromList] = useState(true);
  const [fromTorbox, setFromTorbox] = useState(settings?.removeDefaults.fromTorbox ?? true);
  const [deleteFiles, setDeleteFiles] = useState(settings?.removeDefaults.deleteFiles ?? false);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!removeIds) return null;
  const targets = jobs.filter((j) => removeIds.includes(j.id));
  const n = targets.length;
  const nothing = !fromList && !fromTorbox && !deleteFiles;

  const go = async () => {
    setBusy(true);
    if (remember) void saveSettings({ removeDefaults: { fromTorbox, deleteFiles } });
    const res = await attempt(() => api.remove(removeIds, { fromList, fromTorbox, deleteFiles }));
    setBusy(false);
    if (res) {
      if (res.errors.length) toast('warning', 'Some items could not be removed from TorBox', res.errors.join('\n'));
      else toast('success', `Removed ${n} torrent${n === 1 ? '' : 's'}`);
      useApp.getState().setSelected([]);
      closeRemove();
    }
  };

  const Opt = ({ on, set, icon, title, sub, danger }: { on: boolean; set: (v: boolean) => void; icon: React.ReactNode; title: string; sub: string; danger?: boolean }) => (
    <button className={`option ${on ? 'on' : ''} ${danger ? 'danger' : ''}`} onClick={() => set(!on)}>
      <Check on={on} onChange={set} />
      <div style={{ flex: 1 }}>
        <div className="option-title row" style={{ gap: 8 }}>
          {icon}
          {title}
        </div>
        <div className="option-sub">{sub}</div>
      </div>
    </button>
  );

  return (
    <Modal
      size="narrow"
      title={n === 1 ? 'Remove torrent?' : `Remove ${n} torrents?`}
      subtitle={n === 1 ? targets[0]?.name : 'Choose what should be removed.'}
      icon={<Trash2 />}
      tone="danger"
      onClose={closeRemove}
      footer={
        <>
          <label className="row hint" style={{ cursor: 'pointer', gap: 8 }}>
            <Check on={remember} onChange={setRemember} label="Remember" />
            Remember choice
          </label>
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={closeRemove}>
            Cancel
          </button>
          <button className="btn btn-danger" disabled={busy || nothing} onClick={go}>
            {busy ? <Loader2 className="spin" /> : <Trash2 />}
            Remove
          </button>
        </>
      }
    >
      <div className="option-list">
        <Opt on={fromList} set={setFromList} icon={<List size={15} />} title="Remove from Torboxed" sub="Take it off your downloads list." />
        <Opt on={fromTorbox} set={setFromTorbox} icon={<Cloud size={15} />} title="Delete from TorBox" sub="Frees up a slot in your TorBox account." />
        <Opt
          on={deleteFiles}
          set={setDeleteFiles}
          danger
          icon={<HardDrive size={15} />}
          title="Delete downloaded files"
          sub="Permanently removes the files from disk."
        />
      </div>
    </Modal>
  );
}

/* ─────────── Toasts ─────────── */

const TOAST_ICON = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
const TOAST_TONE = { success: 'success', error: 'danger', info: 'info', warning: 'warning' };

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => {
        const Icon = TOAST_ICON[t.kind];
        return (
          <div key={t.id} className={`toast tone-${TOAST_TONE[t.kind]}`}>
            <span className="toast-icon">
              <Icon />
            </span>
            <div style={{ minWidth: 0 }}>
              <div className="toast-title">{t.title}</div>
              {t.body && <div className="toast-body">{t.body}</div>}
            </div>
            <button className="icon-btn sm" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────── Global drag & drop ─────────── */

export function DropOverlay() {
  const [show, setShow] = useState(false);
  const openAdd = useApp((s) => s.openAdd);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e) || useApp.getState().addOpen) return;
      depth++;
      setShow(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setShow(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setShow(false);
      if (useApp.getState().addOpen) return;
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => /\.torrent$/i.test(f.name));
      const text = e.dataTransfer?.getData('text/plain') ?? '';
      if (files.length || /magnet:\?/i.test(text)) openAdd({ files, links: text });
      else useApp.getState().toast('warning', 'No .torrent files found', 'Drop .torrent files or magnet links.');
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [openAdd]);
  if (!show) return null;
  return (
    <div className="drop-overlay">
      <div>
        <div className="dropzone" style={{ border: 0, background: 'none', padding: 0 }}>
          <div className="dz-icon" style={{ width: 72, height: 72, borderRadius: 22 }}>
            <Upload size={32} />
          </div>
        </div>
        <h2>Drop to add torrents</h2>
        <p>They'll be sent to TorBox and downloaded automatically.</p>
      </div>
    </div>
  );
}

/* ─────────── Folder picker ─────────── */

export function FolderPicker({ initial, onPick, onClose }: { initial?: string; onPick: (p: string) => void; onClose: () => void }) {
  const [data, setData] = useState<BrowseResult | null>(null);
  const [path, setPath] = useState(initial ?? '');
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState('');

  const load = async (p?: string) => {
    setLoading(true);
    const res = await attempt(() => api.browse(p));
    setLoading(false);
    if (res) {
      setData(res);
      setPath(res.path);
    }
  };
  useEffect(() => {
    void load(initial);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sep = data?.path.includes('\\') ? '\\' : '/';
  const create = async () => {
    if (!newName.trim() || !data) return;
    const target = data.path.replace(/[\\/]$/, '') + sep + newName.trim();
    const res = await attempt(() => api.mkdir(target));
    if (res) {
      setNewName('');
      await load(res.path);
    }
  };

  return (
    <Modal
      title="Choose a folder"
      subtitle="Browse the machine Torboxed is running on."
      icon={<FolderOpen />}
      onClose={onClose}
      footer={
        <>
          {desktop && (
            <button
              className="btn btn-ghost"
              onClick={async () => {
                const p = await desktop!.dialog.pickFolder(path);
                if (p) onPick(p);
              }}
            >
              <FolderOpen />
              Use Explorer…
            </button>
          )}
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!path} onClick={() => onPick(path)}>
            Select this folder
          </button>
        </>
      }
    >
      <div className="browser">
        <div className="browser-path">
          <button className="icon-btn" disabled={!data?.parent} onClick={() => data?.parent && load(data.parent)} data-tip="Up one level">
            <ChevronUp />
          </button>
          <input
            className="input mono"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load(path)}
            style={{ height: 34 }}
          />
          {data && data.roots.length > 1 && (
            <select className="select" style={{ width: 90, height: 34 }} value="" onChange={(e) => e.target.value && load(e.target.value)}>
              <option value="">Drive</option>
              {data.roots.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="browser-list">
          {loading && !data && (
            <div className="empty" style={{ padding: 40 }}>
              <Loader2 className="spin" />
            </div>
          )}
          {data?.entries.length === 0 && <div className="muted" style={{ padding: 16, fontSize: 13 }}>No sub-folders here.</div>}
          {data?.entries.map((e) => (
            <button key={e.path} className="browser-item" onDoubleClick={() => load(e.path)} onClick={() => setPath(e.path)}>
              <Folder />
              <span className="truncate">{e.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="input-group">
        <input className="input" placeholder="New folder name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
        <button className="btn" onClick={create} disabled={!newName.trim()}>
          <FolderPlus />
          Create
        </button>
      </div>
      <div className="field-hint">Double-click to open a folder. Docker users: pick a path inside a mounted volume (e.g. /downloads).</div>
    </Modal>
  );
}
