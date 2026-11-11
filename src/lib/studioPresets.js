import { BN0, DU0, FR0, FX0, GR0, HD0, SPK0, ST0, SUBCFG0, WM0 } from './constants.js';
import { migrateLegacyDual } from './presets.js';
import { getTauri } from './tauriBridge.js';

export const STUDIO_PRESET_KEYS = [
  'aspect',
  'mode',
  'grain',
  'theme',
  'themes',
  'st',
  'fr',
  'gr',
  'fx',
  'spk',
  'bn',
  'wm',
  'hd',
  'du',
  'subCfg',
  'fg',
];

const LS_KEY = 'icsStudioPresetsV2';

export const BUILT_IN_STUDIO_PRESETS = [
  {
    id: 'builtin_broadcast_news',
    builtin: true,
    name: 'Broadcast News Desk',
    description: 'Lower-third headline + live ticker + bottom edge glow for organization clips.',
    format: '16:9',
    aspect: '16:9',
    mode: 'simple',
    grain: 0,
    gr: { ...GR0, on: 1, mode: 'custom', color: '#060c18', start: 64, end: 100, max: 88, glowH: 14, glowW: 90, glowOpacity: 42, glowColor: '#2563eb' },
    bn: {
      ...BN0,
      on: 1,
      style: 'broadcast',
      labelOn: 1,
      label: 'BRIEFING',
      labelBg: '#dc2626',
      accentColor: '#2563eb',
      logoText: 'ORG NEWS',
      text: 'Organization Key Announcement Headline',
      ticker: 'Quarterly impact report released today  •  Live briefing updates  •  Follow for official coverage',
      y: 89,
    },
    spk: { ...SPK0, on: 0 },
    du: { ...DU0, on: 0 },
    st: { ...ST0, y: 72, size: 54, boxMode: 'block', bga: 0, sw: 4 },
  },
  {
    id: 'builtin_reels_podcast',
    builtin: true,
    name: 'Executive Dual Reels',
    description: 'Clean vertical card, Speaker badge, and independent dual captions.',
    format: '9:16',
    aspect: '9:16',
    mode: 'studio',
    grain: 4,
    fr: { ...FR0, on: 1, w: 88, r: 32, y: 31, shm: 'glow', bw: 2, bc: '#ffffff' },
    gr: { ...GR0, on: 1, mode: 'theme', start: 54, end: 90, max: 96, glowH: 16, glowW: 85, glowOpacity: 55 },
    spk: { ...SPK0, on: 1, style: 'glass', pos: 'underCard', text: 'Speaker Name | Executive Director', wave: 'bars', prog: 1 },
    bn: { ...BN0, on: 0 },
    du: { ...DU0, on: 1, style: 'glass', sourceY: 71, transY: 81 },
  },
  {
    id: 'builtin_minimal_clean',
    builtin: true,
    name: 'Minimal Editorial',
    description: 'Zero clutter, subtle lower vignette, crisp balanced typography.',
    format: '4:5',
    aspect: '4:5',
    mode: 'simple',
    grain: 0,
    gr: { ...GR0, on: 1, mode: 'black', start: 62, end: 100, max: 76, glowH: 0, glowW: 100, glowOpacity: 0 },
    bn: { ...BN0, on: 0 },
    spk: { ...SPK0, on: 1, style: 'minimalBar', pos: 'bottomLeft', text: 'Speaker Name | Senior Fellow', wave: 'none', prog: 0 },
    du: { ...DU0, on: 0 },
    st: { ...ST0, size: 60, bold: 1, shadow: 1, sw: 2, y: 84 },
  },
];

export function captureStudioPreset(studio, name, description = '') {
  const snap = {
    schema: 'insta-clip-studio-preset',
    version: 2,
    id: 'sp_' + Date.now(),
    name: (name || '').trim() || 'Studio Style ' + new Date().toLocaleDateString(),
    description: (description || '').trim(),
    createdAt: new Date().toISOString(),
    format: studio.aspect || '9:16',
  };
  for (const k of STUDIO_PRESET_KEYS) {
    try {
      snap[k] = JSON.parse(JSON.stringify(studio[k] ?? null));
    } catch {}
  }
  // Strip base64 avatar photo if huge? Keep small ones, and capture portable overlay geometries
  snap.overlayLayouts = (studio.mediaOverlays || []).map((o) => ({
    name: o.name,
    type: o.type,
    x: o.x,
    y: o.y,
    w: o.w,
    h: o.h,
    opacity: o.opacity,
    scale: o.scale,
    fit: o.fit,
    radius: o.radius,
    borderW: o.borderW,
    borderColor: o.borderColor,
    shadowBlur: o.shadowBlur,
    blend: o.blend,
    fadeMs: o.fadeMs,
    loop: o.loop,
    mute: o.mute,
    start: o.start,
    end: o.end,
  }));
  return snap;
}

