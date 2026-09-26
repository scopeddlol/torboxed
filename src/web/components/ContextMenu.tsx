import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronRight,
  ClipboardPaste,
  Cloud,
  Copy,
  Download,
  ExternalLink,
  FolderTree,
  Link2,
  Magnet,
  Maximize2,
  Minus,
  Palette,
  Pause,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  Scissors,
  Settings as SettingsIcon,
  TextSelect,
  Trash2,
  Turtle,
  Undo2,
} from 'lucide-react';
import { THEMES } from '../../shared/themes';
import { useApp, type Page } from '../store';
import { canReadClipboard, copyText, desktop, isDesktop, readClipboard } from '../lib/desktop';

export type MenuEntry =
  | {
      type?: 'item';
      label: string;
      icon?: ReactNode;
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      swatch?: string;
      onSelect?: () => void;
      submenu?: MenuEntry[];
    }
  | { type: 'separator' }
  | { type: 'header'; label: string };

type Provider = (el: HTMLElement, e: MouseEvent) => MenuEntry[] | null;

const providers = new Map<string, Provider>();
let opener: ((x: number, y: number, items: MenuEntry[]) => void) | null = null;

/** Register a context-menu builder for elements marked `data-menu="<kind>"`. */
export function useMenuProvider(kind: string, fn: Provider) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const p: Provider = (el, e) => ref.current(el, e);
    providers.set(kind, p);
    return () => {
      if (providers.get(kind) === p) providers.delete(kind);
    };
  }, [kind]);
}

/** Open a menu programmatically (e.g. from a "more" button). */
export function openMenu(x: number, y: number, items: MenuEntry[]) {
  opener?.(x, y, items);
}

export function openMenuAt(el: HTMLElement, items: MenuEntry[]) {
  const r = el.getBoundingClientRect();
  openMenu(r.right - 4, r.bottom + 6, items);
}

const sep: MenuEntry = { type: 'separator' };

function editMenu(el: HTMLInputElement | HTMLTextAreaElement | HTMLElement): MenuEntry[] {
  const input = el as HTMLInputElement;
  const hasSel =
    'selectionStart' in input && input.selectionStart !== null
      ? input.selectionStart !== input.selectionEnd
      : !!window.getSelection()?.toString();
  const readOnly = input.readOnly || input.disabled;
  const exec = (cmd: string) => () => {
    el.focus();
    document.execCommand(cmd);
  };
  return [
    { label: 'Undo', icon: <Undo2 />, hint: 'Ctrl+Z', disabled: readOnly, onSelect: exec('undo') },
    { label: 'Redo', icon: <Redo2 />, hint: 'Ctrl+Y', disabled: readOnly, onSelect: exec('redo') },
    sep,
    { label: 'Cut', icon: <Scissors />, hint: 'Ctrl+X', disabled: !hasSel || readOnly, onSelect: exec('cut') },
    {
      label: 'Copy',
      icon: <Copy />,
      hint: 'Ctrl+C',
      disabled: !hasSel,
      onSelect: () => {
        const text =
          'selectionStart' in input && input.selectionStart !== null
            ? input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)
            : (window.getSelection()?.toString() ?? '');
        void copyText(text);
      },
    },
    {
      label: 'Paste',
      icon: <ClipboardPaste />,
      hint: 'Ctrl+V',
      disabled: readOnly || !canReadClipboard,
      onSelect: async () => {
        const text = await readClipboard();
        if (text === null) return;
        el.focus();
        document.execCommand('insertText', false, text);
      },
    },
    { label: 'Delete', icon: <Trash2 />, disabled: !hasSel || readOnly, onSelect: exec('delete') },
    sep,
    {
      label: 'Select all',
      icon: <TextSelect />,
      hint: 'Ctrl+A',
      onSelect: () => {
        el.focus();
        if ('select' in input && typeof input.select === 'function') input.select();
        else document.execCommand('selectAll');
      },
    },
  ];
}

const PAGE_ITEMS: { page: Page; label: string; icon: ReactNode }[] = [
  { page: 'downloads', label: 'Downloads', icon: <Download /> },
  { page: 'cloud', label: 'TorBox Cloud', icon: <Cloud /> },
  { page: 'analytics', label: 'Analytics', icon: <BarChart3 /> },
  { page: 'organize', label: 'Tags & Folders', icon: <FolderTree /> },
  { page: 'settings', label: 'Settings', icon: <SettingsIcon /> },
];

