import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, FileUp, Link2, Loader2, Magnet, Plus, Upload, X } from 'lucide-react';
import { useApp } from '../store';
import { api } from '../lib/api';
import { Field, Modal, Switch } from './ui';
import { formatBytes } from '../lib/format';

export function parseLinks(text: string) {
  const lines = text
    .split(/[\r\n]+|\s(?=magnet:\?)|\s(?=https?:\/\/)/i)
    .map((l) => l.trim())
    .filter(Boolean);
  const magnets = lines.filter((l) => /^magnet:\?/i.test(l)).length;
  const urls = lines.filter((l) => /^https?:\/\//i.test(l)).length;
  return { lines, magnets, urls, invalid: lines.length - magnets - urls };
}

export function AddModal() {
  const { closeAdd, addPreset, tags, folders, settings, toast } = useApp();
  const [links, setLinks] = useState(addPreset?.links ?? '');
  const [files, setFiles] = useState<File[]>(addPreset?.files ?? []);
  const [tagId, setTagId] = useState<string>('');
  const [folderId, setFolderId] = useState<string>('');
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [errors, setErrors] = useState<{ input: string; error: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseLinks(links), [links]);
  const total = parsed.magnets + parsed.urls + files.length;
  const tag = tags.find((t) => t.id === tagId);
  const destination = folderId
    ? folders.find((f) => f.id === folderId)?.path
    : tag
      ? `${folders.find((f) => f.id === tag.folderId)?.path ?? ''}${tag.subfolder ? `/${tag.subfolder}` : ''}`
      : folders.find((f) => f.id === settings?.defaultFolderId)?.path;

  useEffect(() => {
    if (addPreset?.files?.length) setFiles(addPreset.files);
    if (addPreset?.links) setLinks(addPreset.links);
  }, [addPreset]);

  const addFiles = (list: FileList | File[]) => {
    const next = [...list].filter((f) => /\.torrent$/i.test(f.name) || f.type === 'application/x-bittorrent');
    if (next.length < [...list].length) toast('warning', 'Some files were skipped', 'Only .torrent files can be added.');
    setFiles((cur) => {
      const names = new Set(cur.map((f) => f.name + f.size));
      return [...cur, ...next.filter((f) => !names.has(f.name + f.size))];
    });
  };

  const submit = async () => {
    if (!total || busy) return;
    setBusy(true);
    setErrors([]);
    try {
      const form = new FormData();
      form.set('links', links);
      for (const f of files) form.append('torrents', f, f.name);
      if (tagId) form.set('tagId', tagId);
      if (folderId) form.set('folderId', folderId);
      if (paused) form.set('paused', 'true');
      const res = await api.add(form);
      const n = res.added.length;
      if (n) toast('success', `Added ${n} torrent${n === 1 ? '' : 's'}`, n === 1 ? res.added[0].name : 'Sending to TorBox…');
      if (res.duplicates.length) toast('info', `${res.duplicates.length} already in your list`, res.duplicates.slice(0, 3).join(', '));
      if (res.errors.length) {
        setErrors(res.errors);
        const failed = new Set(res.errors.map((e) => e.input));
        setFiles((cur) => cur.filter((f) => failed.has(f.name)));
        setLinks(parsed.lines.filter((l) => [...failed].some((x) => l.startsWith(x.replace(/…$/, '')))).join('\n'));
      } else closeAdd();
    } catch (e) {
      toast('error', 'Could not add torrents', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Add torrents"
      subtitle="Magnet links, .torrent files or URLs — one or hundreds at a time."
      icon={<Plus />}
      onClose={closeAdd}
      footer={
        <>
          <span className="hint">
            {total ? (
              <>
                <b style={{ color: 'var(--text)' }}>{total}</b> item{total === 1 ? '' : 's'} ready
                {parsed.invalid > 0 && <span style={{ color: 'var(--warning)' }}> · {parsed.invalid} unrecognised line(s)</span>}
              </>
            ) : (
              <>
                Tip: press <span className="kbd">Ctrl</span> + <span className="kbd">V</span> anywhere to paste magnets
              </>
            )}
          </span>
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={closeAdd}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!total || busy} onClick={submit}>
            {busy ? <Loader2 className="spin" /> : <Plus />}
            {busy ? 'Adding…' : `Add ${total || ''}`}
          </button>
        </>
      }
    >
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <div className="dz-icon">
          <Upload />
        </div>
        <strong>Drop .torrent files here</strong>
        <span>or click to browse — you can pick many at once</span>
        <input
          ref={inputRef}
          type="file"
          accept=".torrent,application/x-bittorrent"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {files.length > 0 && (
        <div className="file-chips">
          {files.map((f) => (
            <span key={f.name + f.size} className="file-chip">
              <FileUp size={13} />
              <span>{f.name}</span>
              <small className="muted">{formatBytes(f.size)}</small>
              <button className="icon-btn sm" onClick={() => setFiles((cur) => cur.filter((x) => x !== f))} aria-label="Remove">
                <X />
              </button>
            </span>
          ))}
        </div>
      )}

      <Field
        label={
          <>
            <Magnet size={14} /> Magnet links & URLs
          </>
        }
        aside={
          parsed.lines.length > 0 && (
            <span>
              {parsed.magnets > 0 && `${parsed.magnets} magnet${parsed.magnets === 1 ? '' : 's'}`}
              {parsed.magnets > 0 && parsed.urls > 0 && ' · '}
              {parsed.urls > 0 && (
                <>
                  <Link2 size={11} /> {parsed.urls} URL{parsed.urls === 1 ? '' : 's'}
                </>
              )}
            </span>
          )
        }
      >
        <textarea
          className="textarea"
          placeholder={'magnet:?xt=urn:btih:…\nmagnet:?xt=urn:btih:…\nhttps://example.com/file.torrent'}
          value={links}
          onChange={(e) => setLinks(e.target.value)}
          autoFocus={!addPreset?.files?.length}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit();
          }}
        />
      </Field>

      <div className="field-row">
        <Field label="Tag" hint={tag ? `Routes to ${destination}` : 'Tags send downloads to their own folder'}>
          <select className="select" value={tagId} onChange={(e) => setTagId(e.target.value)}>
            <option value="">No tag</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Download folder" hint={!tag ? destination : undefined}>
          <select className="select" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            <option value="">{tag ? `Tag's folder` : 'Default folder'}</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <div className="setting-title" style={{ fontSize: 13.5 }}>
            Add paused
          </div>
          <div className="field-hint">Sends to TorBox but waits for you before downloading.</div>
        </div>
        <Switch on={paused} onChange={setPaused} label="Add paused" />
      </div>

      {errors.length > 0 && (
        <div className="callout tone-danger">
          <AlertTriangle />
          <div>
            <b>
              {errors.length} item{errors.length === 1 ? '' : 's'} couldn't be added
            </b>
            {errors.slice(0, 6).map((e, i) => (
              <div key={i} className="dim" style={{ fontSize: 12.5, marginTop: 4 }}>
                <span className="mono">{e.input}</span> — {e.error}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
