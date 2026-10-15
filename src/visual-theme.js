import { setIconPack } from './icons.js';

export const VISUAL_THEMES = [
  { id: 'material', label: 'Material You', blurb: 'Soft tonal · current look', free: true },
  { id: 'editorial', label: 'Editorial', blurb: 'Bold flat · cream + teal', free: false },
  { id: 'minimal', label: 'Minimal', blurb: 'Pure black & white only', free: false },
];

/** Normalize unknown ids → material */
export function normalizeVisualTheme(id) {
  if (id === 'editorial' || id === 'minimal') return id;
  return 'material';
}

export function visualThemeLabel(id) {
  const row = VISUAL_THEMES.find(v => v.id === normalizeVisualTheme(id));
  return row?.label || 'Material You';
}

/** Locked Editorial palette (default cream + teal) — Phase 3 */
export const EDITORIAL = {
  light: {
    '--c0': '#F3EDE3',
    '--c1': '#FAF6EF',
    '--c2': '#FFFBF5',
    '--c3': '#EDE5D8',
    '--c4': '#E0D8CC',
    '--c5': '#CFC5B5',
    '--m3-primary': '#0B7A75',
    '--m3-on-primary': '#FFFBF5',
    '--m3-primary-container': '#C5E8E5',
    '--m3-on-primary-container': '#043533',
    '--m3-secondary': '#0B7A75',
    '--m3-secondary-container': '#C5E8E5',
    '--m3-tertiary': '#0B7A75',
    '--m3-tertiary-container': '#C5E8E5',
    '--m3-surface': '#FAF6EF',
    '--m3-surface-low': '#F3EDE3',
    '--m3-tonal': '#C5E8E5',
    '--m3-outline': '#E0D8CC',
    '--t1': '#1A1A18',
    '--t2': '#4A4843',
    '--t3': '#7A766C',
    '--cyan': '#0B7A75',
    '--green': '#0B7A75',
    '--purple': '#0B7A75',
    '--pink': '#0B7A75',
    '--orange': '#0B7A75',
    '--yellow': '#0B7A75',
  },
  dark: {
    '--c0': '#16140F',
    '--c1': '#1E1B16',
    '--c2': '#2A261F',
    '--c3': '#353028',
    '--c4': '#454038',
    '--c5': '#5A5348',
    '--m3-primary': '#3DBDB5',
    '--m3-on-primary': '#043533',
    '--m3-primary-container': '#0B5C58',
    '--m3-on-primary-container': '#C5E8E5',
    '--m3-secondary': '#3DBDB5',
    '--m3-secondary-container': '#0B5C58',
    '--m3-tertiary': '#3DBDB5',
    '--m3-tertiary-container': '#0B5C58',
    '--m3-surface': '#1E1B16',
    '--m3-surface-low': '#16140F',
    '--m3-tonal': '#0B5C58',
    '--m3-outline': '#454038',
    '--t1': '#F3EDE3',
    '--t2': '#C9C2B5',
    '--t3': '#9A9286',
    '--cyan': '#3DBDB5',
    '--green': '#3DBDB5',
    '--purple': '#3DBDB5',
    '--pink': '#3DBDB5',
    '--orange': '#3DBDB5',
    '--yellow': '#3DBDB5',
  },
};

/**
 * Curated Editorial 2-color combos — exactly two brand colors + shared neutrals.
 * Free: cream-teal, cream-coral. Rest are Pro.
 */
