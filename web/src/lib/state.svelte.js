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
import { applySubtitlePadding, synthWords } from './prompts.js';
import { getTauri } from './tauriBridge.js';
import { fetchServerHealth } from './webPlatform/webAiClient.js';
import { getBrowserCapabilities } from './webPlatform/webExportEngine.js';
import { deleteProjectMediaFromIdb, getStorageStats } from './webPlatform/webStorage.js';

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
  inspectorTab = $state('auto'); // 'auto' | 'subtitles' | 'canvas' | 'overlays' | 'export'
  previewZoom = $state(1);
  homeOpen = $state(true);

  // Toast, Confirm & UI Overlays
  toastMsg = $state('');
  apiModalOpen = $state(false);
  colorPicker = $state({ open: false, x: 100, y: 100, hex: '#ffffff', onChange: null });
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
  hov = $state(0);
  hoverLayer = $state(null);
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
  duSourceBox = null;
  duTransBox = null;

  // Assets, Environment, AI Configs, History & Web Runtime
  platform = 'web';
  assetLibrary = $state([]);
  projects = $state([]);
  env = $state(null);
  caps = $state(null);
  serverHealth = $state(null);
  storageStats = $state(null);
  mediaStatus = $state('none'); // 'none' | 'ready' | 'missing' | 'permission-needed'
  audioPeaks = $state([]);
  missingAssets = $state([]);
  fdOk = $state(true);
  shortcuts = $state({ ...SHORTCUT_DEFAULTS });
  API = $state({ prov: 'gemini', url: PROV.gemini[0], key: '', model: PROV.gemini[1] });
  TR = $state({ ...TR0 });

  // Non-reactive media DOM references & caches
  V = null;
  A = null;
  C = null;
  activeAudioFile = null;
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
        this.shortcuts = { ...SHORTCUT_DEFAULTS, ...JSON.parse(localStorage.getItem('icsShortcuts') || '{}') };
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
      this.refreshWebRuntime();
    }
  }

  async refreshWebRuntime() {
    const [caps, health, stats] = await Promise.all([
      getBrowserCapabilities().catch(() => null),
      fetchServerHealth().catch(() => null),
      getStorageStats().catch(() => null),
    ]);
    this.caps = caps;
    this.serverHealth = health;
    this.storageStats = stats;
  }

  hasAiAccess(prov = this.API?.prov || 'gemini') {
    if (prov === 'ollama') return true;
    if ((this.API?.key || '').trim()) return true;
    return !!this.serverHealth?.providers?.[prov];
  }

  hasAsrAccess(engine = 'elevenlabs') {
    const ovr = this.ovrGet();
    if (engine === 'elevenlabs') return !!(ovr.elevenlabs_key || this.serverHealth?.providers?.elevenlabs);
    return !!(ovr.openai_key || this.API?.key || this.serverHealth?.providers?.openai);
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
    return String(txt || '')
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
  }

  rewrapAndPad() {
    if (!this.subs.length) return this.toast('No subtitles to re-wrap');
    const maxC = Math.max(0, Number(this.subCfg.maxChars) || 0);
    const maxW = Math.max(0, Number(this.subCfg.maxWords) || 0);
    const maxD = Math.max(0, Number(this.subCfg.maxDur) || 0);
    const padB = Math.max(0, Number(this.subCfg.padBeforeMs) || 0);
    const padA = Math.max(0, Number(this.subCfg.padAfterMs) || 0);

    const sorted = [...this.subs].sort((a, b) => (a.rawS ?? a.s) - (b.rawS ?? b.s));
    let nextSubs = [];
    if (maxC > 0 || maxW > 0 || maxD > 0) {
      // Dynamically flatten then re-split cleanly using word timestamps
      for (const o of sorted) {
        const bs = o.rawS ?? o.s;
        const be = o.rawE ?? o.e;
        const text = o.orig !== undefined ? o.orig : o.t;
        const ws = o.words && o.words.length ? o.words : synthWords({ s: bs, e: be, t: text });
        if (!ws.length) {
          nextSubs.push({ ...o, rawS: bs, rawE: be });
          continue;
        }
        // Inline split matching splitByLimits
        let cur = [];
        const flush = () => {
          if (!cur.length) return;
          const rs = cur[0].s;
          const re = cur[cur.length - 1].e;
          nextSubs.push({
            id: this.nextId(),
            s: rs,
            e: re,
            rawS: rs,
            rawE: re,
            t: cur.map((w) => w.w).join(' '),
            words: cur.map((w) => ({ w: w.w, s: w.s, e: w.e })),
          });
          cur = [];
        };
        for (const w of ws) {
          const nextTxt = [...cur.map((x) => x.w), w.w].join(' ');
          const overC = maxC > 0 && nextTxt.length > maxC;
          const overW = maxW > 0 && cur.length + 1 > maxW;
          const overD = maxD > 0 && cur.length > 0 && w.e - cur[0].s > maxD;
          if (cur.length && (overC || overW || overD)) flush();
          cur.push(w);
        }
        flush();
      }
    } else {
      nextSubs = sorted.map((o) => ({ ...o }));
    }

    this.subs = applySubtitlePadding(nextSubs, padB, padA, this.dur || this.audioDuration || 0);
    this.inv();
    this.snap();
    this.toast(`Updated ${this.subs.length} subtitles (max ${maxW || '∞'}w · pad −${padB}/+${padA}ms)`);
  }

  mergeSubAt(idx) {
    const cur = this.subs[idx];
    const nx = this.subs[idx + 1];
    if (!cur || !nx) return this.toast('No next subtitle to merge');
    cur.e = Math.max(cur.e, nx.e);
    cur.rawE = nx.rawE ?? nx.e;
    cur.t = (cur.t + ' ' + nx.t).replace(/\s+/g, ' ').trim();
    if (cur.orig !== undefined || nx.orig !== undefined) {
      cur.orig = ((cur.orig ?? cur.t) + ' ' + (nx.orig ?? nx.t)).trim();
    }
    if (cur.tr || nx.tr) cur.tr = ((cur.tr || '') + ' ' + (nx.tr || '')).trim();
    if (cur.words && nx.words) cur.words = [...cur.words, ...nx.words];
    this.subs.splice(idx + 1, 1);
    this.inv();
    this.snap();
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
    const d = new Date();
    const ts = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`;
    return this.activeProjectId || 'Project_' + ts;
  }

  async deleteProject(id) {
    this.projects = this.projects.filter((p) => p.id !== id);
    try {
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(this.projects));
    } catch {}
    await deleteProjectMediaFromIdb(id);
    if (this.activeProjectId === id) {
      this.activeProjectId = null;
      this.projectName = '';
    }
    this.storageStats = await getStorageStats().catch(() => null);
  }

  async saveProjectStore(opts = {}) {
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
      hasMediaBlob: !!this.file,
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
      if (!opts.quiet) this.toast('Saved locally in browser: ' + name);
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
