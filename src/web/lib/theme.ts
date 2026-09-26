import { getTheme, type Theme } from '../../shared/themes';
import { hexToRgb } from './format';
import { desktop } from './desktop';

export interface ResolvedTheme extends Theme {
  accent: string;
}

let current: ResolvedTheme = { ...getTheme(null), accent: getTheme(null).colors.accent };

export function currentTheme(): ResolvedTheme {
  return current;
}

export function applyTheme(opts: { theme: string; accent: string | null; density: string; reduceMotion: boolean }) {
  const t = getTheme(opts.theme);
  const c = { ...t.colors, accent: opts.accent ?? t.colors.accent };
  current = { ...t, colors: c, accent: c.accent };
  const vars: Record<string, string> = {};
  const map: Record<string, string> = {
    bg: '--bg',
    panel: '--panel',
    surface: '--surface',
    surface2: '--surface-2',
    surface3: '--surface-3',
    border: '--border',
    text: '--text',
    textDim: '--text-dim',
    muted: '--muted',
    accent: '--accent',
    accent2: '--accent-2',
    success: '--success',
    warning: '--warning',
    danger: '--danger',
    info: '--info',
  };
  for (const [k, v] of Object.entries(map)) {
    const hex = c[k as keyof typeof c];
    vars[v] = hex;
    vars[`${v}-rgb`] = hexToRgb(hex).join(' ');
  }
  vars['--scheme'] = t.dark ? 'dark' : 'light';
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.colorScheme = t.dark ? 'dark' : 'light';
  root.dataset.theme = t.id;
  root.dataset.mode = t.dark ? 'dark' : 'light';
  root.dataset.density = opts.density;
  root.dataset.motion = opts.reduceMotion ? 'reduce' : 'full';
  try {
    localStorage.setItem('torboxed.themeVars', JSON.stringify(vars));
  } catch {
    /* private mode */
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', c.panel);
  desktop?.app.setThemeColors({ bg: c.bg, fg: c.text });
}