export function globalMenu(): MenuEntry[] {
  const st = useApp.getState();
  const s = st.settings;
  const paused = !!s?.globalPaused;
  return [
    { label: 'Add torrents…', icon: <Plus />, hint: 'Ctrl+N', onSelect: () => st.openAdd() },
    {
      label: 'Paste magnet from clipboard',
      icon: <Magnet />,
      disabled: !canReadClipboard,
      onSelect: async () => {
        const text = await readClipboard();
        if (text && /magnet:\?|https?:\/\//i.test(text)) st.openAdd({ links: text });
        else st.toast('info', 'Nothing to add', 'The clipboard does not contain a magnet link or URL.');
      },
    },
    sep,
    {
      label: paused ? 'Resume all downloads' : 'Pause all downloads',
      icon: paused ? <Play /> : <Pause />,
      onSelect: () => void st.control({ globalPaused: !paused }),
    },
    { label: 'Slow mode', icon: <Turtle />, checked: !!s?.slowMode, onSelect: () => void st.control({ slowMode: !s?.slowMode }) },
    sep,
    {
      label: 'Go to',
      icon: <ArrowRight />,
      submenu: PAGE_ITEMS.map((p) => ({ label: p.label, icon: p.icon, checked: st.page === p.page, onSelect: () => st.go(p.page) })),
    },
    {
      label: 'Theme',
      icon: <Palette />,
      submenu: THEMES.map((t) => ({
        label: t.name,
        swatch: t.colors.accent,
        checked: s?.theme === t.id,
        onSelect: () => void st.saveSettings({ theme: t.id }),
      })),
    },
    sep,
    {
      label: 'Reload',
      icon: <RefreshCw />,
      hint: 'Ctrl+R',
      onSelect: () => (desktop ? desktop.app.reload() : location.reload()),
    },
    ...(desktop
      ? ([
          { label: 'Minimize', icon: <Minus />, onSelect: () => desktop!.window.minimize() },
          { label: 'Toggle full screen', icon: <Maximize2 />, hint: 'F11', onSelect: () => desktop!.window.toggleFullScreen() },
        ] as MenuEntry[])
      : []),
  ];
}

function buildMenu(e: MouseEvent): MenuEntry[] | null {
  const target = e.target as HTMLElement;
  const editable = target.closest('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, [contenteditable="true"]') as HTMLElement | null;
  if (editable) return editMenu(editable);

  const items: MenuEntry[] = [];
  const selection = window.getSelection()?.toString().trim() ?? '';
  if (selection) {
    items.push({ label: 'Copy', icon: <Copy />, hint: 'Ctrl+C', onSelect: () => void copyText(selection) });
    if (/^magnet:\?/i.test(selection)) {
      items.push({ label: 'Add this magnet', icon: <Magnet />, onSelect: () => useApp.getState().openAdd({ links: selection }) });
    }
    items.push(sep);
  }
  const link = target.closest('a[href]') as HTMLAnchorElement | null;
  if (link) {
    items.push(
      {
        label: 'Open link',
        icon: <ExternalLink />,
        onSelect: () => (desktop ? void desktop.shell.openExternal(link.href) : window.open(link.href, '_blank', 'noopener')),
      },
      { label: 'Copy link address', icon: <Link2 />, onSelect: () => void copyText(link.href) },
      sep,
    );
  }
  const host = target.closest('[data-menu]') as HTMLElement | null;
  const provider = host ? providers.get(host.dataset.menu!) : undefined;
  const provided = provider && host ? provider(host, e) : null;
  if (provided && provided.length) items.push(...provided);
  else items.push(...globalMenu());
  while (items.length && (items[items.length - 1] as { type?: string }).type === 'separator') items.pop();
  return items;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuEntry[];
  key: number;
}

function MenuPanel({
  x,
  y,
  items,
  onClose,
  depth = 0,
  parentWidth = 0,
  onBack,
}: {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose: () => void;
  depth?: number;
  parentWidth?: number;
  onBack?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });
  const [active, setActive] = useState(-1);
  const [sub, setSub] = useState<{ index: number; x: number; y: number } | null>(null);
  const hoverTimer = useRef<number>(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + r.width > vw - 8) left = depth ? x - r.width - parentWidth + 8 : vw - r.width - 8;
    if (top + r.height > vh - 8) top = Math.max(8, vh - r.height - 8);
    setPos({ left: Math.max(8, left), top, ready: true });
  }, [x, y, depth, parentWidth]);

  const selectable = items.map((it, i) => ({ it, i })).filter(({ it }) => !it.type || it.type === 'item');

  const openSub = (i: number) => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-idx="${i}"]`);
    const box = ref.current?.getBoundingClientRect();
    if (!el || !box) return;
    const r = el.getBoundingClientRect();
    setSub({ index: i, x: box.right - 4, y: r.top - 6 });
  };

  const activate = (i: number) => {
    const it = items[i];
    if (!it || it.type === 'separator' || it.type === 'header' || it.disabled) return;
    if (it.submenu) return openSub(i);
    onClose();
    it.onSelect?.();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sub) return;
      const idx = selectable.findIndex(({ i }) => i === active);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(selectable[(idx + 1) % selectable.length]?.i ?? -1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(selectable[(idx - 1 + selectable.length) % selectable.length]?.i ?? -1);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (active >= 0) activate(active);
      } else if (e.key === 'ArrowRight') {
        const it = items[active];
        if (it && !it.type && it.submenu) openSub(active);
      } else if (e.key === 'ArrowLeft' && depth > 0) {
        onBack?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const subItem = sub ? items[sub.index] : null;

  return (
    <>
      <div
        ref={ref}
        className="ctx-menu"
        role="menu"
        style={{ left: pos.left, top: pos.top, visibility: pos.ready ? 'visible' : 'hidden' }}
        onMouseDown={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((it, i) => {
          if (it.type === 'separator') return <div key={i} className="ctx-sep" />;
          if (it.type === 'header') return <div key={i} className="ctx-header">{it.label}</div>;
          return (
            <button
              key={i}
              data-idx={i}
              role="menuitem"
              className={`ctx-item ${active === i || sub?.index === i ? 'active' : ''} ${it.danger ? 'danger' : ''} ${it.disabled ? 'disabled' : ''}`}
              aria-disabled={it.disabled}
              onMouseEnter={() => {
                setActive(i);
                window.clearTimeout(hoverTimer.current);
                if (it.submenu && !it.disabled) hoverTimer.current = window.setTimeout(() => openSub(i), 120);
                else hoverTimer.current = window.setTimeout(() => setSub(null), 150);
              }}
              onClick={() => activate(i)}
            >
              <span className="ctx-icon">
                {it.swatch ? (
                  <span className="ctx-swatch" style={{ '--c': it.swatch } as React.CSSProperties} />
                ) : it.checked !== undefined && !it.icon ? (
                  it.checked ? <Check /> : null
                ) : (
                  it.icon
                )}
              </span>
              <span className="ctx-label">{it.label}</span>
              {it.checked && (it.icon || it.swatch) && <Check className="ctx-arrow" />}
              {it.hint && <span className="ctx-hint">{it.hint}</span>}
              {it.submenu && <ChevronRight className="ctx-arrow" />}
            </button>
          );
        })}
      </div>
      {sub && subItem && !subItem.type && subItem.submenu && (
        <MenuPanel
          key={sub.index}
          x={sub.x}
          y={sub.y}
          items={subItem.submenu}
          depth={depth + 1}
          parentWidth={ref.current?.getBoundingClientRect().width ?? 0}
          onBack={() => setSub(null)}
          onClose={() => {
            setSub(null);
            onClose();
          }}
        />
      )}
    </>
  );
}

export function ContextMenuHost() {
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    let key = 0;
    opener = (x, y, items) => setMenu({ x, y, items, key: ++key });
    const onContext = (e: MouseEvent) => {
      const s = useApp.getState().settings;
      if (!isDesktop && s && !s.customContextMenu) return;
      if (e.shiftKey && !isDesktop) return; // Shift + right-click = native menu in the browser
      e.preventDefault();
      const items = buildMenu(e);
      if (items && items.length) setMenu({ x: e.clientX, y: e.clientY, items, key: ++key });
    };
    const close = () => setMenu(null);
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.ctx-menu')) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('contextmenu', onContext);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    window.addEventListener('wheel', close, { passive: true });
    return () => {
      opener = null;
      document.removeEventListener('contextmenu', onContext);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('wheel', close);
    };
  }, []);

  if (!menu) return null;
  return <MenuPanel key={menu.key} x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />;
}

