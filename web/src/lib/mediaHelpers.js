import { generateVideoThemes, initFD } from './renderer.js';
import { fmt, studio } from './state.svelte.js';
import { computeWaveformPeaks } from './webPlatform/webAudioTools.js';
import {
  getStorageStats,
  loadMediaFromIdb,
  pickFileWithAccessApi,
  saveMediaToIdb,
  validateMediaFile,
} from './webPlatform/webStorage.js';
import { pickLocalBrowserFile } from './tauriBridge.js';

export const OVERLAY_PRESETS = {
  'center-popup': { label: 'Center Popup', x: 50, y: 48, w: 46, h: 40, fit: 'contain', radius: 18, shadowBlur: 24 },
  'pip-br': { label: 'PiP Bottom-Right', x: 78, y: 74, w: 32, h: 28, fit: 'cover', radius: 22, borderW: 4, borderColor: '#ffffff', shadowBlur: 20 },
  'pip-bl': { label: 'PiP Bottom-Left', x: 22, y: 74, w: 32, h: 28, fit: 'cover', radius: 22, borderW: 4, borderColor: '#ffffff', shadowBlur: 20 },
  'pip-tr': { label: 'PiP Top-Right', x: 78, y: 20, w: 30, h: 26, fit: 'cover', radius: 20, borderW: 4, borderColor: '#ffffff', shadowBlur: 20 },
  'banner-bottom': { label: 'Lower Banner', x: 50, y: 84, w: 92, h: 18, fit: 'contain', radius: 12, borderW: 0, shadowBlur: 12 },
  'banner-top': { label: 'Top Banner', x: 50, y: 12, w: 92, h: 16, fit: 'contain', radius: 12, borderW: 0, shadowBlur: 12 },
  'split-top': { label: 'Split Screen Top', x: 50, y: 25, w: 100, h: 50, fit: 'cover', radius: 0, borderW: 0, shadowBlur: 0 },
  'split-bottom': { label: 'Split Screen Bottom', x: 50, y: 75, w: 100, h: 50, fit: 'cover', radius: 0, borderW: 0, shadowBlur: 0 },
  'logo-corner': { label: 'Logo Corner Stamp', x: 85, y: 10, w: 18, h: 12, fit: 'contain', radius: 8, opacity: 88, borderW: 0, shadowBlur: 6 },
};

