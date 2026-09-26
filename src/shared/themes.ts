// Theme palettes. Used by the web UI (CSS variables) and the desktop shell
// (window background colour so there is never a white flash on launch).

export interface ThemeColors {
  bg: string; // app background
  panel: string; // sidebar / titlebar
  surface: string; // cards
  surface2: string; // raised elements, inputs
  surface3: string; // hover states
  border: string;
  text: string;
  textDim: string;
  muted: string;
  accent: string;
  accent2: string; // gradient partner
  success: string;
  warning: string;
  danger: string;
  info: string;
}

export interface Theme {
  id: string;
  name: string;
  dark: boolean;
  colors: ThemeColors;
}

export const THEMES: Theme[] = [
  {
    id: 'aurora',
    name: 'Aurora',
    dark: true,
    colors: {
      bg: '#0b0d17',
      panel: '#0e1120',
      surface: '#131729',
      surface2: '#1a1f36',
      surface3: '#232a47',
      border: '#262d4a',
      text: '#eef0ff',
      textDim: '#a9afd0',
      muted: '#6c7399',
      accent: '#8b5cf6',
      accent2: '#06b6d4',
      success: '#34d399',
      warning: '#fbbf24',
      danger: '#f87171',
      info: '#60a5fa',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    dark: true,
    colors: {
      bg: '#0d1015',
      panel: '#10141b',
      surface: '#151a23',
      surface2: '#1c222d',
      surface3: '#252d3a',
      border: '#262e3b',
      text: '#e8edf5',
      textDim: '#a3adbf',
      muted: '#6b768a',
      accent: '#3b82f6',
      accent2: '#22d3ee',
      success: '#22c55e',
      warning: '#f59e0b',
      danger: '#ef4444',
      info: '#38bdf8',
    },
  },
  {
    id: 'oled',
    name: 'OLED',
    dark: true,
    colors: {
      bg: '#000000',
      panel: '#050505',
      surface: '#0c0c0c',
      surface2: '#141414',
      surface3: '#1e1e1e',
      border: '#1f1f1f',
      text: '#f5f5f5',
      textDim: '#a3a3a3',
      muted: '#6b6b6b',
      accent: '#10b981',
      accent2: '#84cc16',
      success: '#22c55e',
      warning: '#eab308',
      danger: '#f43f5e',
      info: '#06b6d4',
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    dark: true,
    colors: {
      bg: '#242933',
      panel: '#272d38',
      surface: '#2e3440',
      surface2: '#353c4a',
      surface3: '#3b4252',
      border: '#434c5e',
      text: '#eceff4',
      textDim: '#d8dee9',
      muted: '#8a93a6',
      accent: '#88c0d0',
      accent2: '#81a1c1',
      success: '#a3be8c',
      warning: '#ebcb8b',
      danger: '#bf616a',
      info: '#5e81ac',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    dark: true,
    colors: {
      bg: '#1e1f29',
      panel: '#21222c',
      surface: '#282a36',
      surface2: '#303241',
      surface3: '#3a3c4e',
      border: '#44475a',
      text: '#f8f8f2',
      textDim: '#c9cbe0',
      muted: '#7f84a8',
      accent: '#bd93f9',
      accent2: '#ff79c6',
      success: '#50fa7b',
      warning: '#f1fa8c',
      danger: '#ff5555',
      info: '#8be9fd',
    },
  },
  {
    id: 'mocha',
    name: 'Catppuccin Mocha',
    dark: true,
    colors: {
      bg: '#11111b',
      panel: '#181825',
      surface: '#1e1e2e',
      surface2: '#262637',
      surface3: '#313244',
      border: '#313244',
      text: '#cdd6f4',
      textDim: '#bac2de',
      muted: '#7f849c',
      accent: '#cba6f7',
      accent2: '#89b4fa',
      success: '#a6e3a1',
      warning: '#f9e2af',
      danger: '#f38ba8',
      info: '#89dceb',
    },
  },
  {
    id: 'tokyo',
    name: 'Tokyo Night',
    dark: true,
    colors: {
      bg: '#16161e',
      panel: '#1a1b26',
      surface: '#1f2030',
      surface2: '#24283b',
      surface3: '#2f3549',
      border: '#2f334d',
      text: '#c0caf5',
      textDim: '#a9b1d6',
      muted: '#646e9c',
      accent: '#7aa2f7',
      accent2: '#bb9af7',
      success: '#9ece6a',
      warning: '#e0af68',
      danger: '#f7768e',
      info: '#7dcfff',
    },
  },
  {
    id: 'rosepine',
    name: 'Rosé Pine',
    dark: true,
    colors: {
      bg: '#191724',
      panel: '#1c1a29',
      surface: '#1f1d2e',
      surface2: '#26233a',
      surface3: '#2f2b47',
      border: '#312e4a',
      text: '#e0def4',
      textDim: '#c4c1de',
      muted: '#6e6a86',
      accent: '#ebbcba',
      accent2: '#c4a7e7',
      success: '#9ccfd8',
      warning: '#f6c177',
      danger: '#eb6f92',
      info: '#31748f',
    },
  },
  {
    id: 'sunset',
    name: 'Sunset',
    dark: true,
    colors: {
      bg: '#140c10',
      panel: '#180f14',
      surface: '#1f141a',
      surface2: '#291a22',
      surface3: '#35222c',
      border: '#3a2530',
      text: '#fdecef',
      textDim: '#d9b8c1',
      muted: '#946b78',
      accent: '#f97316',
      accent2: '#ec4899',
      success: '#4ade80',
      warning: '#facc15',
      danger: '#f43f5e',
      info: '#fb923c',
    },
  },
  {
    id: 'daylight',
    name: 'Daylight',
    dark: false,
    colors: {
      bg: '#f4f5fb',
      panel: '#eceef7',
      surface: '#ffffff',
      surface2: '#f3f4fa',
      surface3: '#e8eaf4',
      border: '#dfe2ee',
      text: '#161a2e',
      textDim: '#4a5070',
      muted: '#838aa8',
      accent: '#7c3aed',
      accent2: '#0891b2',
      success: '#059669',
      warning: '#d97706',
      danger: '#dc2626',
      info: '#2563eb',
    },
  },
  {
    id: 'latte',
    name: 'Catppuccin Latte',
    dark: false,
    colors: {
      bg: '#e6e9ef',
      panel: '#dce0e8',
      surface: '#eff1f5',
      surface2: '#e6e9ef',
      surface3: '#dce0e8',
      border: '#ccd0da',
      text: '#4c4f69',
      textDim: '#5c5f77',
      muted: '#8c8fa1',
      accent: '#8839ef',
      accent2: '#1e66f5',
      success: '#40a02b',
      warning: '#df8e1d',
      danger: '#d20f39',
      info: '#04a5e5',
    },
  },
  {
    id: 'solarized',
    name: 'Solarized Light',
    dark: false,
    colors: {
      bg: '#f5efdc',
      panel: '#eee8d5',
      surface: '#fdf6e3',
      surface2: '#f5efdc',
      surface3: '#eee8d5',
      border: '#e0d9c2',
      text: '#073642',
      textDim: '#586e75',
      muted: '#93a1a1',
      accent: '#268bd2',
      accent2: '#2aa198',
      success: '#859900',
      warning: '#b58900',
      danger: '#dc322f',
      info: '#6c71c4',
    },
  },
];

export const DEFAULT_THEME = 'aurora';

export function getTheme(id: string | null | undefined): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