function edCombo(primaryL, primaryD, secondaryL, secondaryD, neutrals = 'cream') {
  const cream = {
    light: { c0: '#F3EDE3', c1: '#FAF6EF', c2: '#FFFBF5', c3: '#EDE5D8', c4: '#E0D8CC', c5: '#CFC5B5', t1: '#1A1A18', t2: '#4A4843', t3: '#7A766C' },
    dark: { c0: '#16140F', c1: '#1E1B16', c2: '#2A261F', c3: '#353028', c4: '#454038', c5: '#5A5348', t1: '#F3EDE3', t2: '#C9C2B5', t3: '#9A9286' },
  };
  const charcoal = {
    light: { c0: '#F0EEEA', c1: '#F7F5F1', c2: '#FFFDF9', c3: '#E4E1DB', c4: '#D4D0C8', c5: '#BEB9AF', t1: '#1A1A18', t2: '#4A4843', t3: '#7A766C' },
    dark: { c0: '#0E0E0C', c1: '#161614', c2: '#22221E', c3: '#2E2E28', c4: '#3E3E36', c5: '#525248', t1: '#F0EEEA', t2: '#C4C0B6', t3: '#949084' },
  };
  const n = neutrals === 'charcoal' ? charcoal : cream;
  const build = (tone, p, s) => {
    const b = n[tone];
    const onP = tone === 'light' ? '#FFFBF5' : '#0A0A08';
    const contP = tone === 'light' ? `${p}22` : `${p}44`;
    return {
      '--c0': b.c0, '--c1': b.c1, '--c2': b.c2, '--c3': b.c3, '--c4': b.c4, '--c5': b.c5,
      '--m3-primary': p, '--m3-on-primary': onP,
      '--m3-primary-container': contP, '--m3-on-primary-container': tone === 'light' ? '#1A1A18' : '#F3EDE3',
      '--m3-secondary': s, '--m3-secondary-container': tone === 'light' ? `${s}28` : `${s}40`,
      '--m3-tertiary': s, '--m3-tertiary-container': tone === 'light' ? `${s}22` : `${s}38`,
      '--m3-surface': b.c1, '--m3-surface-low': b.c0, '--m3-tonal': contP, '--m3-outline': b.c4,
      '--t1': b.t1, '--t2': b.t2, '--t3': b.t3,
      '--cyan': p, '--green': p, '--purple': s, '--pink': s, '--orange': s, '--yellow': s,
    };
  };
  return {
    light: build('light', primaryL, secondaryL),
    dark: build('dark', primaryD, secondaryD),
  };
}

export const EDITORIAL_COMBOS = [
  { id: 'cream-teal', label: 'Cream · Teal', free: true, swatches: ['#FAF6EF', '#0B7A75'], ...edCombo('#0B7A75', '#3DBDB5', '#0B7A75', '#3DBDB5') },
  { id: 'cream-coral', label: 'Cream · Coral', free: true, swatches: ['#FAF6EF', '#E85D4C'], ...edCombo('#E85D4C', '#FF8A7A', '#E85D4C', '#FF8A7A') },
  { id: 'charcoal-mustard', label: 'Charcoal · Mustard', free: false, swatches: ['#1A1A18', '#D4A017'], ...edCombo('#D4A017', '#E8C04A', '#D4A017', '#E8C04A', 'charcoal') },
  { id: 'cream-indigo', label: 'Cream · Indigo', free: false, swatches: ['#FAF6EF', '#3D4A8F'], ...edCombo('#3D4A8F', '#8B9AE8', '#3D4A8F', '#8B9AE8') },
  { id: 'parchment-forest', label: 'Parchment · Forest', free: false, swatches: ['#F3EDE3', '#2F6B4F'], ...edCombo('#2F6B4F', '#7BC49A', '#2F6B4F', '#7BC49A') },
  { id: 'sand-rust', label: 'Sand · Rust', free: false, swatches: ['#F5EDE3', '#C45C2A'], ...edCombo('#C45C2A', '#E08A5A', '#C45C2A', '#E08A5A') },
  { id: 'mist-navy', label: 'Mist · Navy', free: false, swatches: ['#EEF1F5', '#1E3A5F'], ...edCombo('#1E3A5F', '#6B9AC4', '#1E3A5F', '#6B9AC4') },
  { id: 'blush-plum', label: 'Blush · Plum', free: false, swatches: ['#F8EEF2', '#6B3A5E'], ...edCombo('#6B3A5E', '#C48BB0', '#6B3A5E', '#C48BB0') },
  { id: 'ivory-copper', label: 'Ivory · Copper', free: false, swatches: ['#FFFBF5', '#B87333'], ...edCombo('#B87333', '#E0A060', '#B87333', '#E0A060') },
  { id: 'fog-emerald', label: 'Fog · Emerald', free: false, swatches: ['#F0F4F2', '#0A7A5C'], ...edCombo('#0A7A5C', '#3DBD98', '#0A7A5C', '#3DBD98') },
];

export const ALLOWED_FREE_EDITORIAL_COMBOS = EDITORIAL_COMBOS.filter(c => c.free).map(c => c.id);

export function normalizeEditorialCombo(id) {
  if (EDITORIAL_COMBOS.some(c => c.id === id)) return id;
  return 'cream-teal';
}

export function editorialComboList() {
  return EDITORIAL_COMBOS.map(({ id, label, free, swatches }) => ({ id, label, free, swatches }));
}

