import { useState } from 'react';
import { Copy, Folder as FolderIcon, FolderOpen, FolderPlus, Pencil, Plus, Star, Tag as TagIcon, Trash2 } from 'lucide-react';
import type { FolderInfo, Tag } from '../../shared/types';
import { attempt, useApp } from '../store';
import { api } from '../lib/api';
import { copyText, desktop } from '../lib/desktop';
import { formatBytes } from '../lib/format';
import { Empty, Field, Modal } from '../components/ui';
import { FolderPicker } from '../components/Dialogs';
import { useMenuProvider } from '../components/ContextMenu';

const COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#ec4899', '#3b82f6', '#ef4444', '#84cc16', '#f97316', '#14b8a6', '#a855f7', '#64748b'];

function FolderDialog({ folder, onClose }: { folder: FolderInfo | null; onClose: () => void }) {
  const refresh = useApp((s) => s.refreshMeta);
  const [name, setName] = useState(folder?.name ?? '');
  const [path, setPath] = useState(folder?.path ?? '');
  const [picking, setPicking] = useState(false);
  const save = async () => {
    const res = await attempt(() => (folder ? api.updateFolder(folder.id, { name, path }) : api.createFolder({ name, path })), folder ? 'Folder updated' : 'Folder added');
    if (res) {
      await refresh();
      onClose();
    }
  };
  if (picking) return <FolderPicker initial={path || undefined} onClose={() => setPicking(false)} onPick={(p) => (setPath(p), setPicking(false), !name && setName(p.split(/[\\/]/).filter(Boolean).pop() ?? ''))} />;
  return (
    <Modal
      size="narrow"
      title={folder ? 'Edit folder' : 'Add download folder'}
      subtitle="Downloads can be routed here via tags."
      icon={<FolderPlus />}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!name.trim() || !path.trim()}>
            Save
          </button>
        </>
      }
    >
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Movies drive" autoFocus />
      </Field>
      <Field label="Path" hint="An absolute path. It will be created if it doesn't exist.">
        <div className="input-group">
          <input className="input mono" value={path} onChange={(e) => setPath(e.target.value)} placeholder={desktop ? 'D:\\Media\\Movies' : '/downloads/movies'} />
          <button className="btn" onClick={() => setPicking(true)}>
            <FolderOpen />
            Browse
          </button>
        </div>
      </Field>
    </Modal>
  );
}

function TagDialog({ tag, onClose }: { tag: Tag | null; onClose: () => void }) {
  const { folders, settings, tags, refreshMeta } = useApp();
  const [name, setName] = useState(tag?.name ?? '');
  const [color, setColor] = useState(tag?.color ?? COLORS[tags.length % COLORS.length]);
  const [folderId, setFolderId] = useState(tag?.folderId ?? settings?.defaultFolderId ?? folders[0]?.id);
  const [subfolder, setSubfolder] = useState(tag?.subfolder ?? '');
  const folder = folders.find((f) => f.id === folderId);
  const save = async () => {
    const body = { name, color, folderId, subfolder };
    const res = await attempt(() => (tag ? api.updateTag(tag.id, body) : api.createTag(body)), tag ? 'Tag updated' : 'Tag created');
    if (res) {
      await refreshMeta();
      onClose();
    }
  };
  return (
    <Modal
      size="narrow"
      title={tag ? 'Edit tag' : 'Create tag'}
      subtitle="Tags decide where a download is saved. They also show up as categories in Sonarr & Radarr."
      icon={<TagIcon />}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>
            Save
          </button>
        </>
      }
    >
      <Field label="Name" hint="Use the same name as the category in Sonarr/Radarr (e.g. tv-sonarr).">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Movies" autoFocus />
      </Field>
      <Field label="Colour">
        <div className="swatches">
          {COLORS.map((c) => (
            <button key={c} className={`swatch ${color === c ? 'active' : ''}`} style={{ '--c': c } as React.CSSProperties} onClick={() => setColor(c)} aria-label={c} />
          ))}
        </div>
      </Field>
      <div className="field-row">
        <Field label="Folder">
          <select className="select" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sub-folder" aside="optional">
          <input className="input" value={subfolder} onChange={(e) => setSubfolder(e.target.value)} placeholder="e.g. Movies" />
        </Field>
      </div>
      <div className="callout">
        <FolderIcon />
        <div>
          Downloads tagged <b>{name || '…'}</b> will be saved to{' '}
          <span className="mono">
            {folder?.path}
            {subfolder ? `${folder?.path.includes('\\') ? '\\' : '/'}${subfolder}` : ''}
          </span>
        </div>
      </div>
    </Modal>
  );
}