export function assetMime(a) {
  const ext = (a.name.split('.').pop() || '').toLowerCase();
  if (a.type === 'image') {
    return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' }[ext] || 'image/png';
  }
  if (a.type === 'audio') {
    return { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg' }[ext] || 'audio/mpeg';
  }
  return { webm: 'video/webm', mov: 'video/quicktime' }[ext] || 'video/mp4';
}

export async function generateAssetThumb(a) {
  if (a.thumbUrl || a.type === 'audio') return a.thumbUrl;
  try {
    const f = await assetFile(a);
    const url = URL.createObjectURL(f);
    if (a.type === 'image') {
      a.thumbUrl = url;
      return url;
    }
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    v.src = url;
    await new Promise((r) => {
      v.onloadeddata = r;
      v.onerror = r;
    });
    if (v.duration > 0) a.duration = v.duration;
    v.currentTime = Math.min(0.5, (v.duration || 1) * 0.15);
    await new Promise((r) => {
      v.onseeked = r;
      setTimeout(r, 400);
    });
    const cv = document.createElement('canvas');
    cv.width = 160;
    cv.height = 90;
    const cx = cv.getContext('2d');
    if (v.videoWidth) {
      cx.drawImage(v, 0, 0, 160, 90);
      a.thumbUrl = cv.toDataURL('image/jpeg', 0.72);
    }
    URL.revokeObjectURL(url);
  } catch {}
  return a.thumbUrl || null;
}

async function refreshStorageStatsSafe() {
  studio.storageStats = await getStorageStats();
}

export async function openVideoFile(f, opts = {}) {
  if (!f || !studio.V) return false;
  const check = validateMediaFile(f, 'video');
  if (!check.ok) {
    studio.toast(check.reason);
    return false;
  }

  const V = studio.V;
  studio.file = f;
  studio.path = opts.handle ? `handle:${f.name}` : `idb:${f.name}`;
  studio.mediaStatus = 'ready';

  const pid = studio.activeProjectId || 'global';
  if (!opts.skipIdbSave) {
    saveMediaToIdb({ projectId: pid, assetId: '__source__', file: f, handle: opts.handle || null, kind: 'video' })
      .then((res) => {
        if (res?.quotaExceeded) studio.toast(res.reason);
        refreshStorageStatsSafe();
      })
      .catch(() => {});
  }

  // Extract timeline waveform peaks cleanly in background without blocking UI
  studio.audioPeaks = [];
  computeWaveformPeaks(f, 320).then((res) => {
    if (studio.file === f && res.peaks?.length) studio.audioPeaks = res.peaks;
  });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    V.onloadedmetadata = () => {
      const preservedTrim = opts.preserveTrim && studio.trimE > studio.trimS;
      studio.dur = Number.isFinite(V.duration) ? V.duration : 0;
      if (!preservedTrim) {
        studio.trimS = 0;
        studio.trimE = studio.dur;
        studio.shots = [{ t: 0, px: 0, py: 0, zoom: 100 }];
        studio.shotIdx = -1;
      }
      studio.playhead = preservedTrim ? studio.trimS : 0;
      V.currentTime = studio.playhead;
      V.loop = !!opts.loop;
      V.muted = !!studio.aud.track;
      if (!studio.aud.track) V.volume = studio.vol / 100;
      if (!preservedTrim) {
        studio.fx.zoom = 100;
        studio.fx.px = studio.fx.py = 0;
      }
      studio.inv();
      if (!opts.quiet) studio.toast('Loaded ' + f.name);
      setTimeout(() => {
        generateVideoThemes();
        if (studio.cam !== 'manual') initFD().then(() => { studio.shotIdx = -1; studio.inv(); });
      }, 0);
      finish(true);
    };
    V.onerror = () => {
      studio.toast('Could not decode video format. Try H.264 MP4 or WebM.');
      finish(false);
    };
    if (studio.videoObjectUrl) try { URL.revokeObjectURL(studio.videoObjectUrl); } catch {}
    studio.videoObjectUrl = URL.createObjectURL(f);
    V.src = studio.videoObjectUrl;
    V.load();
  });
}

export async function pickAndOpenVideo() {
  const native = await pickFileWithAccessApi([
    { description: 'Video files', accept: { 'video/*': ['.mp4', '.webm', '.mov', '.m4v', '.mkv'] } },
  ]);
  if (native?.file) {
    return await openVideoFile(native.file, { handle: native.handle });
  }
  const f = await pickLocalBrowserFile('video/*', false);
  if (f) return await openVideoFile(f);
  return false;
}

export async function importVideoFromUrl(urlStr) {
  const clean = String(urlStr || '').trim();
  if (!clean) throw new Error('Enter a direct MP4/WebM URL.');
  const u = new URL(clean);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only HTTP/HTTPS video URLs are allowed.');
  studio.toast('Fetching remote video (CORS required)…');
  const r = await fetch(clean);
  if (!r.ok) throw new Error(`HTTP ${r.status} while fetching video`);
  const blob = await r.blob();
  const name = u.pathname.split('/').pop() || 'remote_video.mp4';
  const f = new File([blob], name, { type: blob.type || 'video/mp4' });
  return await openVideoFile(f);
}

export async function loadVideoPath() {
  studio.toast('Select local file to open in browser');
  return await pickAndOpenVideo();
}

export async function assetPath(a) {
  return a?.path || `idb:${a?.id || a?.name || 'asset'}`;
}

