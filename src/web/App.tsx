import { useEffect } from 'react';
import { Loader2, WifiOff } from 'lucide-react';
import { PAGES, useApp, type Page } from './store';
import { desktop, isDesktop } from './lib/desktop';
import { formatSpeed } from './lib/format';
import { Sidebar, TitleBar, TopBar } from './components/Chrome';
import { ContextMenuHost } from './components/ContextMenu';
import { AddModal } from './components/AddModal';
import { DropOverlay, RemoveDialog, Toasts } from './components/Dialogs';
import { JobDrawer } from './components/JobDrawer';
import { Logo, SvgDefs } from './components/ui';
import { Downloads } from './pages/Downloads';
import { Cloud } from './pages/Cloud';
import { Analytics } from './pages/Analytics';
import { Organize } from './pages/Organize';
import { Settings } from './pages/Settings';

const VIEWS: Record<Page, () => React.JSX.Element | null> = {
  downloads: Downloads,
  cloud: Cloud,
  analytics: Analytics,
  organize: Organize,
  settings: Settings,
};

function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useApp.getState();
      const typing = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]');
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        st.openAdd();
      } else if (mod && e.key === ',') {
        e.preventDefault();
        st.go('settings');
      } else if (e.altKey && /^[1-5]$/.test(e.key)) {
        e.preventDefault();
        st.go(PAGES[Number(e.key) - 1]);
      } else if (!typing && e.key === '/') {
        const el = document.getElementById('global-search') as HTMLInputElement | null;
        if (el) {
          e.preventDefault();
          el.focus();
        }
      } else if (e.key === 'F11' && desktop) {
        e.preventDefault();
        desktop.window.toggleFullScreen();
      }
    };
    // Paste magnets / .torrent files anywhere (outside of text fields).
    const onPaste = (e: ClipboardEvent) => {
      const st = useApp.getState();
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable="true"]') || st.addOpen) return;
      const text = e.clipboardData?.getData('text') ?? '';
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => /\.torrent$/i.test(f.name));
      if (files.length || /magnet:\?|^https?:\/\//im.test(text)) {
        e.preventDefault();
        st.openAdd({ links: text, files });
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('paste', onPaste);
    };
  }, []);
}

function useDesktopBridge() {
  useEffect(() => {
    if (!desktop) return;
    const offNav = desktop.onNavigate((p) => {
      const [page, section] = p.split('/');
      if ((PAGES as string[]).includes(page)) useApp.getState().go(page as Page, section ?? null);
    });
    const offCmd = desktop.onCommand((cmd, arg) => {
      const st = useApp.getState();
      if (cmd === 'add') st.openAdd(typeof arg === 'string' ? { links: arg } : undefined);
    });
    return () => {
      offNav();
      offCmd();
    };
  }, []);
}

function useDocumentTitle() {
  const speed = useApp((s) => s.tick?.speed ?? 0);
  const active = useApp((s) => s.jobs.some((j) => j.status === 'downloading'));
  useEffect(() => {
    document.title = active && speed > 0 ? `↓ ${formatSpeed(speed)} · Torboxed` : 'Torboxed';
  }, [speed, active]);
}

export function App() {
  const { ready, bootError, connected, page, addOpen, removeIds } = useApp();
  useGlobalShortcuts();
  useDesktopBridge();
  useDocumentTitle();

  useEffect(() => {
    document.body.classList.toggle('is-desktop', isDesktop);
    void useApp.getState().init();
  }, []);

  const View = VIEWS[page];
  return (
    <div className={`app ${isDesktop ? 'is-desktop' : ''}`}>
      <SvgDefs />
      <TitleBar />
      {!ready ? (
        <div className="boot">
          <div>
            <Logo size={72} />
            <p className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
              <Loader2 className="spin" size={16} />
              {bootError ? `Waiting for the server… (${bootError})` : 'Starting Torboxed…'}
            </p>
          </div>
        </div>
      ) : (
        <div className="shell">
          <Sidebar />
          <main className="main" id="main">
            <TopBar />
            <View />
          </main>
        </div>
      )}
      {ready && !connected && (
        <div className="conn-banner">
          <WifiOff size={15} /> Reconnecting to Torboxed…
        </div>
      )}
      {addOpen && <AddModal />}
      {removeIds && <RemoveDialog />}
      <JobDrawer />
      <DropOverlay />
      <Toasts />
      <ContextMenuHost />
    </div>
  );
}
