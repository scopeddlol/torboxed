import {
  ArrowDownToLine,
  ArrowUpToLine,
  Cloud,
  Copy,
  FileText,
  FolderOpen,
  Hash,
  HardDrive,
  Info,
  Link2,
  ListX,
  Pause,
  Play,
  RotateCcw,
  Tag as TagIcon,
  Trash2,
} from 'lucide-react';
import type { JobSummary } from '../../shared/types';
import { attempt, useApp } from '../store';
import { api } from '../lib/api';
import { copyText, desktop } from '../lib/desktop';
import type { MenuEntry } from './ContextMenu';

export function openJobFolder(j: JobSummary) {
  if (!desktop) return;
  const target = j.status === 'completed' ? j.contentPath : j.savePath;
  if (j.status === 'completed') void desktop.shell.showItemInFolder(target);
  else void desktop.shell.openPath(target);
}

async function copy(label: string, text: string) {
  if (await copyText(text)) useApp.getState().toast('success', `${label} copied`);
}

export function jobMenu(job: JobSummary): MenuEntry[] {
  const st = useApp.getState();
  const inSelection = st.selected.includes(job.id) && st.selected.length > 1;
  const targets = inSelection ? st.jobs.filter((j) => st.selected.includes(j.id)) : [job];
  const ids = targets.map((j) => j.id);
  const n = targets.length;
  const suffix = n > 1 ? ` (${n})` : '';
  const anyPaused = targets.some((j) => j.paused);
  const anyRunning = targets.some((j) => !j.paused && j.status !== 'completed' && j.status !== 'error');
  const anyError = targets.some((j) => j.status === 'error' || j.warning);
  const act = (a: 'pause' | 'resume' | 'retry' | 'top' | 'bottom') => () => void attempt(() => api.action(ids, a));
  const remove = (o: { fromList: boolean; fromTorbox: boolean; deleteFiles: boolean }, msg: string) => async () => {
    const res = await attempt(() => api.remove(ids, o));
    if (res) st.toast(res.errors.length ? 'warning' : 'success', msg, res.errors.join('\n') || undefined);
  };

  const items: MenuEntry[] = [{ type: 'header', label: n > 1 ? `${n} torrents selected` : job.name }];
  if (n === 1) items.push({ label: 'Details', icon: <Info />, hint: 'Enter', onSelect: () => st.openDrawer(job.id) });
  if (anyRunning) items.push({ label: `Pause${suffix}`, icon: <Pause />, onSelect: act('pause') });
  if (anyPaused) items.push({ label: `Resume${suffix}`, icon: <Play />, onSelect: act('resume') });
  if (anyError) items.push({ label: `Retry${suffix}`, icon: <RotateCcw />, onSelect: act('retry') });
  if (desktop && n === 1) items.push({ label: job.status === 'completed' ? 'Show in folder' : 'Open download folder', icon: <FolderOpen />, onSelect: () => openJobFolder(job) });
  items.push({ type: 'separator' });
  items.push({
    label: 'Tag',
    icon: <TagIcon />,
    submenu: [
      { label: 'No tag', checked: targets.every((j) => !j.tagId), onSelect: () => void attempt(() => api.action(ids, 'tag', null)) },
      ...(st.tags.length ? [{ type: 'separator' } as MenuEntry] : []),
      ...st.tags.map((t) => ({
        label: t.name,
        swatch: t.color,
        checked: targets.every((j) => j.tagId === t.id),
        onSelect: () => void attempt(() => api.action(ids, 'tag', t.id)),
      })),
    ],
  });
  items.push({
    label: 'Queue position',
    icon: <ArrowUpToLine />,
    submenu: [
      { label: 'Move to top', icon: <ArrowUpToLine />, onSelect: act('top') },
      { label: 'Move to bottom', icon: <ArrowDownToLine />, onSelect: act('bottom') },
    ],
  });
  if (n === 1) {
    items.push({
      label: 'Copy',
      icon: <Copy />,
      submenu: [
        { label: 'Name', icon: <FileText />, onSelect: () => void copy('Name', job.name) },
        { label: 'Info hash', icon: <Hash />, disabled: !job.hash, onSelect: () => void copy('Hash', job.hash ?? '') },
        { label: 'Magnet link', icon: <Link2 />, disabled: !job.magnet, onSelect: () => void copy('Magnet link', job.magnet ?? '') },
        { label: 'Save path', icon: <FolderOpen />, onSelect: () => void copy('Path', job.contentPath || job.savePath) },
      ],
    });
  }
  items.push({ type: 'separator' });
  items.push({ label: `Remove from list${suffix}`, icon: <ListX />, onSelect: remove({ fromList: true, fromTorbox: false, deleteFiles: false }, 'Removed from list') });
  items.push({
    label: `Remove from TorBox${suffix}`,
    icon: <Cloud />,
    disabled: targets.every((j) => j.removedFromTorbox || j.torboxId === null),
    onSelect: remove({ fromList: false, fromTorbox: true, deleteFiles: false }, 'Removed from TorBox'),
  });
  items.push({
    label: `Remove everywhere + files${suffix}`,
    icon: <HardDrive />,
    danger: true,
    onSelect: remove({ fromList: true, fromTorbox: true, deleteFiles: true }, 'Removed and deleted'),
  });
  items.push({ label: 'Remove…', icon: <Trash2 />, hint: 'Del', danger: true, onSelect: () => st.askRemove(ids) });
  return items;
}