export function isEditorialComboFree(id) {
  return ALLOWED_FREE_EDITORIAL_COMBOS.includes(normalizeEditorialCombo(id));
}

/**
 * Locked Minimal palette — PURE black (#000) & white (#FFF) only.
 * No graphite / teal / gray hex. Borders use black/white at opacity.
 */
export const MINIMAL = {
  light: {
    '--c0': '#FFFFFF',
    '--c1': '#FFFFFF',
    '--c2': '#FFFFFF',
    '--c3': '#FFFFFF',
    '--c4': '#FFFFFF',
    '--c5': '#FFFFFF',
    '--m3-primary': '#000000',
    '--m3-on-primary': '#FFFFFF',
    '--m3-primary-container': '#FFFFFF',
    '--m3-on-primary-container': '#000000',
    '--m3-secondary': '#000000',
    '--m3-secondary-container': '#FFFFFF',
    '--m3-tertiary': '#000000',
    '--m3-tertiary-container': '#FFFFFF',
    '--m3-surface': '#FFFFFF',
    '--m3-surface-low': '#FFFFFF',
    '--m3-tonal': '#FFFFFF',
    '--m3-outline': '#000000',
    '--t1': '#000000',
    '--t2': '#000000',
    '--t3': '#000000',
    '--cyan': '#000000',
    '--green': '#000000',
    '--purple': '#000000',
    '--pink': '#000000',
    '--orange': '#000000',
    '--yellow': '#000000',
  },
  dark: {
    '--c0': '#000000',
    '--c1': '#000000',
    '--c2': '#000000',
    '--c3': '#000000',
    '--c4': '#000000',
    '--c5': '#000000',
    '--m3-primary': '#FFFFFF',
    '--m3-on-primary': '#000000',
    '--m3-primary-container': '#000000',
    '--m3-on-primary-container': '#FFFFFF',
    '--m3-secondary': '#FFFFFF',
    '--m3-secondary-container': '#000000',
    '--m3-tertiary': '#FFFFFF',
    '--m3-tertiary-container': '#000000',
    '--m3-surface': '#000000',
    '--m3-surface-low': '#000000',
    '--m3-tonal': '#000000',
    '--m3-outline': '#FFFFFF',
    '--t1': '#FFFFFF',
    '--t2': '#FFFFFF',
    '--t3': '#FFFFFF',
    '--cyan': '#FFFFFF',
    '--green': '#FFFFFF',
    '--purple': '#FFFFFF',
    '--pink': '#FFFFFF',
    '--orange': '#FFFFFF',
    '--yellow': '#FFFFFF',
  },
};

const MATERIAL_SKIN = {
  light: {
    '--radius-card': '28px',
    '--radius-pill': '999px',
    '--radius-squircle': '20px',
    '--elev-1': '0 1px 2px rgba(29,26,34,0.04)',
    '--elev-2': '0 2px 8px rgba(29,26,34,0.06)',
    '--elev-3': '0 6px 20px rgba(29,26,34,0.08)',
    '--font-display': "'Segoe UI', system-ui, sans-serif",
    '--font-ui': "'Segoe UI', system-ui, -apple-system, 'Roboto', 'Helvetica Neue', sans-serif",
    '--font-mono': "'Cascadia Mono', 'Consolas', 'Roboto Mono', ui-monospace, monospace",
    '--chart-grid': 'var(--c4)',
    '--chart-stroke': '2.5',
    '--chart-point': '3.5',
    '--chart-tension': '0.35',
  },
  dark: {
    '--radius-card': '28px',
    '--radius-pill': '999px',
    '--radius-squircle': '20px',
    '--elev-1': '0 1px 2px rgba(0,0,0,0.2)',
    '--elev-2': '0 2px 10px rgba(0,0,0,0.28)',
    '--elev-3': '0 8px 24px rgba(0,0,0,0.35)',
    '--font-display': "'Segoe UI', system-ui, sans-serif",
    '--font-ui': "'Segoe UI', system-ui, -apple-system, 'Roboto', 'Helvetica Neue', sans-serif",
    '--font-mono': "'Cascadia Mono', 'Consolas', 'Roboto Mono', ui-monospace, monospace",
    '--chart-grid': 'var(--c4)',
    '--chart-stroke': '2.5',
    '--chart-point': '3.5',
    '--chart-tension': '0.35',
  },
};

