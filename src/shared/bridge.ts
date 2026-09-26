// The API the Electron preload script exposes to the web UI as `window.torboxed`.

export interface WindowState {
  maximized: boolean;
  fullscreen: boolean;
  focused: boolean;
}

export interface DesktopBridge {
  isDesktop: true;
  platform: string;
  window: {
    minimize(): void;
    toggleMaximize(): void;
    toggleFullScreen(): void;
    close(): void;
    quit(): void;
    getState(): Promise<WindowState>;
    onState(cb: (s: WindowState) => void): () => void;
  };
  clipboard: {
    readText(): Promise<string>;
    writeText(text: string): Promise<void>;
  };
  shell: {
    openPath(p: string): Promise<string>;
    showItemInFolder(p: string): Promise<void>;
    openExternal(url: string): Promise<void>;
  };
  dialog: {
    pickFolder(defaultPath?: string): Promise<string | null>;
  };
  app: {
    relaunch(): void;
    setThemeColors(colors: { bg: string; fg: string }): void;
    reload(): void;
    toggleDevTools(): void;
  };
  onNavigate(cb: (page: string) => void): () => void;
  onCommand(cb: (cmd: string, arg?: unknown) => void): () => void;
}

declare global {
  interface Window {
    torboxed?: DesktopBridge;
  }
}
