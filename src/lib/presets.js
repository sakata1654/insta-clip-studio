import { DU0 } from './constants.js';

export const PRESETS_KEY = 'icsPresetsV2';

export const BUILT_IN_PRESETS = [
  { id: 'bi_classic', name: 'Classic Theme', format: 'any', scope: 'subtitle', builtin: true, st: {} },
  {
    id: 'bi_yellow',
    name: 'Yellow Pop',
    format: 'any',
    scope: 'subtitle',
    builtin: true,
    st: { acc: 0, color: '#ffd400', sw: 12, bga: 0, bold: 1 },
  },
  {
    id: 'bi_boxed',
    name: 'Dark Boxed',
    format: 'any',
    scope: 'subtitle',
    builtin: true,
    st: {
      acc: 0,
      color: '#ffffff',
      sw: 0,
      bga: 86,
      bg: '#10131b',
      padX: 28,
      padY: 16,
      boxR: 16,
      boxMode: 'block',
      font: 'system-ui, sans-serif',
      shb: 24,
      shx: 0,
      shy: 8,
      sha: 55,
    },
  },
  {
    id: 'bi_pills',
    name: 'Reels Pills',
    format: 'any',
    scope: 'subtitle',
    builtin: true,
    st: {
      acc: 0,
      color: '#ffffff',
      sw: 0,
      bga: 88,
      bg: '#11141c',
      padX: 22,
      padY: 12,
      boxR: 24,
      boxMode: 'line',
      hl: 1,
      hlc: '#ffd400',
      hlStyle: 'pill',
      size: 68,
      font: 'Inter, "Segoe UI", system-ui, sans-serif',
    },
  },
  {
    id: 'bi_neon',
    name: 'Neon Glow',
    format: 'any',
    scope: 'subtitle',
    builtin: true,
    st: { acc: 0, color: '#00ffd0', stroke: '#ff00aa', sw: 6, shc: '#00ffd0', shb: 34, shx: 0, shy: 0, sha: 100 },
  },
  {
    id: 'bi_minimal',
    name: 'Minimal Clean',
    format: 'any',
    scope: 'subtitle',
    builtin: true,
    st: { acc: 0, color: '#ffffff', sw: 0, bold: 0, size: 56, font: 'system-ui, sans-serif', shb: 8, shx: 0, shy: 2 },
  },
  {
    id: 'bi_minbar_clean',
    name: 'Minbar Clean Dual',
    format: 'any',
    scope: 'subtitle',
    builtin: true,
    du: {
      on: 1,
      dualMode: 'independent',
      style: 'clean',
      showSource: true,
      size: 52,
      sourceColor: '#ffffff',
      sourceStroke: 3,
      sourceShadow: 8,
      sourceY: 66,
      showTranslation: true,
      transSize: 34,
      transColor: '#ffd400',
      transStroke: 3,
      transShadow: 6,
      transY: 79,
    },
  },
  {
    id: 'bi_916_qasida',
    name: '9:16 Qasida Dual',
    format: '9:16',
    scope: 'all',
    builtin: true,
    aspect: '9:16',
    mode: 'studio',
    st: { size: 62, padX: 24, padY: 14, maxLines: 3, marginX: 7 },
    du: {
      on: 1,
      style: 'parchment',
      dualMode: 'paired',
      size: 46,
      transSize: 32,
      padX: 26,
      padY: 18,
      gap: 14,
      sourceMaxW: 88,
      transMaxW: 88,
      sourceY: 75,
      transY: 83,
    },
  },
  {
    id: 'bi_916_reels',
    name: '9:16 Reels Bold',
    format: '9:16',
    scope: 'all',
    builtin: true,
    aspect: '9:16',
    mode: 'simple',
    st: { acc: 0, color: '#ffd400', size: 78, sw: 10, maxLines: 2, padX: 22, padY: 12, anim: 'pop', y: 78 },
    du: { on: 0 },
  },
  {
    id: 'bi_45_feed',
    name: '4:5 IG Feed Dual',
    format: '4:5',
    scope: 'all',
    builtin: true,
    aspect: '4:5',
    mode: 'studio',
    fr: { w: 82, ar: '4:5', y: 36, r: 32 },
    st: { size: 58, maxLines: 2, padX: 22, padY: 12 },
    du: { on: 1, style: 'glass', dualMode: 'paired', size: 40, transSize: 30, padX: 22, padY: 14, gap: 12, sourceY: 76, transY: 84 },
  },
  {
    id: 'bi_11_square',
    name: '1:1 Square Lecture',
    format: '1:1',
    scope: 'all',
    builtin: true,
    aspect: '1:1',
    mode: 'simple',
    st: { acc: 0, color: '#ffffff', size: 56, bga: 78, bg: '#0d1017', padX: 24, padY: 14, boxR: 14, maxLines: 2, y: 84 },
    du: { on: 1, style: 'clean', dualMode: 'paired', size: 38, transSize: 28, sourceStroke: 3, transStroke: 3, sourceY: 74, transY: 82 },
  },
  {
    id: 'bi_169_yt',
    name: '16:9 Cinema Sub',
    format: '16:9',
    scope: 'all',
    builtin: true,
    aspect: '16:9',
    mode: 'simple',
    st: { acc: 0, color: '#ffffff', size: 54, sw: 5, bga: 65, bg: '#090b10', padX: 26, padY: 12, boxR: 12, w: 72, maxLines: 2, y: 86 },
    du: { on: 1, style: 'classic', dualMode: 'paired', size: 40, transSize: 30, padX: 24, padY: 12, gap: 10, sourceMaxW: 74, transMaxW: 74, sourceY: 82, transY: 89 },
  },
];