export function applyStudioPreset(studio, preset) {
  if (!preset || typeof preset !== 'object') return false;
  if (preset.aspect) studio.aspect = preset.aspect;
  if (preset.mode) studio.mode = preset.mode;
  if (preset.grain !== undefined) studio.grain = Number(preset.grain) || 0;
  if (preset.theme !== undefined) studio.theme = Number(preset.theme) || 0;
  if (Array.isArray(preset.themes)) studio.themes = JSON.parse(JSON.stringify(preset.themes));
  if (preset.fr) studio.fr = { ...FR0, ...JSON.parse(JSON.stringify(preset.fr)) };
  if (preset.st) studio.st = { ...ST0, ...JSON.parse(JSON.stringify(preset.st)) };
  if (preset.fx) studio.fx = { ...FX0, ...JSON.parse(JSON.stringify(preset.fx)) };
  if (preset.gr) studio.gr = { ...GR0, ...JSON.parse(JSON.stringify(preset.gr)) };
  if (preset.spk) studio.spk = { ...SPK0, ...JSON.parse(JSON.stringify(preset.spk)) };
  if (preset.bn) studio.bn = { ...BN0, ...JSON.parse(JSON.stringify(preset.bn)) };
  if (preset.wm) studio.wm = { ...WM0, ...JSON.parse(JSON.stringify(preset.wm)) };
  if (preset.hd) studio.hd = { ...HD0, ...JSON.parse(JSON.stringify(preset.hd)) };
  if (preset.du) studio.du = migrateLegacyDual(JSON.parse(JSON.stringify(preset.du)));
  if (preset.subCfg) studio.subCfg = { ...SUBCFG0, ...JSON.parse(JSON.stringify(preset.subCfg)) };
  if (preset.fg) studio.fg = { mode: 'video', kb: 1, kbz: 10, ...JSON.parse(JSON.stringify(preset.fg)) };

  // Apply overlay layout geometry onto matching existing overlays by index/name
  if (Array.isArray(preset.overlayLayouts) && preset.overlayLayouts.length && (studio.mediaOverlays || []).length) {
    studio.mediaOverlays.forEach((ov, idx) => {
      const match = preset.overlayLayouts.find((p) => p.name === ov.name) || preset.overlayLayouts[idx];
      if (!match) return;
      for (const k of ['x', 'y', 'w', 'h', 'opacity', 'scale', 'fit', 'radius', 'borderW', 'borderColor', 'shadowBlur', 'blend', 'fadeMs', 'loop', 'mute']) {
        if (match[k] !== undefined) ov[k] = match[k];
      }
    });
  }

  studio.inv();
  studio.snap();
  return true;
}

export function loadStudioPresets() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function saveStudioPresets(list) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {}
}

export async function exportPresetToJson(preset) {
  const filename = ((preset.name || 'studio-preset').replace(/[^a-z0-9-_]+/gi, '_')) + '.icpreset.json';
  const jsonText = JSON.stringify(preset, null, 2);
  const T = getTauri();
  if (T?.dialog && T?.fs?.writeTextFile) {
    try {
      const savePath = await T.dialog.save({
        defaultPath: filename,
        filters: [{ name: 'Insta Clip Studio Preset', extensions: ['json', 'icpreset.json'] }],
      });
      if (savePath) {
        await T.fs.writeTextFile(savePath, jsonText);
        return savePath;
      }
      return null;
    } catch {}
  }
  const blob = new Blob([jsonText], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

export function parseImportedPreset(rawText) {
  const parsed = JSON.parse(rawText);
  if (!parsed || typeof parsed !== 'object') return null;
  if (!parsed.st && !parsed.fr && !parsed.bn && !parsed.spk && !parsed.du && !parsed.gr) return null;
  return {
    ...parsed,
    id: 'sp_' + Date.now(),
    builtin: false,
    name: parsed.name || 'Imported Preset',
    format: parsed.aspect || parsed.format || '9:16',
    createdAt: parsed.createdAt || new Date().toISOString(),
  };
}

export function pickAndReadJsonFile() {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.json,application/json';
    inp.onchange = async () => {
      try {
        const f = inp.files?.[0];
        if (!f) return resolve(null);
        const text = await f.text();
        resolve(parseImportedPreset(text));
      } catch {
        resolve(null);
      }
    };
    inp.click();
  });
}
