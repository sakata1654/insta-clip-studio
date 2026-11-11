import { ensureSourcePath, generateVideoThemes, initFD, writeBlobToPath } from './renderer.js';
import { fmt, studio } from './state.svelte.js';
import { getTauri } from './tauriBridge.js';

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

export function openVideoFile(f, path = null) {
  if (!f || !studio.V) return Promise.resolve(false);
  const V = studio.V;
  studio.file = f;
  studio.path = path || null;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    V.onloadedmetadata = () => {
      studio.dur = Number.isFinite(V.duration) ? V.duration : 0;
      studio.trimS = 0;
      studio.trimE = studio.dur;
      studio.playhead = 0;
      V.currentTime = 0;
      V.muted = !!studio.aud.track;
      if (!studio.aud.track) V.volume = studio.vol / 100;
      studio.shots = [{ t: 0, px: 0, py: 0, zoom: 100 }];
      studio.shotIdx = -1;
      studio.fx.zoom = 100;
      studio.fx.px = studio.fx.py = 0;
      studio.inv();
      studio.toast('Loaded ' + f.name);
      setTimeout(() => {
        generateVideoThemes();
        if (studio.cam !== 'manual') initFD().then(() => { studio.shotIdx = -1; studio.inv(); });
      }, 0);
      finish(true);
    };
    V.onerror = () => {
      studio.toast('Could not open video format. Try MP4 or WebM.');
      finish(false);
    };
    if (studio.videoObjectUrl) try { URL.revokeObjectURL(studio.videoObjectUrl); } catch {}
    studio.videoObjectUrl = URL.createObjectURL(f);
    V.src = studio.videoObjectUrl;
    V.load();
  });
}

export async function loadVideoPath(p) {
  const T = getTauri();
  studio.toast('Loading video…');
  const buf = await T.core.invoke('read_file', { path: p });
  const n = p.split(/[\\/]/).pop();
  return await openVideoFile(new File([buf], n, { type: /\.webm$/i.test(n) ? 'video/webm' : 'video/mp4' }), p);
}

export async function assetPath(a) {
  if (a.path) return a.path;
  const T = getTauri();
  if (!T?.core || !a.file) throw new Error('Asset has no readable file path.');
  const ext = (a.name.match(/\.\w+$/) || [''])[0];
  const safe = a.name.replace(/[^a-z0-9._-]+/gi, '_');
  const p = await T.path.join(await T.path.tempDir(), `ics_asset_${a.id}_${safe || 'asset' + ext}`);
  await writeBlobToPath(p, a.file);
  a.path = p;
  studio.saveAssets();
  return p;
}

export async function assetFile(a) {
  if (a.file) return a.file;
  const T = getTauri();
  const raw = await T.core.invoke('read_file', { path: a.path });
  a.file = new File([raw], a.name, { type: assetMime(a) });
  return a.file;
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
  studio.aud.track = path;
  studio.aud.trackName = a.name;
  try {
    localStorage.icsAudioTrack = path;
    localStorage.icsAudioName = a.name;
  } catch {}
  const file = await assetFile(a);
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
  if (studio.V?.src) studio.V.muted = true;
  studio.saveAssets();
  studio.inv();
  return d;
}

export async function addAssetPath(path, type) {
  const name = path.split(/[\\/]/).pop();
  const old = studio.assetLibrary.find((a) => a.path === path);
  if (old) {
    if (type === 'audio') await activateAudioAsset(old);
    return old;
  }
  const a = { id: Date.now() + Math.floor(Math.random() * 1000), name, type, path, duration: 0, file: null, img: null, url: null, thumbUrl: null };
  studio.assetLibrary.unshift(a);
  if (type === 'audio') await activateAudioAsset(a);
  else await generateAssetThumb(a);
  studio.saveAssets();
  return a;
}

export async function addAssetFile(file, type) {
  const a = { id: Date.now() + Math.floor(Math.random() * 1000), name: file.name, type, path: null, duration: 0, file, img: null, url: null, thumbUrl: null };
  studio.assetLibrary.unshift(a);
  if (type === 'audio') await activateAudioAsset(a);
  else await generateAssetThumb(a);
  studio.saveAssets();
  return a;
}

export async function ensureMediaNode(o) {
  if (studio.mediaNodes.has(o.id)) return studio.mediaNodes.get(o.id);
  let a = studio.assetLibrary.find((x) => x.path === o.path || x.id === o.assetId);
  if (!a) {
    a = { id: o.id, name: o.name, type: o.type, path: o.path, duration: 0, file: null, img: null, url: null };
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
  const p = asset.file ? await assetPath(asset) : asset.path;
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

export async function transcriptionPath() {
  if (studio.aud.track) {
    const a = studio.assetLibrary.find((x) => x.path === studio.aud.track);
    if (a) return await assetPath(a);
    return studio.aud.track;
  }
  return await ensureSourcePath();
}

export async function transcriptionDuration() {
  const T = getTauri();
  if (studio.aud.track) {
    const a = studio.assetLibrary.find((x) => x.path === studio.aud.track);
    if (a?.duration > 0) return a.duration;
    try {
      const d = await T.core.invoke('media_duration', { path: studio.aud.track });
      if (Number.isFinite(d) && d > 0) return d;
    } catch {}
    return studio.dur || undefined;
  }
  return studio.dur || undefined;
}

export async function createTimedBackground(imageAsset) {
  const T = getTauri();
  if (!studio.aud.track) throw new Error('Add an audio file first.');
  const imagePath = await assetPath(imageAsset);
  const duration = await transcriptionDuration();
  if (!duration || !Number.isFinite(duration)) throw new Error('Could not determine audio duration.');
  const out = await T.path.join(await T.path.tempDir(), `ics_bg_${Date.now()}.mp4`);
  await T.core.invoke('make_background_video', { image: imagePath, audio: studio.aud.track, duration, width: studio.LW, height: studio.LH, out });
  await loadVideoPath(out);
  studio.fgImg = await assetImage(imageAsset);
  studio.fg.mode = 'image';
  studio.fg.assetPath = imagePath;
  studio.inv();
  studio.toast(`Ready: ${imageAsset.name} (${fmt(duration)})`);
}

export async function createLoopedVideo(videoAsset) {
  const T = getTauri();
  if (!studio.aud.track) throw new Error('Add/select an MP3 first.');
  const videoPath = await assetPath(videoAsset);
  const duration = await transcriptionDuration();
  const out = await T.path.join(await T.path.tempDir(), `ics_loop_${Date.now()}.mp4`);
  await T.core.invoke('make_looped_background_video', { video: videoPath, duration, width: studio.LW, height: studio.LH, out });
  await loadVideoPath(out);
  studio.fg.mode = 'video';
  studio.fg.assetPath = out;
  if (studio.V) studio.V.muted = true;
  studio.inv();
  studio.toast('Looped background ready');
}