export function migrateLegacyDual(du) {
  if (!du) return { ...DU0 };
  const m = { ...DU0, ...du };
  if (du.cleanStroke !== undefined) {
    if (du.sourceStroke === undefined) m.sourceStroke = du.cleanStroke;
    if (du.transStroke === undefined) m.transStroke = du.cleanStroke;
  }
  if (du.outlineColor !== undefined) {
    if (du.sourceStrokeColor === undefined) m.sourceStrokeColor = du.outlineColor;
    if (du.transStrokeColor === undefined) m.transStrokeColor = du.outlineColor;
  }
  if (du.shadow !== undefined) {
    if (du.sourceShadow === undefined) m.sourceShadow = du.shadow;
    if (du.transShadow === undefined) m.transShadow = du.shadow;
  }
  if (du.maxW !== undefined) {
    if (du.sourceMaxW === undefined) m.sourceMaxW = du.maxW;
    if (du.transMaxW === undefined) m.transMaxW = du.maxW;
  }
  if (du.maxLines !== undefined) {
    if (du.sourceMaxLines === undefined) m.sourceMaxLines = du.maxLines;
    if (du.transMaxLines === undefined) m.transMaxLines = du.maxLines;
  }
  return m;
}

export function loadCustomPresets() {
  let arr = [];
  try {
    arr = JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]');
  } catch {
    arr = [];
  }
  if (!Array.isArray(arr)) arr = [];
  try {
    const old = JSON.parse(localStorage.icsLooks || 'null');
    if (old && typeof old === 'object' && Object.keys(old).length && !localStorage.getItem('icsLooksMigrated')) {
      for (const [name, o] of Object.entries(old)) {
        arr.push({
          id: 'cp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
          name,
          format: o.aspect || '9:16',
          scope: 'all',
          aspect: o.aspect || '9:16',
          ...o,
          updatedAt: Date.now(),
        });
      }
      localStorage.setItem(PRESETS_KEY, JSON.stringify(arr));
      localStorage.setItem('icsLooksMigrated', '1');
    }
  } catch {}
  return arr;
}

export function saveCustomPresets(arr) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(arr));
  } catch {}
}
