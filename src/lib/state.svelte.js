import {
  AUD0,
  BN0,
  DIMS,
  DU0,
  EX0,
  FR0,
  FX0,
  GR0,
  HD0,
  PROV,
  SHORTCUT_DEFAULTS,
  SPK0,
  ST0,
  SUBCFG0,
  TR0,
  WM0,
} from './constants.js';
import { migrateLegacyDual } from './presets.js';
import { applySubtitlePadding, expandAllPipeSubtitles, segsToSubs, splitCueByPipe, synthWords } from './prompts.js';
import { getTauri } from './tauriBridge.js';

export const esc = (s) =>
  String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const p2 = (n) => String(n).padStart(2, '0');

export const fmt = (s) => {
  s = Math.max(0, s || 0);
  return ~~(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0');
};

export const fts = (s) => {
  const ms = Math.round(Math.max(0, s || 0) * 1000);
  return `${p2(~~(ms / 3600000))}:${p2(~~((ms % 3600000) / 60000))}:${p2(~~((ms % 60000) / 1000))},${String(ms % 1000).padStart(3, '0')}`;
};

export const fvtt = (s) => fts(s).replace(',', '.');

export const tsParse = (x) => {
  const m = String(x || '')
    .trim()
    .match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +('0.' + m[4]) : 0;
};

export const cl = (v, a, b) => Math.min(b, Math.max(a, v));

export const hex2 = (h) => {
  h = String(h || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16) || 0);
};