export function Organize() {
  const { folders, tags, jobs, settings, saveSettings, refreshMeta } = useApp();
  const [editFolder, setEditFolder] = useState<FolderInfo | null | 'new'>(null);
  const [editTag, setEditTag] = useState<Tag | null | 'new'>(null);

  const removeFolder = async (f: FolderInfo) => {
    if (await attempt(() => api.deleteFolder(f.id), 'Folder removed')) await refreshMeta();
  };
  const removeTag = async (t: Tag) => {
    if (await attempt(() => api.deleteTag(t.id), 'Tag deleted')) await refreshMeta();
  };

  useMenuProvider('folder', (el) => {
    const f = folders.find((x) => x.id === el.dataset.id);
    if (!f) return null;
    return [
      { type: 'header', label: f.name },
      { label: 'Edit', icon: <Pencil />, onSelect: () => setEditFolder(f) },
      { label: 'Make default', icon: <Star />, disabled: settings?.defaultFolderId === f.id, onSelect: () => void saveSettings({ defaultFolderId: f.id }) },
      ...(desktop ? [{ label: 'Open in Explorer', icon: <FolderOpen />, onSelect: () => void desktop!.shell.openPath(f.path) }] : []),
      { label: 'Copy path', icon: <Copy />, onSelect: () => void copyText(f.path) },
      { type: 'separator' },
      { label: 'Remove folder', icon: <Trash2 />, danger: true, disabled: folders.length <= 1, onSelect: () => void removeFolder(f) },
    ];
  });
  useMenuProvider('tag', (el) => {
    const t = tags.find((x) => x.id === el.dataset.id);
    if (!t) return null;
    return [
      { type: 'header', label: t.name },
      { label: 'Edit', icon: <Pencil />, onSelect: () => setEditTag(t) },
      { label: 'Copy name', icon: <Copy />, onSelect: () => void copyText(t.name) },
      { type: 'separator' },
      { label: 'Delete tag', icon: <Trash2 />, danger: true, onSelect: () => void removeTag(t) },
    ];
  });

  return (
    <div className="page">
      <div className="section-title">
        <div>
          <h2>Download folders</h2>
          <p>Where files end up. Add as many drives or shares as you like.</p>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => setEditFolder('new')}>
          <FolderPlus />
          Add folder
        </button>
      </div>
      <div className="entity-grid">
        {folders.map((f) => {
          const used = f.total && f.free !== null ? 1 - f.free / f.total : 0;
          const isDefault = settings?.defaultFolderId === f.id;
          return (
            <div key={f.id} className="card entity" data-menu="folder" data-id={f.id}>
              <div className="entity-head">
                <span className="entity-icon">
                  <FolderIcon />
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="entity-title">
                    {f.name}
                    {isDefault && <span className="badge tone-accent">Default</span>}
                    {!f.exists && <span className="badge tone-warning">Missing</span>}
                  </div>
                  <div className="entity-sub">{f.path}</div>
                </div>
                <div className="actions">
                  {desktop && (
                    <button className="icon-btn sm" data-tip="Open" onClick={() => void desktop!.shell.openPath(f.path)}>
                      <FolderOpen />
                    </button>
                  )}
                  <button className="icon-btn sm" data-tip="Edit" onClick={() => setEditFolder(f)}>
                    <Pencil />
                  </button>
                </div>
              </div>
              <div className={`disk-bar ${used > 0.95 ? 'crit' : used > 0.85 ? 'warn' : ''}`}>
                <span style={{ width: `${used * 100}%` }} />
              </div>
              <div className="entity-foot">
                <span>{f.free !== null ? `${formatBytes(f.free)} free` : 'Free space unknown'}</span>
                <span>{f.total ? `${formatBytes(f.total)} total` : ''}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="section-title mt-lg">
        <div>
          <h2>Tags</h2>
          <p>Each tag routes downloads to a folder. Sonarr & Radarr see tags as qBittorrent categories.</p>
        </div>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={() => setEditTag('new')}>
          <Plus />
          New tag
        </button>
      </div>
      {tags.length ? (
        <div className="entity-grid">
          {tags.map((t) => {
            const f = folders.find((x) => x.id === t.folderId);
            const count = jobs.filter((j) => j.tagId === t.id).length;
            return (
              <div key={t.id} className="card entity" data-menu="tag" data-id={t.id} style={{ '--c': t.color } as React.CSSProperties}>
                <div className="entity-head">
                  <span className="entity-icon">
                    <TagIcon />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div className="entity-title">{t.name}</div>
                    <div className="entity-sub">
                      {f?.path}
                      {t.subfolder ? `${f?.path.includes('\\') ? '\\' : '/'}${t.subfolder}` : ''}
                    </div>
                  </div>
                  <div className="actions">
                    <button className="icon-btn sm" data-tip="Edit" onClick={() => setEditTag(t)}>
                      <Pencil />
                    </button>
                    <button className="icon-btn sm danger" data-tip="Delete" onClick={() => void removeTag(t)}>
                      <Trash2 />
                    </button>
                  </div>
                </div>
                <div className="entity-foot">
                  <span>
                    <FolderIcon size={12} style={{ verticalAlign: -2 }} /> {f?.name ?? 'Unknown folder'}
                  </span>
                  <span>
                    {count} download{count === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card">
          <Empty
            icon={<TagIcon />}
            title="No tags yet"
            actions={
              <button className="btn btn-primary" onClick={() => setEditTag('new')}>
                <Plus />
                Create a tag
              </button>
            }
          >
            Create tags like “Movies” or “TV” to send downloads to different folders. Tags are created automatically when Sonarr or Radarr use a new category.
          </Empty>
        </div>
      )}

      {editFolder && <FolderDialog folder={editFolder === 'new' ? null : editFolder} onClose={() => setEditFolder(null)} />}
      {editTag && <TagDialog tag={editTag === 'new' ? null : editTag} onClose={() => setEditTag(null)} />}
    </div>
  );
}