export async function assetFile(a) {
  if (a?.file instanceof File || a?.file instanceof Blob) return a.file;
  const pid = studio.activeProjectId || 'global';
  const loaded = (await loadMediaFromIdb(pid, a.id)) || (await loadMediaFromIdb('global', a.id));
  if (loaded?.file) {
    a.file = loaded.file;
    a.status = 'ready';
    return loaded.file;
  }
  a.status = loaded?.status || 'missing';
  throw new Error(`Media "${a.name}" needs relinking in this browser.`);
}

export async function assetImage(a) {
  if (a.img) return a.img;
  const f = await assetFile(a);
  const url = URL.createObjectURL(f);
  a.url = url;
  a.img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Could not load image asset.'));
    i.src = url;
  });
  return a.img;
}

export async function activateAudioAsset(a) {
  const path = await assetPath(a);
  const file = await assetFile(a);
  studio.aud.track = path;
  studio.aud.trackName = a.name;
  studio.activeAudioFile = file;
  if (studio.activeAudioUrl) try { URL.revokeObjectURL(studio.activeAudioUrl); } catch {}
  studio.activeAudioUrl = URL.createObjectURL(file);
  const A = studio.A;
  A.pause();
  A.src = studio.activeAudioUrl;
  A.load();
  const d = await new Promise((resolve) => {
    const el = new Audio();
    el.preload = 'metadata';
    el.onloadedmetadata = () => resolve(Number.isFinite(el.duration) ? el.duration : 0);
    el.onerror = () => resolve(0);
    el.src = studio.activeAudioUrl;
    el.load();
  });
  if (d > 0) a.duration = d;
  studio.audioDuration = d || 0;
  if (!studio.V?.src && d > 0) {
    studio.dur = d;
    studio.trimS = 0;
    studio.trimE = d;
  }
  if (!studio.V?.src) {
    computeWaveformPeaks(file, 320).then((res) => {
      if (res.peaks?.length) studio.audioPeaks = res.peaks;
    });
  }
  if (studio.V?.src) studio.V.muted = true;
  studio.saveAssets();
  studio.inv();
  return d;
}

export async function addAssetPath() {
  const f = await pickLocalBrowserFile('image/*,video/*,audio/*', false);
  if (!f) return null;
  const v = validateMediaFile(f);
  if (!v.ok) {
    studio.toast(v.reason);
    return null;
  }
  return await addAssetFile(f, v.kind);
}

export async function addAssetFile(file, type, opts = {}) {
  const v = validateMediaFile(file, type);
  if (!v.ok) {
    studio.toast(v.reason);
    return null;
  }
  const kind = type || v.kind;
  const a = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    name: file.name,
    type: kind,
    path: `idb:${file.name}`,
    duration: 0,
    file,
    img: null,
    url: null,
    thumbUrl: null,
    status: 'ready',
  };
  studio.assetLibrary.unshift(a);

  const pid = studio.activeProjectId || 'global';
  saveMediaToIdb({ projectId: pid, assetId: a.id, file, handle: opts.handle || null, kind }).then(() =>
    refreshStorageStatsSafe()
  );

  if (kind === 'audio') await activateAudioAsset(a);
  else await generateAssetThumb(a);
  studio.saveAssets();
  return a;
}

export async function relinkAsset(a, file) {
  if (!a || !file) return false;
  const pid = studio.activeProjectId || 'global';
  a.file = file;
  a.status = 'ready';
  await saveMediaToIdb({ projectId: pid, assetId: a.id, file, kind: a.type });
  if (a.type === 'audio' && studio.aud.trackName === a.name) await activateAudioAsset(a);
  else await generateAssetThumb(a);
  studio.missingAssets = studio.missingAssets.filter((x) => x !== a.id);
  studio.saveAssets();
  studio.inv();
  return true;
}

