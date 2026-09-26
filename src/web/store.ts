import { create } from 'zustand';
import type { FolderInfo, JobSummary, NotifyEvent, Settings, SystemInfo, Tag, Tick } from '../shared/types';
import { api } from './lib/api';
import { applyTheme } from './lib/theme';
import { isDesktop } from './lib/desktop';

export type Page = 'downloads' | 'cloud' | 'analytics' | 'organize' | 'settings';
export const PAGES: Page[] = ['downloads', 'cloud', 'analytics', 'organize', 'settings'];

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info' | 'warning';
  title: string;
  body?: string;
}

export interface AddPreset {
  links?: string;
  files?: File[];
}

interface State {
  ready: boolean;
  connected: boolean;
  bootError: string | null;
  settings: Settings | null;
  folders: FolderInfo[];
  tags: Tag[];
  system: SystemInfo | null;
  tick: Tick | null;
  jobs: JobSummary[];
  speedHistory: number[];
  page: Page;
  section: string | null;
  addOpen: boolean;
  addPreset: AddPreset | null;
  removeIds: string[] | null;
  drawerId: string | null;
  selected: string[];
  toasts: Toast[];
  search: string;

  init(): Promise<void>;
  refreshMeta(): Promise<void>;
  go(page: Page, section?: string | null): void;
  saveSettings(patch: Partial<Settings>): Promise<void>;
  toast(kind: Toast['kind'], title: string, body?: string): void;
  dismissToast(id: number): void;
  openAdd(preset?: AddPreset): void;
  closeAdd(): void;
  askRemove(ids: string[]): void;
  closeRemove(): void;
  openDrawer(id: string | null): void;
  setSelected(ids: string[]): void;
  toggleSelected(id: string, additive?: boolean): void;
  control(patch: { globalPaused?: boolean; slowMode?: boolean }): Promise<void>;
  setSearch(s: string): void;
}

let toastId = 1;
let es: EventSource | null = null;

function pageFromHash(): { page: Page; section: string | null } {
  const [, p, s] = location.hash.split('/');
  const page = (PAGES as string[]).includes(p) ? (p as Page) : 'downloads';
  return { page, section: s ?? null };
}

function themeOf(s: Settings) {
  applyTheme({ theme: s.theme, accent: s.accent, density: s.density, reduceMotion: s.reduceMotion });
}

function browserNotify(n: NotifyEvent, s: Settings | null) {
  if (isDesktop || !s?.browserNotifications || typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted' || !document.hidden) return;
  try {
    new Notification(n.title, { body: n.body, icon: './icon-192.png' });
  } catch {
    /* ignore */
  }
}

export const useApp = create<State>((set, get) => ({
  ready: false,
  connected: false,
  bootError: null,
  settings: null,
  folders: [],
  tags: [],
  system: null,
  tick: null,
  jobs: [],
  speedHistory: [],
  ...pageFromHash(),
  addOpen: false,
  addPreset: null,
  removeIds: null,
  drawerId: null,
  selected: [],
  toasts: [],
  search: '',

  async init() {
    window.addEventListener('hashchange', () => set(pageFromHash()));
    for (let attempt = 0; ; attempt++) {
      try {
        const b = await api.bootstrap();
        themeOf(b.settings);
        set({ settings: b.settings, folders: b.folders, tags: b.tags, system: b.system, ready: true, bootError: null });
        break;
      } catch (e) {
        set({ bootError: (e as Error).message });
        await new Promise((r) => setTimeout(r, Math.min(5000, 500 * (attempt + 1))));
      }
    }
    const connect = () => {
      es?.close();
      es = new EventSource('api/events');
      es.addEventListener('open', () => set({ connected: true }));
      es.addEventListener('error', () => set({ connected: false }));
      es.addEventListener('hello', (e) => {
        const d = JSON.parse((e as MessageEvent).data) as { speedHistory: number[] };
        set({ speedHistory: d.speedHistory.slice(-180) });
      });
      es.addEventListener('tick', (e) => {
        const t = JSON.parse((e as MessageEvent).data) as Tick;
        const hist = get().speedHistory;
        const next = hist.length >= 180 ? hist.slice(hist.length - 179) : hist.slice();
        next.push(t.speed);
        const s = get().settings;
        const patch: Partial<State> = { tick: t, jobs: t.jobs, speedHistory: next, connected: true };
        if (s && (s.globalPaused !== t.globalPaused || s.slowMode !== t.slowMode)) {
          patch.settings = { ...s, globalPaused: t.globalPaused, slowMode: t.slowMode };
        }
        const ids = new Set(t.jobs.map((j) => j.id));
        const sel = get().selected;
        if (sel.some((id) => !ids.has(id))) patch.selected = sel.filter((id) => ids.has(id));
        set(patch);
      });
      es.addEventListener('notify', (e) => {
        const n = JSON.parse((e as MessageEvent).data) as NotifyEvent;
        get().toast(n.kind === 'completed' ? 'success' : n.kind === 'error' ? 'error' : 'info', n.title, n.body);
        browserNotify(n, get().settings);
      });
      es.addEventListener('meta', () => void get().refreshMeta());
    };
    connect();
  },

  async refreshMeta() {
    const b = await api.bootstrap();
    themeOf(b.settings);
    set({ settings: b.settings, folders: b.folders, tags: b.tags, system: b.system });
  },

  go(page, section = null) {
    const hash = `#/${page}${section ? `/${section}` : ''}`;
    if (location.hash !== hash) location.hash = hash;
    set({ page, section });
  },

  async saveSettings(patch) {
    const prev = get().settings;
    if (!prev) return;
    const optimistic = { ...prev, ...patch } as Settings;
    set({ settings: optimistic });
    if ('theme' in patch || 'accent' in patch || 'density' in patch || 'reduceMotion' in patch) themeOf(optimistic);
    try {
      const saved = await api.saveSettings(patch);
      set({ settings: saved });
    } catch (e) {
      set({ settings: prev });
      themeOf(prev);
      get().toast('error', 'Could not save settings', (e as Error).message);
    }
  },

  toast(kind, title, body) {
    const id = toastId++;
    set({ toasts: [...get().toasts.slice(-4), { id, kind, title, body }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 4500);
  },
  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },
  openAdd(preset) {
    set({ addOpen: true, addPreset: preset ?? null });
  },
  closeAdd() {
    set({ addOpen: false, addPreset: null });
  },
  askRemove(ids) {
    if (ids.length) set({ removeIds: ids });
  },
  closeRemove() {
    set({ removeIds: null });
  },
  openDrawer(id) {
    set({ drawerId: id });
  },
  setSelected(ids) {
    set({ selected: ids });
  },
  toggleSelected(id, additive = true) {
    const sel = get().selected;
    if (!additive) return set({ selected: sel.length === 1 && sel[0] === id ? [] : [id] });
    set({ selected: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id] });
  },
  async control(patch) {
    try {
      const t = await api.control(patch);
      const s = get().settings;
      set({ tick: t, jobs: t.jobs, settings: s ? { ...s, globalPaused: t.globalPaused, slowMode: t.slowMode } : s });
    } catch (e) {
      get().toast('error', 'Action failed', (e as Error).message);
    }
  },
  setSearch(s) {
    set({ search: s });
  },
}));

/** Run an API call and surface failures as a toast. */
export async function attempt<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
  try {
    const out = await fn();
    if (success) useApp.getState().toast('success', success);
    return out;
  } catch (e) {
    useApp.getState().toast('error', 'Something went wrong', (e as Error).message);
    return undefined;
  }
}
