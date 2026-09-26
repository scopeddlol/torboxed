import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check as CheckIcon, Cloud as CloudIcon, CloudOff, Copy, Download, HardDrive, KeyRound, Loader2, MoreHorizontal, RefreshCw, Trash2, Zap } from 'lucide-react';
import type { CloudItem } from '../../shared/types';
import { attempt, useApp } from '../store';
import { api } from '../lib/api';
import { copyText } from '../lib/desktop';
import { formatBytes, formatSpeed, timeAgo } from '../lib/format';
import { Empty } from '../components/ui';
import { openMenuAt, useMenuProvider, type MenuEntry } from '../components/ContextMenu';

export function Cloud() {
  const { settings, tags, search, go, toast } = useApp();
  const [items, setItems] = useState<CloudItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      setItems(await api.cloud(force));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!settings?.torboxApiKey) return;
    void load(true);
    const t = setInterval(() => void load(), 10_000);
    return () => clearInterval(t);
  }, [settings?.torboxApiKey, load]);

  const download = async (item: CloudItem, tagId: string | null) => {
    setBusy(item.id);
    const res = await attempt(() => api.cloudDownload(item.id, tagId));
    setBusy(null);
    if (res) {
      toast('success', 'Downloading from TorBox', item.name);
      void load();
    }
  };
  const remove = async (item: CloudItem) => {
    setBusy(item.id);
    const res = await attempt(() => api.cloudDelete(item.id));
    setBusy(null);
    if (res) {
      toast('success', 'Deleted from TorBox', item.name);
      setItems((cur) => cur?.filter((x) => x.id !== item.id) ?? null);
    }
  };

  const menuFor = (item: CloudItem): MenuEntry[] => [
    { type: 'header', label: item.name },
    {
      label: item.linkedJobId ? 'Already in Torboxed' : 'Download',
      icon: <Download />,
      disabled: !item.ready || !!item.linkedJobId,
      onSelect: () => void download(item, null),
    },
    {
      label: 'Download with tag',
      icon: <HardDrive />,
      disabled: !item.ready || !!item.linkedJobId || !tags.length,
      submenu: tags.map((t) => ({ label: t.name, swatch: t.color, onSelect: () => void download(item, t.id) })),
    },
    { type: 'separator' },
    { label: 'Copy name', icon: <Copy />, onSelect: () => void copyText(item.name) },
    { label: 'Copy info hash', icon: <Copy />, disabled: !item.hash, onSelect: () => void copyText(item.hash) },
    { type: 'separator' },
    { label: 'Delete from TorBox', icon: <Trash2 />, danger: true, onSelect: () => void remove(item) },
  ];

  useMenuProvider('cloud', (el) => {
    const item = items?.find((i) => String(i.id) === el.dataset.id);
    return item ? menuFor(item) : null;
  });

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (items ?? []).filter((i) => !q || i.name.toLowerCase().includes(q) || i.hash.includes(q));
  }, [items, search]);
  const totalSize = (items ?? []).reduce((a, i) => a + i.size, 0);

  if (!settings?.torboxApiKey) {
    return (
      <div className="page">
        <div className="card">
          <Empty
            icon={<KeyRound />}
            title="Connect TorBox first"
            actions={
              <button className="btn btn-primary" onClick={() => go('settings', 'torbox')}>
                Add API key
              </button>
            }
          >
            Your TorBox cloud library will show up here once your API key is set.
          </Empty>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="toolbar">
        <span className="badge tone-accent">
          <CloudIcon /> {items?.length ?? 0} torrents
        </span>
        <span className="badge tone-muted">{formatBytes(totalSize)} stored</span>
        <span className="badge tone-success">{items?.filter((i) => i.ready).length ?? 0} ready to download</span>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => void load(true)} disabled={loading}>
          <RefreshCw className={loading ? 'spin' : ''} />
          Refresh
        </button>
      </div>

      {error && !items ? (
        <div className="card">
          <Empty icon={<CloudOff />} title="Could not load your TorBox library">
            {error}
          </Empty>
        </div>
      ) : !items ? (
        <div className="card">
          <Empty icon={<Loader2 className="spin" />} title="Loading your cloud…" />
        </div>
      ) : visible.length === 0 ? (
        <div className="card">
          <Empty icon={<CloudIcon />} title={items.length ? 'Nothing matches your search' : 'Your TorBox cloud is empty'}>
            {items.length ? 'Try a different search.' : 'Torrents you add to TorBox (here or on torbox.app) appear in this list.'}
          </Empty>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th className="num">Size</th>
                <th className="num">Added</th>
                <th style={{ width: 150 }} />
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id} data-menu="cloud" data-id={item.id}>
                  <td className="name-cell">
                    <div title={item.name}>{item.name}</div>
                    <small>
                      {item.files.length} file{item.files.length === 1 ? '' : 's'}
                      {item.hash && <> · <span className="mono">{item.hash.slice(0, 12)}…</span></>}
                    </small>
                  </td>
                  <td>
                    {item.ready ? (
                      <span className="badge tone-success">
                        <Zap /> Ready
                      </span>
                    ) : (
                      <div style={{ minWidth: 140 }}>
                        <span className="badge tone-info">
                          {item.state || 'downloading'} · {Math.round(item.progress * 100)}%
                        </span>
                        {item.speed > 0 && <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>{formatSpeed(item.speed)} · {item.seeds} seeds</div>}
                      </div>
                    )}
                  </td>
                  <td className="num">{formatBytes(item.size)}</td>
                  <td className="num muted">{item.createdAt ? timeAgo(Date.parse(item.createdAt)) : '—'}</td>
                  <td className="num">
                    <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
                      {item.linkedJobId ? (
                        <span className="badge tone-accent">
                          <CheckIcon /> In Torboxed
                        </span>
                      ) : (
                        <button className="btn btn-sm" disabled={!item.ready || busy === item.id} onClick={() => void download(item, null)}>
                          {busy === item.id ? <Loader2 className="spin" /> : <Download />}
                          Download
                        </button>
                      )}
                      <button className="icon-btn" onClick={(e) => openMenuAt(e.currentTarget, menuFor(item))} aria-label="More">
                        <MoreHorizontal />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