const EDITORIAL_SKIN = {
  light: {
    '--radius-card': '16px',
    '--radius-pill': '999px',
    '--radius-squircle': '12px',
    '--elev-1': 'none',
    '--elev-2': '0 2px 0 #1A1A18',
    '--elev-3': '0 3px 0 #1A1A18',
    '--font-display': "'Segoe UI Variable Display', 'Bahnschrift', 'Segoe UI', system-ui, sans-serif",
    '--font-ui': "'Segoe UI', 'Avenir Next', 'Helvetica Neue', system-ui, sans-serif",
    '--font-mono': "'Cascadia Mono', 'Consolas', ui-monospace, monospace",
    '--chart-grid': 'transparent',
    '--chart-stroke': '3',
    '--chart-point': '5',
    '--chart-tension': '0.2',
  },
  dark: {
    '--radius-card': '16px',
    '--radius-pill': '999px',
    '--radius-squircle': '12px',
    '--elev-1': 'none',
    '--elev-2': '0 2px 0 #F3EDE3',
    '--elev-3': '0 3px 0 #F3EDE3',
    '--font-display': "'Segoe UI Variable Display', 'Bahnschrift', 'Segoe UI', system-ui, sans-serif",
    '--font-ui': "'Segoe UI', 'Avenir Next', 'Helvetica Neue', system-ui, sans-serif",
    '--font-mono': "'Cascadia Mono', 'Consolas', ui-monospace, monospace",
    '--chart-grid': 'transparent',
    '--chart-stroke': '3',
    '--chart-point': '5',
    '--chart-tension': '0.2',
  },
};

const MINIMAL_SKIN = {
  light: {
    '--radius-card': '8px',
    '--radius-pill': '6px',
    '--radius-squircle': '6px',
    '--elev-1': 'none',
    '--elev-2': '0 0 0 1px #000000',
    '--elev-3': '0 0 0 2px #000000',
    '--font-display': "'Segoe UI', system-ui, sans-serif",
    '--font-ui': "'Segoe UI', system-ui, -apple-system, sans-serif",
    '--font-mono': "'Cascadia Mono', 'Consolas', ui-monospace, monospace",
    '--chart-grid': 'transparent',
    '--chart-stroke': '2',
    '--chart-point': '3',
    '--chart-tension': '0.15',
    '--chart-fg': '#000000',
    '--chart-bg': '#FFFFFF',
  },
  dark: {
    '--radius-card': '8px',
    '--radius-pill': '6px',
    '--radius-squircle': '6px',
    '--elev-1': 'none',
    '--elev-2': '0 0 0 1px #FFFFFF',
    '--elev-3': '0 0 0 2px #FFFFFF',
    '--font-display': "'Segoe UI', system-ui, sans-serif",
    '--font-ui': "'Segoe UI', system-ui, -apple-system, sans-serif",
    '--font-mono': "'Cascadia Mono', 'Consolas', ui-monospace, monospace",
    '--chart-grid': 'transparent',
    '--chart-stroke': '2',
    '--chart-point': '3',
    '--chart-tension': '0.15',
    '--chart-fg': '#FFFFFF',
    '--chart-bg': '#000000',
  },
};

let _visual = 'material';

export function getVisualTheme() {
  return _visual;
}

export function paletteForVisual(visualId, tone = 'light', comboId = 'cream-teal') {
  const id = normalizeVisualTheme(visualId);
  if (id === 'editorial') {
    const combo = EDITORIAL_COMBOS.find(c => c.id === normalizeEditorialCombo(comboId));
    if (combo) return combo[tone] || combo.light;
    return EDITORIAL[tone] || EDITORIAL.light;
  }
  if (id === 'minimal') return MINIMAL[tone] || MINIMAL.light;
  return null; // material uses SEEDS
}

export function applyVisualSkin(visualId = 'material', tone = 'light', root = document.documentElement) {
  const id = normalizeVisualTheme(visualId);
  _visual = id;
  root.setAttribute('data-visual', id);
  const pack = id === 'editorial'
    ? (EDITORIAL_SKIN[tone] || EDITORIAL_SKIN.light)
    : id === 'minimal'
      ? (MINIMAL_SKIN[tone] || MINIMAL_SKIN.light)
      : (MATERIAL_SKIN[tone] || MATERIAL_SKIN.light);
  for (const [k, v] of Object.entries(pack)) {
    root.style.setProperty(k, v);
  }
  setIconPack(id);
  return id;
}