export const rgb2hex = (r, g, b) =>
  '#' + [r, g, b].map((v) => cl(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

export const rgba = (h, a) => {
  const [r, g, b] = hex2(h);
  return `rgba(${r},${g},${b},${a})`;
};

export const PROJECTS_KEY = 'icsProjectLibraryV1';
const PK = [
  'subs',
  'st',
  'fr',
  'fx',
  'aspect',
  'trimS',
  'trimE',
  'vol',
  'mode',
  'fg',
  'mediaOverlays',
  'gr',
  'spk',
  'bn',
  'wm',
  'hd',
  'du',
  'grain',
  'themes',
  'theme',
  'shift',
  'cam',
  'shots',
  'ex',
  'aud',
  'subCfg',
];

class StudioStore {
  // Navigation & Theme
  nav = $state('ed'); // 'dl' | 'ed' | 'su' | 'tr' | 'ai' | 'ex' | 'set'
  sideTab = $state('frame'); // 'frame' | 'assets' | 'theme' | 'cam' | 'ovl' | 'txt' | 'fx' | 'subs' | 'sty' | 'exp' | 'aud' | 'cap'
  styleSubTab = $state('main'); // 'main' | 'dual' | 'presets'
  dualSubTab = $state('layout'); // 'layout' | 'source' | 'trans'
  styleSearch = $state('');
  uiTheme = $state(
    typeof localStorage !== 'undefined' && localStorage.icsUiTheme === 'light' ? 'light' : 'dark'
  );
  leftTab = $state('media');
  subTab = $state('gen'); // 'gen' | 'edit' | 'style' | 'tr'
  inspectorTab = $state('auto'); // 'auto' | 'subtitles' | 'canvas' | 'overlays' | 'export'
  previewZoom = $state(1);
  homeOpen = $state(true);
  exportModalOpen = $state(false);
  onboardingDismissed = $state(
    typeof localStorage !== 'undefined' && localStorage.icsOnboarded === '1'
  );

  // Toast, Confirm & UI Overlays
  toastMsg = $state('');
  apiModalOpen = $state(false);
  colorPicker = $state({ open: false, x: 100, y: 100, hex: '#ffffff', onChange: null, wasOpenBeforeDropper: false });
  eyeDropper = $state({
    active: false,
    x: 0,
    y: 0,
    hex: '#ffffff',
    rgb: [255, 255, 255, 255],
    rgbStr: 'rgb(255, 255, 255)',
    hsl: [0, 0, 100],
    sourceLabel: 'Screen',
    patch: null,
    patchWidth: 11,
    patchHeight: 11,
    patchOffsetX: 5,
    patchOffsetY: 5,
    onPick: null,
  });
  confirmDialog = $state({ open: false, title: '', message: '', confirmText: 'Confirm', cancelText: 'Cancel', danger: false, resolve: null });

  // Active Project State
  projectName = $state('');
  activeProjectId = $state(null);
  mode = $state('studio');
  fr = $state({ ...FR0 });
  fg = $state({ mode: 'video', kb: 1, kbz: 10 });
  gr = $state({ ...GR0 });
  spk = $state({ ...SPK0 });
  bn = $state({ ...BN0 });
  wm = $state({ ...WM0 });
  hd = $state({ ...HD0 });
  du = $state({ ...DU0 });
  ex = $state({ ...EX0 });
  aud = $state({ ...AUD0 });
  subCfg = $state({ ...SUBCFG0 });
  st = $state({ ...ST0 });
  fx = $state({ ...FX0 });
  grain = $state(6);
  themes = $state([]);
  theme = $state(0);
  shift = $state(0);
  cam = $state('auto');
  shots = $state([{ t: 0, px: 0, py: 0, zoom: 100 }]);
  shotIdx = $state(-1);
  dm = $state('video');
  guides = $state(0);
  guideMode = $state('reels'); // 'reels' | 'tiktok' | 'shorts'
  loopRange = $state(false);
  snapGrid = $state(true);
  selectedOverlayId = $state(null);
  selectedCanvasKind = $state(null); // 'spk' | 'bn' | 'sub' | null
  hov = $state(0);
  hoverLayer = $state(null);
  subBoxSelected = $state(false);
  sample = $state(0);
  sampleSub = $state(0);
  path = $state(null);
  file = $state(null);
  meta = $state({});
  subs = $state([]);
  texts = $state([]);
  mediaOverlays = $state([]);
  sel = $state(null);
  act = $state(null);
  aspect = $state('9:16');
  trimS = $state(0);
  trimE = $state(0);
  activeAiClip = $state(null);
  vol = $state(100);
  dir = $state(null);

  // Playback / Viewport / Export Runtime
  dur = $state(0);
  playhead = $state(0);
  playing = $state(false);
  speed = $state(1);
  previewScale = $state(0.5);
  timelineZoom = $state(1);
  timelineAutoScroll = $state(
    typeof localStorage !== 'undefined' && localStorage.icsTlAutoScroll === '0' ? false : true
  );
  audioDuration = $state(0);
  exporting = $state(false);
  exportPct = $state(0);
  exportLabel = $state('Ready to export');
  exportStatus = $state('');
  exportJobs = $state([]);
  dirty = 3;
  unsaved = $state(false);
  lastSavedAt = $state(0);

  // Hit-boxes updated by Canvas renderer
  frBox = null;
  frW = 1080;
  frH = 1920;
  hdBox = null;
  spkBox = null;
  bnBox = null;
  subBox = null;
  subMaxBox = null;
  duSourceBox = null;
  duTransBox = null;

  // Assets, Environment, AI Configs, History
  assetLibrary = $state([]);
  projects = $state([]);
  env = $state(null);
  fdOk = $state(true);
  shortcuts = $state({ ...SHORTCUT_DEFAULTS });
  API = $state({ prov: 'openai', url: PROV.openai[0], key: '', model: PROV.openai[1] });
  TR = $state({ ...TR0 });

  // Non-reactive media DOM references & caches
  V = null;
  A = null;
  C = null;
  videoObjectUrl = null;
  activeAudioUrl = null;
  fgImg = null;
  ovlImg = null;
  ovlC = null;
  mediaNodes = new Map();
  uid = 1;
  toastTimer = null;
  hist = [];
  histIdx = $state(-1);
  histLen = $state(0);
  snapTimer = null;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const storedSc = JSON.parse(localStorage.getItem('icsShortcuts') || '{}');
        const cleanedSc = {};
        for (const k of Object.keys(SHORTCUT_DEFAULTS)) {
          if (storedSc[k]) cleanedSc[k] = k === 'split' && storedSc[k] === 's' ? SHORTCUT_DEFAULTS.split : storedSc[k];
        }
        this.shortcuts = { ...SHORTCUT_DEFAULTS, ...cleanedSc };
      } catch {}
      try {
        this.API = { ...this.API, ...JSON.parse(localStorage.icsApi || '{}') };
      } catch {}
      try {
        this.TR = { ...TR0, ...JSON.parse(localStorage.icsTr || '{}') };
      } catch {}
      if (!this.TR.key && this.API.key && this.TR.prov === this.API.prov) this.TR.key = this.API.key;
      try {
        const savedAssets = JSON.parse(localStorage.icsAssets || '[]');
        if (Array.isArray(savedAssets)) {
          this.assetLibrary = savedAssets
            .filter((a) => a && a.path && ['image', 'video', 'audio'].includes(a.type))
            .map((a) => ({ ...a, file: null, img: null, url: null }));
        }
      } catch {}
      try {
        this.aud.track = localStorage.icsAudioTrack || '';
        this.aud.trackName = localStorage.icsAudioName || '';
      } catch {}
      this.refreshProjects();
      this.applyUiTheme(this.uiTheme);
    }
  }

  get LW() {
    return (DIMS[this.aspect] || DIMS['9:16'])[0];
  }
  get LH() {
    return (DIMS[this.aspect] || DIMS['9:16'])[1];
  }

  applyUiTheme(name) {
    const resolved = name === 'light' ? 'light' : 'dark';
    this.uiTheme = resolved;
    try {
      localStorage.icsUiTheme = resolved;
      document.documentElement.dataset.theme = resolved;
    } catch {}
  }

  confirm({ title = 'Confirm Action', message = '', confirmText = 'Continue', cancelText = 'Cancel', danger = false } = {}) {
    return new Promise((resolve) => {
      this.confirmDialog = { open: true, title, message, confirmText, cancelText, danger, resolve };
    });
  }

  resolveConfirm(ok) {
    const r = this.confirmDialog.resolve;
    this.confirmDialog = { ...this.confirmDialog, open: false, resolve: null };
    r?.(!!ok);
  }

  startEyeDropper(onPick, initialHex = '#ffffff') {
    this.eyeDropper = {
      active: true,
      x: typeof window !== 'undefined' ? Math.round(window.innerWidth / 2) : 200,
      y: typeof window !== 'undefined' ? Math.round(window.innerHeight / 2) : 200,
      hex: initialHex,
      rgb: [255, 255, 255, 255],
      rgbStr: 'rgb(255, 255, 255)',
      hsl: [0, 0, 100],
      sourceLabel: 'Screen',
      patch: null,
      patchWidth: 11,
      patchHeight: 11,
      patchOffsetX: 5,
      patchOffsetY: 5,
      onPick,
    };
    if (this.colorPicker.open) {
      this.colorPicker.wasOpenBeforeDropper = true;
      this.colorPicker.open = false;
    }
  }

  cancelEyeDropper() {
    this.eyeDropper.active = false;
    this.eyeDropper.onPick = null;
    if (this.colorPicker.wasOpenBeforeDropper) {
      this.colorPicker.open = true;
      this.colorPicker.wasOpenBeforeDropper = false;
    }
  }

  commitEyeDropper(sample) {
    const hex = typeof sample === 'string' ? sample : sample?.hex || '#ffffff';
    if (this.eyeDropper.onPick) {
      this.eyeDropper.onPick(hex);
    }
    this.eyeDropper.active = false;
    this.eyeDropper.onPick = null;
    if (this.colorPicker.wasOpenBeforeDropper) {
      this.colorPicker.hex = hex;
      this.colorPicker.open = true;
      this.colorPicker.wasOpenBeforeDropper = false;
    }
    this.inv();
    this.snap();
  }

  inv(markUnsaved = true) {
    this.dirty = 3;
    if (markUnsaved) this.unsaved = true;
  }

  toast(msg) {
    this.toastMsg = msg;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastMsg = '';
    }, 2800);
  }

  addExportJob(job) {
    this.exportJobs = [job, ...this.exportJobs].slice(0, 12);
    this.syncExportSummary();
  }

  updateExportJob(id, patch) {
    const idx = this.exportJobs.findIndex((j) => j.id === id);
    if (idx < 0) return;
    Object.assign(this.exportJobs[idx], patch);
    this.syncExportSummary();
  }

  clearFinishedJobs() {
    this.exportJobs = this.exportJobs.filter((j) => !j.done);
    this.syncExportSummary();
  }

  syncExportSummary() {
    const running = this.exportJobs.filter((j) => !j.done);
    const latest = running[0] || this.exportJobs[0];
    this.exporting = running.length > 0;
    if (latest) {
      this.exportPct = latest.pct ?? 0;
      this.exportLabel = latest.label || '';
      this.exportStatus = latest.status || '';
    }
  }

  nextId() {
    return this.uid++;
  }

  setView(v) {
    this.nav = v;
    const edTabs = ['frame', 'assets', 'theme', 'cam', 'ovl', 'txt', 'fx'];
    const suTabs = ['subs', 'sty'];
    const exTabs = ['exp', 'aud', 'cap'];
    if (v === 'ed' && !edTabs.includes(this.sideTab)) this.sideTab = 'frame';
    if (v === 'su' && !suTabs.includes(this.sideTab)) this.sideTab = 'subs';
    if (v === 'ex' && !exTabs.includes(this.sideTab)) this.sideTab = 'exp';
    this.inv();
  }

  getPath(pathStr) {
    return pathStr.split('.').reduce((o, k) => o?.[k], this);
  }

  setPath(pathStr, val) {
    const parts = pathStr.split('.');
    const last = parts.pop();
    const target = parts.reduce((o, k) => o[k], this);
    if (target) target[last] = val;
    this.inv();
  }

  setMode(m) {
    this.mode = m;
    if (m === 'simple') {
      this.fr.on = 0;
      Object.assign(this.gr, { mode: 'black', start: 58, end: 74, max: 55 });
      this.st.acc = 0;
      this.st.color = '#ffffff';
      this.cam = 'manual';
    } else {
      this.fr.on = 1;
      Object.assign(this.gr, { mode: 'theme', start: 55, end: 88, max: 98 });
      this.st.acc = 1;
      this.cam = 'auto';
    }
    this.inv();
    this.snap();
  }

  saveShot() {
    const s = this.shots[Math.max(0, this.shotIdx)];
    if (s) {
      s.px = this.fx.px;
      s.py = this.fx.py;
      s.zoom = this.fx.zoom;
      s.set = true;
    }
  }

  currentPlayhead() {
    if (this.aud.track && this.A?.src && !this.A.paused) return this.A.currentTime;
    if (this.V?.src) return this.V.currentTime;
    if (this.aud.track && this.A?.src) return this.A.currentTime;
    return this.playhead || 0;
  }

  seek(t) {
    const maxD = Number.isFinite(this.dur) && this.dur > 0 ? this.dur : this.audioDuration || 0;
    const clamped = Math.max(0, Math.min(maxD || 99999, Number(t) || 0));
    this.playhead = clamped;
    if (this.V?.src) {
      try {
        this.V.currentTime = clamped;
      } catch {}
    }
    if (this.aud.track && this.A?.src) {
      try {
        this.A.currentTime = Math.min(clamped, Number.isFinite(this.A.duration) ? this.A.duration : clamped);
      } catch {}
    }
    this.inv();
  }

  projJson() {
    const plain = (v) => JSON.parse(JSON.stringify(v));
    const out = {};
    for (const k of PK) out[k] = plain(this[k]);
    out.texts = plain(this.texts.map(({ box, ...r }) => r));
    out.mediaOverlays = plain((this.mediaOverlays || []).map(({ _box, ...r }) => r));
    return out;
  }

  snap() {
    const j = JSON.stringify(this.projJson());
    if (this.hist[this.histIdx] === j) return;
    this.hist.length = this.histIdx + 1;
    this.hist.push(j);
    if (this.hist.length > 80) this.hist.shift();
    this.histIdx = this.hist.length - 1;
    this.histLen = this.hist.length;
  }

  scheduleSnap() {
    clearTimeout(this.snapTimer);
    this.snapTimer = setTimeout(() => this.snap(), 350);
  }

  goHist(delta) {
    this.snap();
    const n = this.histIdx + delta;
    if (n < 0 || n >= this.hist.length) return;
    this.histIdx = n;
    this.projLoad(JSON.parse(this.hist[n]));
    this.toast(delta < 0 ? 'Undo' : 'Redo');
  }

  projLoad(o) {
    if (!o || typeof o !== 'object') return;
    for (const k of PK) {
      if (o[k] !== undefined) this[k] = JSON.parse(JSON.stringify(o[k]));
    }
    this.texts = JSON.parse(JSON.stringify(o.texts || []));
    this.fr = { ...FR0, ...this.fr };
    this.st = { ...ST0, ...this.st };
    this.fx = { ...FX0, ...this.fx };
    this.gr = { ...GR0, ...this.gr };
    this.spk = { ...SPK0, ...this.spk };
    this.bn = { ...BN0, ...this.bn };
    this.wm = { ...WM0, ...this.wm };
    this.hd = { ...HD0, ...this.hd };
    this.du = migrateLegacyDual(this.du);
    this.ex = { ...EX0, ...this.ex };
    this.aud = { ...AUD0, ...this.aud };
    this.subCfg = { ...SUBCFG0, ...this.subCfg };
    this.fg = { mode: 'video', kb: 1, kbz: 10, ...this.fg };
    this.mediaOverlays = this.mediaOverlays || [];
    if (!this.shots || !this.shots.length) this.shots = [{ t: 0, px: 0, py: 0, zoom: 100 }];
    this.shotIdx = -1;
    this.uid = 1 + Math.max(0, ...this.subs.map((x) => x.id || 0), ...this.texts.map((x) => x.id || 0));
    this.inv();
  }

  resetProject() {
    try {
      this.V?.pause();
      this.V?.removeAttribute('src');
      this.V?.load();
      this.A?.pause();
      this.A?.removeAttribute('src');
      this.A?.load();
      if (this.videoObjectUrl) URL.revokeObjectURL(this.videoObjectUrl);
      if (this.activeAudioUrl) URL.revokeObjectURL(this.activeAudioUrl);
    } catch {}
    for (const rec of this.mediaNodes.values()) {
      try {
        if (rec.el?.tagName === 'VIDEO') {
          rec.el.pause();
          rec.el.removeAttribute('src');
          rec.el.load();
        }
        if (rec.url) URL.revokeObjectURL(rec.url);
      } catch {}
    }
    this.mediaNodes.clear();
    this.assetLibrary = [];
    this.saveAssets();
    this.mode = 'studio';
    this.fr = { ...FR0 };
    this.fg = { mode: 'video', kb: 1, kbz: 10 };
    this.gr = { ...GR0 };
    this.spk = { ...SPK0 };
    this.bn = { ...BN0 };
    this.wm = { ...WM0 };
    this.hd = { ...HD0 };
    this.du = { ...DU0 };
    this.ex = { ...EX0 };
    this.aud = { ...AUD0 };
    this.subCfg = { ...SUBCFG0 };
    this.st = { ...ST0 };
    this.fx = { ...FX0 };
    this.grain = 6;
    this.themes = [];
    this.theme = 0;
    this.shift = 0;
    this.cam = 'auto';
    this.shots = [{ t: 0, px: 0, py: 0, zoom: 100 }];
    this.shotIdx = -1;
    this.dm = 'video';
    this.guides = 0;
    this.sample = 0;
    this.sampleSub = 0;
    this.path = null;
    this.file = null;
    this.meta = {};
    this.subs = [];
    this.texts = [];
    this.mediaOverlays = [];
    this.sel = null;
    this.act = null;
    this.aspect = '9:16';
    this.trimS = 0;
    this.trimE = 0;
    this.vol = 100;
    this.dur = 0;
    this.playhead = 0;
    this.audioDuration = 0;
    this.fgImg = null;
    this.ovlImg = null;
    this.ovlC = null;
    this.activeProjectId = null;
    this.dir = null;
    this.projectName = '';
    try {
      localStorage.removeItem('icsAudioTrack');
      localStorage.removeItem('icsAudioName');
    } catch {}
    this.inv();
    this.snap();
  }

  /* ---------- Subtitle Operations (including Minbar word-transfer) ---------- */

  parseSRT(txt) {
    const parsed = String(txt || '')
      .replace(/\r/g, '')
      .trim()
      .split(/\n\n+/)
      .map((b) => {
        const l = b.split('\n');
        const i = l.findIndex((x) => x.includes('-->'));
        if (i < 0) return null;
        const [a, z] = l[i].split('-->');
        const rs = tsParse(a);
        const re = tsParse(z);
        return { id: this.nextId(), s: rs, e: re, rawS: rs, rawE: re, t: l.slice(i + 1).join('\n') };
      })
      .filter(Boolean);
    return expandAllPipeSubtitles(parsed, () => this.nextId());
  }

  expandPipeSubtitles(recordHistory = true) {
    const before = this.subs.length;
    if (!this.subs.some((o) => String(o.t || '').includes('|') || String(o.tr || '').includes('|'))) return 0;
    const next = expandAllPipeSubtitles(this.subs, () => this.nextId());
    this.subs = next;
    if (this.sel && !this.subs.some((s) => s.id === this.sel)) this.sel = this.subs[0]?.id ?? null;
    this.inv();
    if (recordHistory) this.snap();
    return Math.max(0, next.length - before);
  }

  rewrapAndPad() {
    if (!this.subs.length) return this.toast('No subtitles to re-wrap');
    const maxC = Math.max(0, Number(this.subCfg.maxChars) || 0);
    const maxW = Math.max(0, Number(this.subCfg.maxWords) || 0);
    const maxD = Math.max(0, Number(this.subCfg.maxDur) || 0);
    const padB = Math.max(0, Number(this.subCfg.padBeforeMs) || 0);
    const padA = Math.max(0, Number(this.subCfg.padAfterMs) || 0);

    const sorted = expandAllPipeSubtitles(
      [...this.subs].sort((a, b) => (a.rawS ?? a.s) - (b.rawS ?? b.s)),
      () => this.nextId()
    );
    let nextSubs;
    if (maxC > 0 || maxW > 0 || maxD > 0) {
      const segInput = sorted.map((o) => {
        const bs = o.rawS ?? o.s;
        const be = o.rawE ?? o.e;
        const text = String(o.orig !== undefined ? o.orig : o.t || '').trim();
        const ws = o.words && o.words.length ? o.words : synthWords({ s: bs, e: be, t: text });
        return { s: bs, e: be, t: text, w: ws };
      });
      nextSubs = segsToSubs(segInput, maxC, maxW, maxD, () => this.nextId());
    } else {
      nextSubs = sorted.map((o) => ({ ...o }));
    }

    this.subs = applySubtitlePadding(nextSubs, padB, padA, this.dur || this.audioDuration || 0);
    this.inv();
    this.snap();
    this.toast(`Updated ${this.subs.length} subtitles (target ${maxW || '∞'}w · pad −${padB}/+${padA}ms)`);
  }

  stepFrame(dir = 1) {
    const fps = Math.max(15, Number(this.ex?.fps) || 30);
    const maxD = this.dur || this.audioDuration || 0;
    const nextT = cl(this.currentPlayhead() + dir * (1 / fps), 0, maxD || Infinity);
    this.seek(nextT);
  }

  splitSelectedAtPlayhead() {
    const t = this.currentPlayhead();
    let ix = this.sel ? this.subs.findIndex((s) => s.id === this.sel && t > s.s + 0.04 && t < s.e - 0.04) : -1;
    if (ix < 0) {
      if (this.sel && this.subs.some((s) => s.id === this.sel)) {
        return this.toast('Move playhead inside the selected subtitle block to split (D)');
      }
      ix = this.subs.findIndex((s) => t > s.s + 0.04 && t < s.e - 0.04);
    }
    if (ix < 0) return this.toast('Move playhead inside a subtitle block to split (D)');

    const s = this.subs[ix];
    // If cue contains "|" markers, honor explicit separator split cleanly
    if (String(s.t || '').includes('|')) {
      const parts = splitCueByPipe(s, () => this.nextId());
      this.subs.splice(ix, 1, ...parts);
      this.sel = parts[1]?.id ?? parts[0]?.id ?? null;
      this.inv();
      this.snap();
      return parts[1] || parts[0];
    }

    const ws = String(s.t || '').trim().split(/\s+/).filter(Boolean);
    if (ws.length < 2) return this.toast('Need at least 2 words in subtitle to split');

    const hasExactWords = Array.isArray(s.words) && s.words.length === ws.length;
    let splitIdx = -1;
    let splitTime = t;
    if (hasExactWords) {
      for (let i = 1; i < s.words.length; i++) {
        const mid = (s.words[i].s + s.words[i - 1].e) * 0.5;
        if (mid >= t) {
          splitIdx = i;
          splitTime = cl(mid, s.s + 0.04, s.e - 0.04);
          break;
        }
      }
      if (splitIdx < 0) {
        splitIdx = ws.length - 1;
        const tailMid = (s.words[splitIdx].s + s.words[splitIdx - 1].e) * 0.5;
        splitTime = cl(tailMid, s.s + 0.04, s.e - 0.04);
      }
    } else {
      const ratio = (t - s.s) / Math.max(0.1, s.e - s.s);
      splitIdx = Math.max(1, Math.min(ws.length - 1, Math.round(ws.length * ratio)));
    }
    splitTime = +cl(splitTime, s.s + 0.04, s.e - 0.04).toFixed(3);

    const leftText = ws.slice(0, splitIdx).join(' ');
    const rightText = ws.slice(splitIdx).join(' ');
    const leftWords = hasExactWords ? s.words.slice(0, splitIdx) : synthWords({ s: s.s, e: splitTime, t: leftText });
    const rightWords = hasExactWords ? s.words.slice(splitIdx) : synthWords({ s: splitTime, e: s.e, t: rightText });

    const splitExtra = (val) => {
      if (val === undefined) return undefined;
      const arr = String(val).trim().split(/\s+/).filter(Boolean);
      if (arr.length < 2) return [val, ''];
      const cut = Math.max(1, Math.min(arr.length - 1, Math.round((arr.length * splitIdx) / ws.length)));
      return [arr.slice(0, cut).join(' '), arr.slice(cut).join(' ')];
    };
    const origSplit = s.orig !== undefined && s.orig !== s.t ? splitExtra(s.orig) : s.orig !== undefined ? [leftText, rightText] : null;
    const trSplit = s.tr !== undefined && s.tr !== s.t ? splitExtra(s.tr) : s.tr !== undefined ? [leftText, rightText] : null;

    const right = {
      ...s,
      id: this.nextId(),
      s: splitTime,
      rawS: splitTime,
      e: s.e,
      rawE: s.rawE ?? s.e,
      t: rightText,
      words: rightWords,
      ...(s.st ? { st: JSON.parse(JSON.stringify(s.st)) } : {}),
      ...(origSplit ? { orig: origSplit[1] } : {}),
      ...(trSplit ? { tr: trSplit[1] } : {}),
    };
    delete right.trIssue;

    s.e = splitTime;
    s.rawE = splitTime;
    s.t = leftText;
    s.words = leftWords;
    if (origSplit) s.orig = origSplit[0];
    if (trSplit) s.tr = trSplit[0];

    this.subs.splice(ix + 1, 0, right);
    this.sel = right.id;
    this.inv();
    this.snap();
    return right;
  }

  clearSelection() {
    this.selectedOverlayId = null;
    this.sel = null;
    this.subBoxSelected = false;
    this.selectedCanvasKind = null;
    this.inv();
  }

  toggleSelectedVisibility() {
    if (this.selectedOverlayId) {
      const ov = this.mediaOverlays.find((o) => o.id === this.selectedOverlayId);
      if (ov) {
        ov.enabled = ov.enabled === false;
        this.inv();
        this.snap();
        return true;
      }
    }
    if (this.sel) {
      const tx = this.texts.find((x) => x.id === this.sel);
      if (tx) {
        tx.enabled = tx.enabled === false;
        this.inv();
        this.snap();
        return true;
      }
    }
    if (this.selectedCanvasKind === 'spk') {
      this.spk.on = this.spk.on ? 0 : 1;
      this.inv();
      this.snap();
      return true;
    }
    if (this.selectedCanvasKind === 'bn') {
      this.bn.on = this.bn.on ? 0 : 1;
      this.inv();
      this.snap();
      return true;
    }
    if (this.subBoxSelected || this.selectedCanvasKind === 'sub') {
      this.st.on = this.st.on === 0 ? 1 : 0;
      this.inv();
      this.snap();
      return true;
    }
    return false;
  }

  deleteSelectedBlock() {
    if (this.selectedOverlayId) {
      this.mediaOverlays = this.mediaOverlays.filter((o) => o.id !== this.selectedOverlayId);
      this.selectedOverlayId = null;
      this.inv();
      this.snap();
      return true;
    }
    if (this.selectedCanvasKind === 'spk') {
      this.spk.on = 0;
      this.selectedCanvasKind = null;
      this.inv();
      this.snap();
      return true;
    }
    if (this.selectedCanvasKind === 'bn') {
      this.bn.on = 0;
      this.selectedCanvasKind = null;
      this.inv();
      this.snap();
      return true;
    }
    if (this.sel) {
      const sIdx = this.subs.findIndex((s) => s.id === this.sel);
      if (sIdx >= 0) {
        this.subs.splice(sIdx, 1);
        this.sel = null;
        this.inv();
        this.snap();
        return true;
      }
      const tIdx = this.texts.findIndex((x) => x.id === this.sel);
      if (tIdx >= 0) {
        this.texts.splice(tIdx, 1);
        this.sel = null;
        this.inv();
        this.snap();
        return true;
      }
    }
    return false;
  }

  mergeSubByIds(leftId, rightId) {
    const idxA = this.subs.findIndex((x) => x.id === leftId);
    const idxB = this.subs.findIndex((x) => x.id === rightId);
    if (idxA < 0 || idxB < 0 || idxA === idxB) return false;
    const [firstIdx, secondIdx] = this.subs[idxA].s <= this.subs[idxB].s ? [idxA, idxB] : [idxB, idxA];
    const cur = this.subs[firstIdx];
    const nx = this.subs[secondIdx];
    if (!cur || !nx) return false;

    const curW = Array.isArray(cur.words) && cur.words.length ? cur.words : synthWords(cur);
    const nxW = Array.isArray(nx.words) && nx.words.length ? nx.words : synthWords(nx);
    const gapSec = Math.max(0, Math.round((nx.s - cur.e) * 1000) / 1000);

    cur.s = Math.min(cur.s, nx.s);
    cur.rawS = cur.rawS !== undefined ? Math.min(cur.rawS, nx.rawS ?? nx.s) : cur.s;
    cur.e = Math.max(cur.e, nx.e);
    cur.rawE = Math.max(cur.rawE ?? cur.e, nx.rawE ?? nx.e);
    cur.t = (String(cur.t || '').trim() + ' ' + String(nx.t || '').trim()).replace(/\s+/g, ' ').trim();
    if (cur.orig !== undefined || nx.orig !== undefined) {
      cur.orig = (String(cur.orig ?? cur.t).trim() + ' ' + String(nx.orig ?? nx.t).trim()).replace(/\s+/g, ' ').trim();
    }
    if (cur.tr || nx.tr) cur.tr = ((cur.tr || '') + ' ' + (nx.tr || '')).replace(/\s+/g, ' ').trim();
    cur.words = [...curW, ...nxW];
    if (gapSec > 0.05) cur.gapPreservedSec = gapSec;

    this.subs.splice(secondIdx, 1);
    this.sel = cur.id;
    this.inv();
    this.snap();
    return true;
  }

  mergeSubAt(idx) {
    const cur = this.subs[idx];
    const nx = this.subs[idx + 1];
    if (!cur || !nx) return this.toast('No next subtitle to merge');
    return this.mergeSubByIds(cur.id, nx.id);
  }

  /**
   * Minbar-caption style boundary word transfer:
   * Moves last word to next subtitle (dir === 'next') or steals first word from next (dir === 'pull'),
   * adjusting word-level timestamps cleanly!
   */
  transferWord(idx, dir) {
    const a = this.subs[idx];
    const b = this.subs[idx + 1];
    if (!a || !b) return;
    const aw = a.t.trim().split(/\s+/).filter(Boolean);
    const bw = b.t.trim().split(/\s+/).filter(Boolean);
    if (dir === 'next') {
      if (aw.length <= 1) return this.toast('Keep at least 1 word or use Merge');
      const moved = aw.pop();
      bw.unshift(moved);
      const aWs = a.words && a.words.length === aw.length + 1 ? a.words : synthWords(a);
      const movedW = aWs.pop();
      const bWs = b.words && b.words.length === bw.length - 1 ? b.words : synthWords(b);
      if (movedW) bWs.unshift(movedW);
      a.t = aw.join(' ');
      b.t = bw.join(' ');
      if (movedW) {
        a.e = Math.max(a.s + 0.1, movedW.s);
        a.rawE = a.e;
        b.s = Math.min(b.e - 0.1, movedW.s);
        b.rawS = b.s;
      }
      a.words = aWs;
      b.words = bWs;
    } else if (dir === 'prev') {
      if (bw.length <= 1) return this.toast('Next subtitle only has 1 word');
      const moved = bw.shift();
      aw.push(moved);
      const bWs = b.words && b.words.length === bw.length + 1 ? b.words : synthWords(b);
      const movedW = bWs.shift();
      const aWs = a.words && a.words.length === aw.length - 1 ? a.words : synthWords(a);
      if (movedW) aWs.push(movedW);
      a.t = aw.join(' ');
      b.t = bw.join(' ');
      if (movedW) {
        a.e = Math.max(a.e, movedW.e);
        a.rawE = a.e;
        b.s = Math.min(b.e - 0.1, movedW.e);
        b.rawS = b.s;
      }
      a.words = aWs;
      b.words = bWs;
    }
    this.inv();
    this.snap();
  }

  /* ---------- Persistence & Assets ---------- */

  saveAssets() {
    try {
      localStorage.icsAssets = JSON.stringify(
        this.assetLibrary.map(({ id, name, type, path, duration }) => ({
          id,
          name,
          type,
          path,
          duration: duration || 0,
        }))
      );
    } catch {}
  }

  refreshProjects() {
    try {
      const x = JSON.parse(localStorage.getItem(PROJECTS_KEY) || '[]');
      this.projects = Array.isArray(x) ? x : [];
    } catch {
      this.projects = [];
    }
  }

  ovrGet() {
    try {
      return JSON.parse(localStorage.icsOvr || '{}');
    } catch {
      return {};
    }
  }

  async projDir() {
    if (this.dir) return this.dir;
    const T = getTauri();
    const d = new Date();
    const ts = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`;
    const folder = this.activeProjectId || 'Project_' + ts;
    this.dir = await T.path.join(await T.path.documentDir(), 'Insta Clip Studio', 'Projects', folder);
    return this.dir;
  }

  async saveProjectStore(opts = {}) {
    const T = getTauri();
    const name =
      this.projectName.trim() ||
      this.meta?.title ||
      this.file?.name?.replace(/\.[^.]+$/, '') ||
      'Untitled project';
    const id = this.activeProjectId || 'p_' + Date.now();
    if (this.activeProjectId !== id) this.dir = null;
    this.activeProjectId = id;
    const rec = {
      id,
      name,
      updated: Date.now(),
      sourcePath: this.path || null,
      sourceName: this.file?.name || this.meta?.title || '',
      assets: this.assetLibrary.map(({ id: aid, name: an, type, path, duration }) => ({
        id: aid,
        name: an,
        type,
        path,
        duration: duration || 0,
      })),
      state: this.projJson(),
    };
    const lib = [...this.projects];
    const ix = lib.findIndex((x) => x.id === id);
    if (ix >= 0) lib[ix] = rec;
    else lib.unshift(rec);
    try {
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(lib));
      this.projects = lib;
      this.projectName = name;
      this.unsaved = false;
      this.lastSavedAt = Date.now();
      if (opts.bundle !== false && T?.core) {
        // lightweight background bundle check
      }
      if (!opts.quiet) this.toast('Saved project: ' + name);
    } catch (e) {
      if (!opts.quiet) this.toast('Project save warning: ' + (e?.message || e));
    }
    return rec;
  }

  saveApiCfg(cfg) {
    this.API = { ...cfg };
    try {
      localStorage.icsApi = JSON.stringify(this.API);
    } catch {}
  }

  saveTrCfg() {
    try {
      localStorage.icsTr = JSON.stringify(this.TR);
    } catch {}
  }

  saveShortcuts() {
    try {
      localStorage.setItem('icsShortcuts', JSON.stringify(this.shortcuts));
    } catch {}
  }

  shortcutMatch(e, name) {
    const a = [];
    if (e.ctrlKey || e.metaKey) a.push('Ctrl');
    if (e.altKey) a.push('Alt');
    if (e.shiftKey) a.push('Shift');
    let k = e.key;
    if (k === ' ') k = 'Space';
    else if (k.length === 1) k = k.toLowerCase();
    if (!['Control', 'Meta', 'Alt', 'Shift'].includes(k)) a.push(k);
    return a.join('+').toLowerCase() === (this.shortcuts[name] || '').toLowerCase();
  }
}

export const studio = new StudioStore();