export async function ensureMediaNode(o) {
  if (studio.mediaNodes.has(o.id)) return studio.mediaNodes.get(o.id);
  let a = studio.assetLibrary.find((x) => x.id === o.assetId || x.path === o.path);
  if (!a) {
    a = { id: o.assetId || o.id, name: o.name, type: o.type, path: o.path, duration: 0, file: null, img: null, url: null, status: 'missing' };
    studio.assetLibrary.push(a);
    studio.saveAssets();
  }
  const f = await assetFile(a);
  const url = URL.createObjectURL(f);
  if (o.type === 'image') {
    const el = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not load overlay image'));
      i.src = url;
    });
    const rec = { el, url };
    studio.mediaNodes.set(o.id, rec);
    return rec;
  }
  const el = document.createElement('video');
  el.preload = 'auto';
  el.muted = o.mute !== false;
  el.playsInline = true;
  el.loop = o.loop !== false;
  el.onseeked = () => studio.inv();
  el.src = url;
  el.load();
  await new Promise((resolve, reject) => {
    if (el.readyState >= 1) return resolve();
    el.onloadedmetadata = () => resolve();
    el.onerror = () => reject(new Error('Could not load overlay video'));
  });
  const rec = { el, url };
  studio.mediaNodes.set(o.id, rec);
  return rec;
}

export async function createOverlayFromAsset(asset, presetKey = 'center-popup') {
  const pre = OVERLAY_PRESETS[presetKey] || OVERLAY_PRESETS['center-popup'];
  const p = await assetPath(asset);
  const start = studio.currentPlayhead();
  const totalD = studio.dur || studio.audioDuration || 30;
  const span = asset.type === 'video' && asset.duration > 0 ? Math.min(asset.duration, totalD - start) : Math.max(2, totalD - start);
  const o = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    assetId: asset.id,
    name: asset.name,
    type: asset.type,
    path: p,
    start: +start.toFixed(2),
    end: +Math.min(totalD, start + Math.max(0.5, span)).toFixed(2),
    x: pre.x,
    y: pre.y,
    w: pre.w,
    h: pre.h,
    opacity: pre.opacity ?? 100,
    fit: pre.fit || 'contain',
    blend: 'source-over',
    radius: pre.radius ?? 12,
    borderW: pre.borderW ?? 0,
    borderColor: pre.borderColor || '#ffffff',
    shadowBlur: pre.shadowBlur ?? 12,
    fadeMs: 200,
    loop: true,
    mute: true,
  };
  studio.mediaOverlays.push(o);
  studio.selectedOverlayId = o.id;
  await ensureMediaNode(o);
  studio.inv();
  studio.snap();
  return o;
}

export async function transcriptionFile() {
  if (studio.activeAudioFile) return studio.activeAudioFile;
  if (studio.aud.trackName) {
    const a = studio.assetLibrary.find((x) => x.name === studio.aud.trackName && x.type === 'audio');
    if (a) return await assetFile(a);
  }
  return studio.file;
}

export async function transcriptionPath() {
  return studio.aud.track || studio.path || '';
}

export async function transcriptionDuration() {
  if (studio.audioDuration > 0) return studio.audioDuration;
  return studio.dur || undefined;
}

export async function createTimedBackground(imageAsset) {
  if (!studio.aud.track || !studio.audioDuration) throw new Error('Import an audio file first.');
  const img = await assetImage(imageAsset);
  studio.fgImg = img;
  studio.fg.mode = 'image';
  studio.fg.assetId = imageAsset.id;
  studio.fg.assetPath = imageAsset.name;
  studio.dur = studio.audioDuration;
  studio.trimS = 0;
  studio.trimE = studio.audioDuration;
  studio.inv();
  studio.snap();
  studio.toast(`Static background paired with audio (${fmt(studio.dur)})`);
}

export async function createLoopedVideo(videoAsset) {
  if (!studio.aud.track || !studio.audioDuration) throw new Error('Import an audio file first.');
  const f = await assetFile(videoAsset);
  const ok = await openVideoFile(f, { loop: true, quiet: true });
  if (!ok) return;
  studio.dur = studio.audioDuration;
  studio.trimS = 0;
  studio.trimE = studio.audioDuration;
  studio.fg.mode = 'video';
  if (studio.V) studio.V.muted = true;
  studio.inv();
  studio.snap();
  studio.toast('Looped background video synced with audio track');
}
