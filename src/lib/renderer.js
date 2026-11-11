import { recordTrimAdjustment } from './aiClipTrainer.js';
import { AMIRI } from './constants.js';
import { cl, fts, hex2, rgb2hex, rgba, studio } from './state.svelte.js';
import { getTauri } from './tauriBridge.js';

const TH_DEF = { bg: '#140f87', accent: '#ffd700', banner: '#0f0a64' };
const clean = (t) =>
  String(t || '')
    .replace(/\s+([\u064B-\u0652])/g, '$1')
    .replace(/([\u064E\u064F\u0610])([\u0651])/g, '$2$1');
const isRtl = (t) => /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(t || '');

const wc = new Map();
const avatarCache = new Map();
let FD = null;
let fdPromise = null;
let lastFace = 0;

function getAvatarImg(src) {
  if (!src || typeof Image === 'undefined') return null;
  let rec = avatarCache.get(src);
  if (!rec) {
    rec = { img: new Image(), ready: false };
    rec.img.onload = () => {
      rec.ready = true;
      studio.inv();
    };
    rec.img.src = src;
    avatarCache.set(src, rec);
  }
  return rec.ready ? rec.img : null;
}

// Lazily initialized scratch canvases so SSR/Node unit tests can still import pure helpers
let bc = null;
let bx = null;
const GRN = [];
let gi = 0;

function ensureScratch() {
  if (!bc && typeof document !== 'undefined') {
    bc = document.createElement('canvas');
    bc.width = 108;
    bc.height = 192;
    bx = bc.getContext('2d');
    for (let i = 0; i < 4; i++) {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const x = c.getContext('2d');
      const d = x.createImageData(256, 256);
      for (let j = 0; j < d.data.length; j += 4) {
        d.data[j] = d.data[j + 1] = d.data[j + 2] = 128 + (Math.random() + Math.random() + Math.random() - 1.5) * 70;
        d.data[j + 3] = 255;
      }
      x.putImageData(d, 0, 0);
      GRN.push(c);
    }
  }
}

export function resizeScratch(LW, LH) {
  ensureScratch();
  if (!bc) return;
  bc.width = Math.max(32, Math.round(LW / 10));
  bc.height = Math.round((bc.width * LH) / LW);
}

const rr = (X, x, y, w, h, r) => {
  X.beginPath();
  X.roundRect(x, y, Math.max(1, w), Math.max(1, h), Math.max(0, Math.min(r, w / 2, h / 2)));
};

function wrapText(X, txt, maxW) {
  const out = [];
  for (const para of String(txt || '').split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/)) {
      const t = line ? line + ' ' + w : w;
      if (X.measureText(t).width > maxW && line) {
        out.push(line);
        line = w;
      } else {
        line = t;
      }
    }
    out.push(line);
  }
  return out;
}

function measureLines(X, txt, font, maxW, ls = 0) {
  const k = font + '|' + maxW + '|' + ls + '|' + txt;
  let r = wc.get(k);
  if (!r) {
    X.font = font;
    X.letterSpacing = ls + 'px';
    const L = wrapText(X, txt, maxW);
    r = { L, W: Math.max(1, ...L.map((l) => X.measureText(l).width)) };
    X.letterSpacing = '0px';
    if (wc.size > 400) wc.clear();
    wc.set(k, r);
  }
  return r;
}

function prep(X, o, txt, maxW, fit) {
  txt = clean(o.upper ? txt.toUpperCase() : txt);
  let size = o.size;
  let font;
  let r;
  const hasFit = fit && fit.max > 0;
  for (;;) {
    font = `${o.bold ? '700 ' : ''}${size}px ${o.font}`;
    r = measureLines(X, txt, font, maxW, isRtl(txt) ? 0 : o.ls || 0);
    if (!hasFit || r.L.length <= fit.max || size - fit.step < fit.min) break;
    size -= fit.step;
  }
  return { font, size, L: r.L, W: r.W, ls: isRtl(txt) ? 0 : o.ls || 0 };
}

function paint(X, LW, sc, o, p, x, y, lhk = 1.2, alpha = 1, hl = null) {
  const { L, W, font, size } = p;
  const lh = size * lhk;
  const H = L.length * lh;
  const box = o.bga > 0;
  const padX = Math.max(0, Number(o.padX ?? Math.round(size * 0.32)));
  const padY = Math.max(0, Number(o.padY ?? Math.round(size * 0.18)));
  const boxR = Math.max(0, Number(o.boxR ?? Math.round(size * 0.22)));
  const align = o.align || 'center';
  const rtl = isRtl(L.join(''));
  const edgePad = LW * (cl(Number(o.marginX ?? 6), 0, 25) / 100);
  const drawX = align === 'left' ? Math.max(edgePad, x - W / 2) : align === 'right' ? Math.min(LW - edgePad, x + W / 2) : x;

  X.font = font;
  X.textAlign = align;
  X.textBaseline = 'middle';
  X.lineJoin = 'round';
  X.direction = rtl ? 'rtl' : 'ltr';
  X.letterSpacing = (p.ls || 0) + 'px';
  X.globalAlpha = alpha;

  const sh = () => {
    if (o.shadow && o.sha > 0) {
      X.shadowColor = rgba(o.shc, o.sha / 100);
      X.shadowBlur = o.shb * sc;
      X.shadowOffsetX = o.shx * sc;
      X.shadowOffsetY = o.shy * sc;
    }
  };
  const nosh = () => {
    X.shadowColor = 'transparent';
    X.shadowBlur = 0;
    X.shadowOffsetX = 0;
    X.shadowOffsetY = 0;
  };

  if (box && o.boxMode !== 'line') {
    const bw = Math.min(LW - edgePad * 2, W + padX * 2);
    const bh = H + padY * 2;
    const bx0 = cl(x - bw / 2, edgePad, LW - edgePad - bw);
    const by0 = y - bh / 2;
    sh();
    X.globalAlpha = (alpha * o.bga) / 100;
    X.fillStyle = o.bg;
    rr(X, bx0, by0, bw, bh, boxR);
    X.fill();
    X.globalAlpha = alpha;
    nosh();
  }

  let wi = 0;
  for (let i = 0; i < L.length; i++) {
    const yy = y - H / 2 + lh * (i + 0.5);
    const lineW = X.measureText(L[i]).width;
    if (box && o.boxMode === 'line' && L[i].trim()) {
      const lbw = Math.min(LW - edgePad * 2, lineW + padX * 2);
      const lbh = lh + padY * 0.65;
      const lbx = align === 'left' ? drawX - padX : align === 'right' ? drawX - lineW - padX : x - lbw / 2;
      sh();
      X.globalAlpha = (alpha * o.bga) / 100;
      X.fillStyle = o.bg;
      rr(X, cl(lbx, edgePad / 2, LW - edgePad / 2 - lbw), yy - lbh / 2, lbw, lbh, boxR);
      X.fill();
      X.globalAlpha = alpha;
      nosh();
    }
    if (hl && !rtl) {
      const toks = L[i].split(' ');
      let cx = align === 'left' ? drawX : align === 'right' ? drawX - lineW : x - lineW / 2;
      X.textAlign = 'left';
      for (const tk of toks) {
        const tkW = X.measureText(tk).width;
        const isAct = wi === hl.idx;
        if (isAct && o.hlStyle === 'pill') {
          X.save();
          X.fillStyle = hl.color;
          X.globalAlpha = alpha * 0.9;
          rr(X, cx - 8, yy - size * 0.62, tkW + 16, size * 1.24, Math.min(boxR, 14));
          X.fill();
          X.restore();
        }
        const col = isAct ? (o.hlStyle === 'pill' ? '#111111' : hl.color) : o.color;
        if (o.sw > 0) {
          if (!box) sh();
          X.lineWidth = o.sw;
          X.strokeStyle = o.stroke;
          X.strokeText(tk, cx, yy);
          nosh();
        }
        if (!box && !(o.sw > 0)) sh();
        X.fillStyle = col;
        X.fillText(tk, cx, yy);
        nosh();
        cx += X.measureText(tk + ' ').width;
        wi++;
      }
      X.textAlign = align;
    } else {
      if (o.sw > 0) {
        if (!box) sh();
        X.lineWidth = o.sw;
        X.strokeStyle = o.stroke;
        X.strokeText(L[i], drawX, yy);
        nosh();
      }
      if (!box && !(o.sw > 0)) sh();
      X.fillStyle = o.color;
      X.fillText(L[i], drawX, yy);
      nosh();
    }
  }

  X.globalAlpha = 1;
  X.direction = 'ltr';
  X.letterSpacing = '0px';
  X.textAlign = 'center';
  return { x: cl(x - W / 2 - padX, 0, LW), y: Math.max(0, y - H / 2 - padY), w: Math.min(LW, W + padX * 2), h: H + padY * 2 };
}

function getSrc(S = studio) {
  if (S.fg.mode === 'image' && S.fgImg) {
    return { el: S.fgImg, w: S.fgImg.naturalWidth, h: S.fgImg.naturalHeight };
  }
  const V = S.V;
  return { el: V, w: V?.videoWidth || 0, h: V?.videoHeight || 0 };
}

export function vg(w, h, z, S = studio) {
  const s = getSrc(S);
  if (!s.w || !s.h) return [w * z, h * z];
  const vr = s.w / s.h;
  let dw;
  let dh;
  if (vr > w / h) {
    dh = h;
    dw = h * vr;
  } else {
    dw = w;
    dh = w / vr;
  }
  return [dw * z, dh * z];
}

function vid(c, x, y, w, h, z, px, py, S = studio) {
  const s = getSrc(S);
  if (!s.el || !s.w) return;
  const [dw, dh] = vg(w, h, z, S);
  const mx = (dw - w) / 2;
  const my = (dh - h) / 2;
  c.drawImage(
    s.el,
    x + (w - dw) / 2 + Math.max(-mx, Math.min(mx, (w * px) / 100)),
    y + (h - dh) / 2 + Math.max(-my, Math.min(my, (h * py) / 100)),
    dw,
    dh
  );
}

const blendHex = (a, b, f) => {
  const p = hex2(a);
  const q = hex2(b);
  return rgb2hex(p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f);
};

export function themeAt(t, S = studio) {
  const T = S.themes;
  if (!T.length) return TH_DEF;
  const base = T[Math.min(S.theme, T.length - 1)];
  if (!S.shift || T.length < 2) return base;
  const p = Math.min(0.999, Math.max(0, (t - S.trimS) / Math.max(1, S.trimE - S.trimS))) * (T.length - 1);
  const i = Math.floor(p);
  const f = p - i;
  return {
    bg: blendHex(T[i].bg, T[i + 1].bg, f),
    accent: blendHex(T[i].accent, T[i + 1].accent, f),
    banner: blendHex(T[i].banner, T[i + 1].banner, f),
  };
}

export async function initFD() {
  if (FD || fdPromise) return fdPromise || FD;
  fdPromise = (async () => {
    try {
      const visionUrl = '/vendor/vision_bundle.mjs';
      const m = await import(/* @vite-ignore */ visionUrl);
      const fs = await m.FilesetResolver.forVisionTasks('/vendor/wasm');
      FD = await m.FaceDetector.createFromOptions(fs, {
        baseOptions: { modelAssetPath: '/vendor/blaze_face_short_range.tflite' },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.3,
      });
      studio.fdOk = true;
      return FD;
    } catch (e) {
      console.warn('Face detector unavailable', e);
      studio.fdOk = false;
      fdPromise = null;
      return null;
    }
  })();
  return fdPromise;
}

function detectFace(S = studio) {
  const V = S.V;
  if (!FD || !V?.videoWidth || V.readyState < 2) return null;
  try {
    const d = FD.detectForVideo(V, performance.now()).detections;
    if (!d || !d.length) return null;
    const b = d.reduce((a, c) =>
      c.boundingBox.width * c.boundingBox.height > a.boundingBox.width * a.boundingBox.height ? c : a
    ).boundingBox;
    return { u: (b.originX + b.width / 2) / V.videoWidth, v: (b.originY + b.height * 0.35) / V.videoHeight, box: b };
  } catch {
    return null;
  }
}

function aim(f, w, h, z, S = studio) {
  const [dw, dh] = vg(w, h, z, S);
  const ox = w * 0.5 - (w - dw) / 2 - f.u * dw;
  const oy = h * 0.45 - (h - dh) / 2 - f.v * dh;
  const mx = (dw - w) / 2 / w * 100;
  const my = (dh - h) / 2 / h * 100;
  return [cl((ox / w) * 100, -mx, mx), cl((oy / h) * 100, -my, my)];
}

export function autoCenter(force, S = studio) {
  const s = S.shots[Math.max(0, S.shotIdx)];
  if (!s || S.fg.mode === 'image') return;
  if (!force && (s.set || S.cam !== 'auto')) return;
  const f = detectFace(S);
  if (!f) return;
  const [px, py] = aim(f, S.frW || S.LW, S.frH || S.LH, S.fx.zoom / 100, S);
  S.fx.px = px;
  S.fx.py = py;
  S.saveShot?.();
  S.inv?.();
}

function hdSpecs(X, ms, ss, S = studio) {
  const secs = S.hd.text.split('|').map((s) => s.trim()).filter(Boolean);
  const out = [];
  secs.forEach((t, i) => {
    let size = i ? ss : ms;
    let font;
    let r;
    const txt = clean(t);
    for (;;) {
      font = `700 ${size}px ${S.hd.font || 'Arial'}, ${AMIRI}`;
      r = measureLines(X, txt, font, S.LW - 160);
      if (r.L.length <= 3 || size - 4 < 34) break;
      size -= 4;
    }
    r.L.forEach((l) => out.push({ l, font, lh: size * 1.25 }));
  });
  return { out, H: out.reduce((a, b) => a + b.lh, 0) };
}

export function hdPlace(S = studio) {
  const h = S.hd;
  if (!h.on || !h.auto || !h.text.trim() || !S.C) return;
  const X = S.C.getContext('2d', { alpha: false });
  const k = h.scale / 100;
  const W = S.LW;
  const H = S.LH;
  h.ay = 0.6;
  h.am = h.s1 * k;
  h.as = h.s2 * k;
  const f = detectFace(S);
  if (!f) return;
  const b = f.box;
  const s = getSrc(S);
  const fb = S.frBox || { x: 0, y: 0, w: W, h: H };
  const [dw, dh] = vg(fb.w, fb.h, S.fx.zoom / 100, S);
  const my = (dh - fb.h) / 2;
  const oy = fb.y + (fb.h - dh) / 2 + Math.max(-my, Math.min(my, (fb.h * S.fx.py) / 100));
  const ft = oy + (b.originY * dh) / s.h;
  const fbm = oy + ((b.originY + b.height) * dh) / s.h;
  const top = 60;
  const bot = H - (S.wm.on ? 150 : 60);
  const mg = 45;
  let last = null;
  for (let m = h.s1 * k; m >= 34; m -= 8) {
    const ss = Math.max(34, h.s2 * k - (h.s1 * k - m));
    const { H: rq } = hdSpecs(X, m, ss, S);
    last = { m, ss, rq };
    if (bot - (fbm + mg) >= rq) {
      h.ay = (fbm + mg + rq / 2) / H;
      h.am = m;
      h.as = ss;
      return;
    }
    if (ft - mg - top >= rq) {
      h.ay = (top + rq / 2) / H;
      h.am = m;
      h.as = ss;
      return;
    }
  }
  if (last) {
    h.ay = (fbm + mg + last.rq / 2) / H;
    h.am = last.m;
    h.as = last.ss;
  }
}

function shotSync(t, S = studio) {
  let i = 0;
  for (let k = 0; k < S.shots.length; k++) if (S.shots[k].t <= t + 0.001) i = k;
  if (i === S.shotIdx) return;
  S.shotIdx = i;
  const s = S.shots[i];
  if (s) {
    S.fx.px = s.px;
    S.fx.py = s.py;
    S.fx.zoom = s.zoom;
  }
  if (S.cam === 'auto' && s && !s.set) autoCenter(false, S);
  hdPlace(S);
}

function partFor(a, t) {
  if (!a.t.includes('|')) return [a.t, a.s];
  const ps = a.t.split('|').map((s) => s.trim()).filter(Boolean);
  if (ps.length < 2) return [ps[0] || '', a.s];
  const tw = ps.reduce((n, p) => n + p.split(/\s+/).length, 0);
  const d = a.e - a.s;
  let c = a.s;
  for (const p of ps) {
    const e = c + (d * p.split(/\s+/).length) / Math.max(1, tw);
    if (t < e) return [p, c];
    c = e;
  }
  return [ps[ps.length - 1], c];
}

function drawDual(X, W, LH, sc, txt, anchor, translation = '', S = studio) {
  const d = S.du;
  const style = d.style || 'classic';
  const indMode = d.dualMode === 'independent';
  const parchment = !indMode && style === 'parchment';
  const cleanStyle = indMode || style === 'clean';
  const glassStyle = !indMode && style === 'glass';
  const pillStyle = !indMode && style === 'pill';
  const showSrc = d.showSource !== false;
  const showTrans = d.showTranslation !== false && d.dualMode !== 'split';
  const t = showSrc ? clean(txt) : '';
  const trans = showTrans ? clean(translation || '') : '';
  if (!t && !trans) return;

  const srcMaxW = W * (cl(Number(d.sourceMaxW ?? 88), 25, 96) / 100);
  const srcMaxL = Number(d.sourceMaxLines ?? 2);
  const trMaxW = W * (cl(Number(d.transMaxW ?? 88), 25, 96) / 100);
  const trMaxL = Number(d.transMaxLines ?? 3);

  let size = Number(d.size) || 44;
  let font = '';
  let r = { L: [], W: 0 };
  const srcFontFam = d.sourceFont || d.font || AMIRI;
  const srcWeight = d.weight || 700;
  if (t) {
    for (;;) {
      font = `${srcWeight} ${size}px ${srcFontFam}`;
      r = measureLines(X, t, font, srcMaxW);
      if (srcMaxL <= 0 || r.L.length <= srcMaxL || size - 2 < 16) break;
      size -= 2;
    }
  }

  let ts = Number(d.transSize) || 32;
  let trFont = '';
  let tr = { L: [], W: 0 };
  const trFontFam = d.translationFont || 'system-ui';
  const trWeight = d.transWeight || 500;
  if (trans) {
    for (;;) {
      trFont = `${trWeight} ${ts}px ${trFontFam}`;
      tr = measureLines(X, trans, trFont, trMaxW);
      if (trMaxL <= 0 || tr.L.length <= trMaxL || ts - 2 < 14) break;
      ts -= 2;
    }
  }

  const lh = size * (Number(d.sourceLh) || (parchment ? 1.32 : 1.28));
  const tlh = ts * (Number(d.transLh) || 1.24);
  const srcH = t ? lh * r.L.length : 0;
  const trH = trans ? tlh * tr.L.length : 0;
  const padX = cleanStyle ? 0 : Math.max(6, Number(d.padX ?? 24));
  const padY = cleanStyle ? 0 : Math.max(6, Number(d.padY ?? 16));
  const gap = Math.max(4, Number(d.gap ?? 14));
  const rad = Math.max(0, Number(d.radius ?? 18));

  const sPadX = d.sourceBgOn ? Math.max(0, Number(d.sourcePadX ?? 20)) : pillStyle || d.border === 'soft' ? Math.max(12, padX) : padX;
  const sPadY = d.sourceBgOn ? Math.max(0, Number(d.sourcePadY ?? 12)) : pillStyle || d.border === 'soft' ? Math.max(8, padY) : padY * 0.65;
  const tPadX = d.transBgOn ? Math.max(0, Number(d.transPadX ?? 18)) : pillStyle || d.border === 'soft' ? Math.max(12, padX) : padX;
  const tPadY = d.transBgOn ? Math.max(0, Number(d.transPadY ?? 10)) : pillStyle || d.border === 'soft' ? Math.max(8, padY) : padY * 0.55;

  const contentW = Math.max(r.W || 0, tr.W || 0);
  const pw = parchment ? Math.min(W * 0.94, Math.max(W * 0.6, contentW + padX * 2)) : Math.min(W * 0.96, contentW + padX * 2);
  const ph = (t ? srcH : 0) + (trans ? trH + (t ? gap : 0) : 0) + padY * 2;
  const srcX = W * cl(Number(d.sourceX ?? 50), 5, 95) / 100;
  const trX = W * cl(Number(d.transX ?? 50), 5, 95) / 100;
  const HDU = (y) => (Number.isFinite(+y) ? (LH * cl(+y, 0, 100)) / 100 : anchor.cy != null ? anchor.cy : anchor.bottom - ph / 2);
  const srcY = HDU(d.sourceY);
  const trY = HDU(d.transY);

  const minTop = t && trans ? Math.min(srcY - srcH / 2, trY - trH / 2) : t ? srcY - srcH / 2 : trY - trH / 2;
  const maxBot = t && trans ? Math.max(srcY + srcH / 2, trY + trH / 2) : t ? srcY + srcH / 2 : trY + trH / 2;
  const midX = t && trans ? (srcX + trX) / 2 : t ? srcX : trX;
  const px = cl(midX - pw / 2, W * 0.02, W * 0.98 - pw);
  const py = cl(minTop - padY, 0, LH - Math.max(ph, maxBot - minTop + padY * 2));
  const boxH = Math.max(ph, maxBot - minTop + padY * 2);

  S.duSourceBox = t
    ? { x: cl(srcX - r.W / 2 - sPadX, 0, W), y: cl(srcY - srcH / 2 - sPadY, 0, LH), w: Math.min(W, r.W + sPadX * 2), h: srcH + sPadY * 2 }
    : null;
  S.duTransBox = trans
    ? { x: cl(trX - tr.W / 2 - tPadX, 0, W), y: cl(trY - trH / 2 - tPadY, 0, LH), w: Math.min(W, tr.W + tPadX * 2), h: trH + tPadY * 2 }
    : null;

  const bgCol = d.bgColor || '#0b0d14';
  const bgAlpha = cl(Number(d.bgOpacity ?? 74), 0, 100) / 100;

  X.save();
  if (!indMode) {
    if (parchment) {
      X.shadowColor = 'rgba(0,0,0,.38)';
      X.shadowBlur = 18 * sc;
      X.shadowOffsetY = 6 * sc;
      X.fillStyle = '#f4e8cf';
      rr(X, px, py, pw, boxH, Math.min(rad, 16));
      X.fill();
      X.shadowColor = 'transparent';
      X.shadowBlur = 0;
      X.shadowOffsetY = 0;
      X.globalAlpha = 0.11;
      X.fillStyle = '#9c7951';
      for (let i = 0; i < 18; i++) {
        X.beginPath();
        X.ellipse(px + ((i * 97) % Math.max(1, pw)), py + ((i * 53) % Math.max(1, boxH)), 18 + (i % 5) * 7, 3 + (i % 3) * 2, i * 0.7, 0, Math.PI * 2);
        X.fill();
      }
      X.globalAlpha = 1;
      X.strokeStyle = '#c5a879';
      X.lineWidth = 2;
      rr(X, px + 8, py + 8, pw - 16, boxH - 16, Math.max(4, Math.min(rad, 16) - 6));
      X.stroke();
    } else if (glassStyle) {
      X.filter = `blur(${10 * sc}px)`;
      X.fillStyle = rgba(bgCol, bgAlpha * 0.85);
      rr(X, px, py, pw, boxH, rad);
      X.fill();
      X.filter = 'none';
      X.strokeStyle = 'rgba(255,255,255,.22)';
      X.lineWidth = 1.5;
      rr(X, px, py, pw, boxH, rad);
      X.stroke();
    } else if (pillStyle) {
      X.fillStyle = rgba(bgCol, bgAlpha);
      if (t) {
        rr(X, cl(srcX - r.W / 2 - sPadX, W * 0.02, W * 0.98), srcY - srcH / 2 - sPadY, Math.min(W * 0.96, r.W + sPadX * 2), srcH + sPadY * 2, rad);
        X.fill();
      }
      if (trans) {
        rr(X, cl(trX - tr.W / 2 - tPadX, W * 0.02, W * 0.98), trY - trH / 2 - tPadY, Math.min(W * 0.96, tr.W + tPadX * 2), trH + tPadY * 2, rad);
        X.fill();
      }
    } else if (!cleanStyle) {
      X.filter = `blur(${8 * sc}px)`;
      X.fillStyle = rgba(bgCol, bgAlpha);
      rr(X, px, py, pw, boxH, rad);
      X.fill();
      X.filter = 'none';
      if (d.border === 'border') {
        X.strokeStyle = 'rgba(255,255,255,.22)';
        X.lineWidth = 1.5;
        rr(X, px, py, pw, boxH, rad);
        X.stroke();
      }
    } else if (d.border === 'soft') {
      X.fillStyle = rgba(bgCol, Math.max(0.45, bgAlpha * 0.82));
      if (t) {
        rr(X, cl(srcX - r.W / 2 - sPadX, W * 0.02, W * 0.98), srcY - srcH / 2 - sPadY, Math.min(W * 0.96, r.W + sPadX * 2), srcH + sPadY * 2, Math.max(8, rad));
        X.fill();
      }
      if (trans) {
        rr(X, cl(trX - tr.W / 2 - tPadX, W * 0.02, W * 0.98), trY - trH / 2 - tPadY, Math.min(W * 0.96, tr.W + tPadX * 2), trH + tPadY * 2, Math.max(8, rad));
        X.fill();
      }
    }
  }

  if (t && d.sourceBgOn) {
    X.fillStyle = rgba(d.sourceBgColor || '#0b0d14', cl(Number(d.sourceBgOpacity ?? 72), 0, 100) / 100);
    rr(X, cl(srcX - r.W / 2 - sPadX, W * 0.02, W * 0.98), srcY - srcH / 2 - sPadY, Math.min(W * 0.96, r.W + sPadX * 2), srcH + sPadY * 2, Number(d.sourceRadius ?? 14));
    X.fill();
  }
  if (trans && d.transBgOn) {
    X.fillStyle = rgba(d.transBgColor || '#0b0d14', cl(Number(d.transBgOpacity ?? 72), 0, 100) / 100);
    rr(X, cl(trX - tr.W / 2 - tPadX, W * 0.02, W * 0.98), trY - trH / 2 - tPadY, Math.min(W * 0.96, tr.W + tPadX * 2), trH + tPadY * 2, Number(d.transRadius ?? 12));
    X.fill();
  }
  X.restore();

  X.save();
  X.textBaseline = 'middle';
  X.lineJoin = 'round';
  const setSh = (blurVal) => {
    const sv = Number(blurVal) || 0;
    if (sv > 0) {
      X.shadowColor = 'rgba(0,0,0,.9)';
      X.shadowBlur = sv * sc;
      X.shadowOffsetY = 2 * sc;
    } else {
      X.shadowColor = 'transparent';
      X.shadowBlur = 0;
      X.shadowOffsetY = 0;
    }
  };
  const drawLayer = (linesArr, blockW, cx, cy, lhVal, fontStr, rtl, align, fillCol, strokeW, strokeCol, shadowVal) => {
    X.font = fontStr;
    X.direction = rtl ? 'rtl' : 'ltr';
    X.textAlign = align || 'center';
    const drawX = align === 'left' ? cx - blockW / 2 : align === 'right' ? cx + blockW / 2 : cx;
    setSh(shadowVal);
    if (strokeW > 0) {
      X.lineWidth = strokeW * 2;
      X.strokeStyle = strokeCol || '#000000';
      linesArr.forEach((l, i) => X.strokeText(l, drawX, cy - (linesArr.length * lhVal) / 2 + lhVal * (i + 0.5)));
    }
    X.fillStyle = fillCol;
    linesArr.forEach((l, i) => X.fillText(l, drawX, cy - (linesArr.length * lhVal) / 2 + lhVal * (i + 0.5)));
  };

  if (t) {
    drawLayer(
      r.L,
      r.W,
      srcX,
      srcY,
      lh,
      font,
      isRtl(t),
      d.sourceAlign || 'center',
      parchment ? '#1b1610' : d.sourceColor || '#ffffff',
      Number(d.sourceStroke ?? 0),
      d.sourceStrokeColor || '#000000',
      Number(d.sourceShadow ?? 0)
    );
  }
  if (trans) {
    drawLayer(
      tr.L,
      tr.W,
      trX,
      trY,
      tlh,
      trFont,
      isRtl(trans),
      d.transAlign || 'center',
      parchment ? '#322a21' : d.transColor || '#f2f2f2',
      Number(d.transStroke ?? 0),
      d.transStrokeColor || '#000000',
      Number(d.transShadow ?? 0)
    );
  }
  X.restore();
}

export function renderCanvasFrame(C, sc, dragPreview = null, S = studio, blurC = bc, blurX = bx) {
  if (!C) return;
  if (S === studio) ensureScratch();
  blurC ||= bc;
  blurX ||= bx;
  const X = C.getContext('2d', { alpha: false });
  const W = S.LW;
  const H = S.LH;
  const V = S.V;
  const t = V ? V.currentTime : 0;
  const F = S.fr;
  const f = S.fx;
  const th = themeAt(t, S);
  const studioMode = S.mode === 'studio';
  const tt = Math.max(0, t - S.trimS);
  const sr = getSrc(S);
  const ok = sr.w && ((S.fg.mode === 'image' && S.fgImg) || (V && V.readyState > 1));

  shotSync(t, S);
  X.setTransform(sc, 0, 0, sc, 0, 0);
  X.fillStyle = F.on && F.bgm === 'solid' ? F.bgc : '#000';
  X.fillRect(0, 0, W, H);

  S.frBox = null;
  S.frW = W;
  S.frH = H;
  S.hdBox = null;

  const prog = Math.min(1, tt / Math.max(1, S.trimE - S.trimS));
  const kb = S.fg.mode === 'image' && S.fg.kb ? prog * prog * (3 - 2 * prog) : 0;
  const z = (f.zoom / 100) * (1 + (S.fg.kbz / 100) * kb);
  const px = f.px + kb * 3;
  const py = f.py + kb * 1.2;

  let x0 = 0;
  let y0 = 0;
  let fw = W;
  let fh = H;
  if (ok && F.on) {
    const ar = F.ar === 'orig' ? sr.w / sr.h : F.ar.split(':').reduce((a, b) => a / b);
    fw = (W * F.w) / 100;
    fh = fw / ar;
    if (fh > H * 0.98) {
      fh = H * 0.98;
      fw = fh * ar;
    }
    x0 = (W * F.x) / 100 - fw / 2;
    y0 = (H * F.y) / 100 - fh / 2;
    S.frBox = { x: x0, y: y0, w: fw, h: fh };
    S.frW = fw;
    S.frH = fh;
  }

  if (ok && S.cam === 'track' && S.fg.mode !== 'image' && FD && !S.sample && performance.now() - lastFace > 90) {
    lastFace = performance.now();
    const fc = detectFace(S);
    if (fc) {
      const [ax, ay] = aim(fc, S.frW, S.frH, f.zoom / 100, S);
      f.px += (ax - f.px) * 0.5;
      f.py += (ay - f.py) * 0.5;
    }
  }

  if (ok) {
    const fl = f.b !== 100 || f.c !== 100 || f.s !== 100 || f.blur > 0 ? `brightness(${f.b}%) contrast(${f.c}%) saturate(${f.s}%) blur(${f.blur * sc}px)` : 'none';
    if (!F.on) {
      X.filter = fl;
      vid(X, 0, 0, W, H, z, px, py, S);
      X.filter = 'none';
    } else {
      if (F.bgm === 'blur' && blurX) {
        const k = blurC.width / W;
        blurX.filter = `blur(${F.bgb * k}px)`;
        vid(blurX, -4, -4, blurC.width + 8, blurC.height + 8, 1.25, 0, 0, S);
        blurX.filter = 'none';
        if (F.leak) {
          const img = S.fg.mode === 'image';
          const cx = blurC.width * (0.5 + Math.sin(tt * 0.6) * 0.4);
          const cy = blurC.height * (0.5 + Math.cos(tt * 0.4) * 0.3);
          const r = blurC.width * (img ? 0.6 : 0.44);
          blurX.save();
          blurX.globalCompositeOperation = 'lighter';
          blurX.globalAlpha = img ? 0.65 : 0.45;
          const g = blurX.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, th.accent);
          g.addColorStop(1, rgba(th.accent, 0));
          blurX.fillStyle = g;
          blurX.beginPath();
          blurX.arc(cx, cy, r, 0, 7);
          blurX.fill();
          blurX.restore();
        }
        X.imageSmoothingQuality = 'high';
        X.drawImage(blurC, 0, 0, W, H);
        if (F.dim > 0) {
          X.fillStyle = `rgba(0,0,0,${F.dim / 100})`;
          X.fillRect(0, 0, W, H);
        }
      }
      if (F.sh && F.shm !== 'none') {
        const m = F.shm;
        const c = m === 'glow' ? th.accent : m === 'plate' ? th.bg : '#000000';
        const al = F.sha / 100;
        const sp = (fw * F.shs) / 100;
        const OFF = W * 3;
        X.save();
        if (m === 'plate') {
          X.shadowColor = rgba(c, al * 0.5);
          X.shadowBlur = F.shb * sc * 0.35;
          X.shadowOffsetY = 6 * sc;
          X.fillStyle = rgba(c, al);
          rr(X, x0 + fw * 0.06, y0 + F.shy, fw * 0.88, fh, F.r);
          X.fill();
        } else {
          X.shadowColor = rgba(c, al);
          X.shadowBlur = F.shb * sc;
          X.shadowOffsetX = OFF * sc;
          X.shadowOffsetY = F.shy * sc;
          X.fillStyle = '#000';
          for (let i = 0; i < (m === 'glow' ? 2 : 1); i++) {
            rr(X, x0 - sp - OFF, y0 - sp, fw + 2 * sp, fh + 2 * sp, F.r + sp);
            X.fill();
          }
        }
        X.restore();
      }
      X.save();
      if (F.rot) {
        const cx = x0 + fw / 2;
        const cy = y0 + fh / 2;
        X.translate(cx, cy);
        X.rotate((Number(F.rot) * Math.PI) / 180);
        X.translate(-cx, -cy);
      }
      rr(X, x0, y0, fw, fh, F.r);
      X.clip();
      X.filter = fl;
      vid(X, x0, y0, fw, fh, z, px, py, S);
      X.restore();
      if (F.bw > 0) {
        X.save();
        if (F.rot) {
          const cx = x0 + fw / 2;
          const cy = y0 + fh / 2;
          X.translate(cx, cy);
          X.rotate((Number(F.rot) * Math.PI) / 180);
          X.translate(-cx, -cy);
        }
        rr(X, x0, y0, fw, fh, F.r);
        X.lineWidth = F.bw;
        X.strokeStyle = F.blurC;
        X.stroke();
        X.restore();
      }
    }
  }

  if (Number(f.vignette) > 0) {
    const va = cl(Number(f.vignette) / 100, 0, 1);
    const vgGrad = X.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.72);
    vgGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vgGrad.addColorStop(1, `rgba(0,0,0,${(va * 0.85).toFixed(3)})`);
    X.fillStyle = vgGrad;
    X.fillRect(0, 0, W, H);
  }

  const drawGrain = () => {
    if (!S.grain || !GRN.length) return;
    X.save();
    X.globalCompositeOperation = 'overlay';
    X.globalAlpha = Math.min(1, S.grain / 18);
    X.translate((Math.random() * 256) | 0, (Math.random() * 256) | 0);
    X.fillStyle = X.createPattern(GRN[gi++ % 4], 'repeat');
    X.fillRect(-256, -256, W + 512, H + 512);
    X.restore();
  };

  if (!F.on) drawGrain();
  const G = S.gr;
  if (G.on && G.max > 0) {
    const hex = G.mode === 'custom' ? (G.color || '#000000') : G.mode === 'theme' ? th.bg : '#000000';
    const gy0 = (H * G.start) / 100;
    const gy1 = Math.max(gy0 + 1, (H * G.end) / 100);
    const g = X.createLinearGradient(0, gy0, 0, gy1);
    for (let i = 0; i <= 8; i++) {
      const p = i / 8;
      g.addColorStop(p, rgba(hex, (G.max / 100) * p * p * (3 - 2 * p)));
    }
    X.fillStyle = g;
    X.fillRect(0, gy0, W, H - gy0);
  }
  // Bottom edge glow (ambient light bloom effect with configurable height, width, intensity, and color)
  if (G.on && G.glowH > 0 && G.glowOpacity > 0) {
    const glowHex =
      G.glowColor ||
      (G.mode === 'custom' ? G.color || '#6366f1' : G.mode === 'theme' ? th.accent : '#ffffff');
    const glowPx = H * (cl(Number(G.glowH) || 0, 1, 60) / 100);
    const glowWFrac = cl(Number(G.glowW ?? 100), 15, 100) / 100;
    const alpha = cl(Number(G.glowOpacity ?? 65), 0, 100) / 100;
    X.save();
    X.globalCompositeOperation = 'screen';
    if (glowWFrac >= 0.98) {
      const gg = X.createLinearGradient(0, H, 0, H - glowPx);
      for (let i = 0; i <= 6; i++) {
        const p = i / 6;
        gg.addColorStop(p, rgba(glowHex, alpha * (1 - p) * (1 - p)));
      }
      X.fillStyle = gg;
      X.fillRect(0, H - glowPx, W, glowPx);
    } else {
      // Elliptical horizontal spotlight bloom scaled cleanly to glowW %
      const rx = Math.max(40, (W * glowWFrac) / 2);
      const ry = Math.max(20, glowPx);
      X.translate(W / 2, H);
      X.scale(1, ry / rx);
      const rg = X.createRadialGradient(0, 0, 0, 0, 0, rx);
      rg.addColorStop(0, rgba(glowHex, alpha));
      rg.addColorStop(0.55, rgba(glowHex, alpha * 0.42));
      rg.addColorStop(1, rgba(glowHex, 0));
      X.fillStyle = rg;
      X.fillRect(-rx, -rx, rx * 2, rx);
    }
    X.restore();
  }

  if (S.ovlC) X.drawImage(S.ovlC, 0, 0, W, H);

  // Media overlays (videos, banners, logos, PiP, split-screen)
  for (const o of S.mediaOverlays || []) {
    o._box = null;
    const rec = S.mediaNodes.get(o.id);
    const el = rec?.el;
    if (!el) continue;
    const start = Number(o.start) || 0;
    const end = Number.isFinite(+o.end) ? +o.end : S.dur;
    if (t < start || t > end) {
      if (el.tagName === 'VIDEO' && !el.paused) el.pause();
      continue;
    }
    if (el.tagName === 'VIDEO') {
      const elDur = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
      const rawTarget = Math.max(0, t - start);
      const target = o.loop !== false && elDur > 0 ? rawTarget % elDur : rawTarget;
      el.muted = o.mute !== false;
      el.playbackRate = S.speed || 1;
      if (elDur > 0 && rawTarget > elDur && o.loop === false) {
        if (!el.paused) el.pause();
        continue;
      }
      if (!el.seeking && Math.abs((el.currentTime || 0) - target) > 0.25) {
        try {
          el.currentTime = target;
        } catch {}
      }
      if (V && !V.paused && el.paused) el.play().catch(() => {});
      else if (V && V.paused && !S.exporting && !el.paused) el.pause();
      if (el.readyState < 2) continue;
    }

    const sw = el.naturalWidth || el.videoWidth || 1;
    const sh = el.naturalHeight || el.videoHeight || 1;
    let w = (W * cl(Number(o.w) || 30, 1, 100)) / 100;
    let h = (H * cl(Number(o.h) || 30, 1, 100)) / 100;
    const fit = o.fit || 'contain';
    if (fit === 'contain') {
      const sFit = Math.min(w / sw, h / sh);
      w = sw * sFit;
      h = sh * sFit;
    }
    const ox = (W * cl(Number(o.x ?? 50), 0, 100)) / 100 - w / 2;
    const oy = (H * cl(Number(o.y ?? 50), 0, 100)) / 100 - h / 2;
    o._box = { x: ox, y: oy, w, h };

    const fadeSec = Math.max(0, Number(o.fadeMs ?? 200)) / 1000;
    let fadeMul = 1;
    if (fadeSec > 0) {
      fadeMul = Math.min(1, Math.min(t - start, end - t) / fadeSec);
    }

    X.save();
    X.globalAlpha = (cl(Number(o.opacity ?? 100), 0, 100) / 100) * Math.max(0, fadeMul);
    if (o.blend && o.blend !== 'source-over') X.globalCompositeOperation = o.blend;
    if (Number(o.shadowBlur) > 0) {
      X.shadowColor = 'rgba(0,0,0,0.65)';
      X.shadowBlur = Number(o.shadowBlur) * sc;
      X.shadowOffsetY = 6 * sc;
    }
    const rad = Math.max(0, Number(o.radius) || 0);
    if (rad > 0 || fit === 'cover') {
      rr(X, ox, oy, w, h, rad);
      X.clip();
    }
    try {
      if (fit === 'cover') {
        const sCov = Math.max(w / sw, h / sh);
        const dw = sw * sCov;
        const dh = sh * sCov;
        X.drawImage(el, ox + (w - dw) / 2, oy + (h - dh) / 2, dw, dh);
      } else {
        X.drawImage(el, ox, oy, w, h);
      }
    } catch {}
    X.restore();

    if (Number(o.borderW) > 0) {
      X.save();
      X.globalAlpha = (cl(Number(o.opacity ?? 100), 0, 100) / 100) * Math.max(0, fadeMul);
      X.lineWidth = Number(o.borderW);
      X.strokeStyle = o.borderColor || '#ffffff';
      rr(X, ox, oy, w, h, rad);
      X.stroke();
      X.restore();
    }
  }

  const cardB = S.frBox ? S.frBox.y + S.frBox.h : H * 0.56;
  const sp = S.spk;
  const hasB = !!sp.on;
  S.spkBox = null;
  let spkReservedH = 0;

  if (hasB) {
    const spScale = cl(Number(sp.scale ?? 100), 50, 180) / 100;
    const rawTxt = sp.text?.trim() ? sp.text : 'Speaker Name | Title or Role';
    const ls = rawTxt.split('|').map((s) => clean(s.trim()));
    const s1 = Math.round((Number(sp.s1) || 46) * spScale);
    const s2 = Math.round((Number(sp.s2) || 32) * spScale);
    const avImg = getAvatarImg(sp.avatarSrc);
    const avSize = avImg ? Math.round((Number(sp.avatarSize) || 72) * spScale) : 0;
    const avGap = avImg ? Math.round(18 * spScale) : 0;
    const padX = Math.round((Number(sp.padX ?? 40)) * spScale);
    const padY = Math.round((Number(sp.padY ?? 16)) * spScale);

    X.font = `${sp.weight || 700} ${s1}px ${sp.font || AMIRI}`;
    const w1 = X.measureText(ls[0]).width;
    X.font = `500 ${s2}px ${sp.font || AMIRI}`;
    const w2 = ls[1] ? X.measureText(ls[1]).width : 0;
    const txtW = Math.max(w1, w2);
    const txtH = ls.length > 1 ? s1 + s2 * 1.38 : s1 * 1.15;
    const bw = Math.min(W * 0.94, Math.max(220, Math.round(txtW + padX * 2 + avSize + avGap)));
    const bh = Math.max(avSize + padY, Math.round(txtH + padY * 2));
    const brad = Math.min(bh / 2, Math.max(0, Number(sp.radius ?? 99) * spScale));
    spkReservedH = bh;

    let bx0;
    let by0;
    const posMode = sp.pos || 'underCard';
    if (posMode === 'bottomLeft') {
      bx0 = W * 0.05;
      by0 = H * 0.84 - bh / 2;
    } else if (posMode === 'bottomCenter') {
      bx0 = (W - bw) / 2;
      by0 = H * 0.85 - bh / 2;
    } else if (posMode === 'topCenter') {
      bx0 = (W - bw) / 2;
      by0 = H * 0.1 - bh / 2;
    } else if (posMode === 'custom') {
      bx0 = cl((W * cl(Number(sp.x ?? 50), 5, 95)) / 100 - bw / 2, 16, W - bw - 16);
      by0 = cl((H * cl(Number(sp.y ?? 66), 5, 95)) / 100 - bh / 2, 16, H - bh - 16);
    } else {
      bx0 = (W - bw) / 2;
      const anchorY = studioMode && S.frBox ? cardB : H * 0.62;
      by0 = cl(anchorY + (Number(sp.gap) ?? 95), 16, H - bh - 16);
    }

    const introMode = sp.intro === true || sp.intro === 1 ? 'slideLeft' : sp.intro === false || sp.intro === 0 ? 'none' : sp.intro || 'slideLeft';
    const ease5 = (p) => 1 - Math.pow(1 - p, 5);
    const isPlayingOrExporting = S.exporting || (V && !V.paused);
    const animProg =
      !isPlayingOrExporting || S.sample || introMode === 'none'
        ? 1
        : tt < 0.12
          ? 0
          : tt < 0.95
            ? ease5((tt - 0.12) / 0.83)
            : 1;
    let bxDraw = bx0;
    let byDraw = by0;
    let bAlpha = 1;
    if (introMode === 'slideLeft') bxDraw = bx0 - (bx0 + bw + 40) * (1 - animProg);
    else if (introMode === 'slideUp') {
      byDraw = by0 + 48 * (1 - animProg);
      bAlpha = animProg;
    } else if (introMode === 'fade') bAlpha = animProg;

    S.spkBox = { x: bxDraw, y: byDraw, w: bw, h: bh };

    const bStyle = sp.style || 'glass';
    const useTh = sp.useThemeColors === true;
    const bgHex = useTh ? th.banner : sp.bgColor || '#0f1420';
    const nameCol = useTh ? th.accent : sp.nameColor || '#ffffff';
    const roleCol = useTh ? rgba(th.accent, 0.82) : sp.roleColor || '#cbd5e1';
    const accCol = useTh ? th.accent : sp.accentColor || '#4f8cff';
    const bgAlpha = cl(Number(sp.bgOpacity ?? 82), 0, 100) / 100;

    if (animProg > 0.01) {
      X.save();
      X.globalAlpha = bAlpha;
      if (Number(sp.shadow) > 0 && bStyle !== 'outline') {
        X.shadowColor = 'rgba(0,0,0,0.45)';
        X.shadowBlur = Number(sp.shadow) * sc;
        X.shadowOffsetY = 6 * sc;
      }

      if (bStyle === 'glass') {
        rr(X, bxDraw, byDraw, bw, bh, brad);
        X.fillStyle = rgba(bgHex, Math.max(0.45, bgAlpha * 0.88));
        X.fill();
        X.shadowColor = 'transparent';
        X.shadowBlur = 0;
        // Subtle top glass sheen
        X.save();
        rr(X, bxDraw, byDraw, bw, bh, brad);
        X.clip();
        const sg = X.createLinearGradient(bxDraw, byDraw, bxDraw, byDraw + bh);
        sg.addColorStop(0, 'rgba(255,255,255,0.12)');
        sg.addColorStop(0.5, 'rgba(255,255,255,0.02)');
        sg.addColorStop(1, 'rgba(0,0,0,0.08)');
        X.fillStyle = sg;
        X.fillRect(bxDraw, byDraw, bw, bh);
        X.restore();
      } else if (bStyle === 'solid') {
        const g = X.createLinearGradient(bxDraw, byDraw, bxDraw + bw, byDraw + bh);
        g.addColorStop(0, rgba(bgHex, bgAlpha));
        g.addColorStop(1, rgba(accCol, Math.max(0.45, bgAlpha * 0.85)));
        X.fillStyle = g;
        rr(X, bxDraw, byDraw, bw, bh, brad);
        X.fill();
      } else if (bStyle === 'card' || bStyle === 'minimalBar') {
        X.fillStyle = rgba(bgHex, bgAlpha);
        rr(X, bxDraw, byDraw, bw, bh, bStyle === 'minimalBar' ? Math.min(brad, 14) : brad);
        X.fill();
        if (bStyle === 'minimalBar') {
          X.shadowColor = 'transparent';
          X.fillStyle = accCol;
          rr(X, bxDraw, byDraw, Math.max(6, Math.round(7 * spScale)), bh, 4);
          X.fill();
        }
      }

      X.shadowColor = 'transparent';
      X.shadowBlur = 0;

      if ((Number(sp.borderW) > 0 || bStyle === 'outline') && bStyle !== 'minimalBar') {
        X.lineWidth = Math.max(bStyle === 'outline' ? 2 : 0, Number(sp.borderW ?? 2));
        X.strokeStyle = bStyle === 'outline' ? accCol : rgba(sp.borderColor || '#ffffff', cl(Number(sp.borderOpacity ?? 24), 0, 100) / 100);
        rr(X, bxDraw, byDraw, bw, bh, brad);
        X.stroke();
      }

      let txtStartX = bxDraw + padX;
      if (avImg && avSize > 0) {
        const ax = bxDraw + Math.max(12, Math.round(padX * 0.55));
        const ay = byDraw + (bh - avSize) / 2;
        X.save();
        rr(X, ax, ay, avSize, avSize, sp.avatarShape === 'rounded' ? Math.round(avSize * 0.24) : avSize / 2);
        X.clip();
        const sCov = Math.max(avSize / avImg.naturalWidth, avSize / avImg.naturalHeight);
        const aw = avImg.naturalWidth * sCov;
        const ah = avImg.naturalHeight * sCov;
        X.drawImage(avImg, ax + (avSize - aw) / 2, ay + (avSize - ah) / 2, aw, ah);
        X.restore();
        txtStartX = ax + avSize + avGap;
      }

      const maxTxtW = Math.max(40, bw - (txtStartX - bxDraw) - padX * 0.6);
      X.textAlign = 'left';
      X.textBaseline = 'top';
      X.direction = isRtl(ls[0]) ? 'rtl' : 'ltr';
      const drawTxtX = isRtl(ls[0]) ? bxDraw + bw - padX : txtStartX;
      if (isRtl(ls[0])) X.textAlign = 'right';
      const txtY0 = byDraw + (bh - txtH) / 2;
      X.fillStyle = nameCol;
      X.font = `${sp.weight || 700} ${s1}px ${sp.font || AMIRI}`;
      X.fillText(ls[0], drawTxtX, txtY0, maxTxtW);
      if (ls[1]) {
        X.fillStyle = roleCol;
        X.font = `500 ${s2}px ${sp.font || AMIRI}`;
        X.fillText(ls[1], drawTxtX, txtY0 + Math.round(s1 * 1.18), maxTxtW);
      }

      if (sp.prog) {
        const sx = bxDraw + Math.min(brad, 28);
        const mw = Math.max(20, bw - Math.min(brad, 28) * 2);
        const cw = mw * prog;
        if (cw > 0) {
          X.lineWidth = 3;
          X.strokeStyle = accCol;
          X.beginPath();
          X.moveTo(sx, byDraw + bh - 3);
          X.lineTo(sx + cw, byDraw + bh - 3);
          X.stroke();
          X.fillStyle = '#fff';
          X.beginPath();
          X.arc(sx + cw, byDraw + bh - 3, 4, 0, Math.PI * 2);
          X.fill();
        }
      }

      const waveMode = sp.wave === true || sp.wave === 1 ? 'bars' : sp.wave === false || sp.wave === 0 ? 'none' : sp.wave || 'bars';
      const speaking = S.sample || S.subs.some((s) => t >= s.s && t <= s.e);
      if (waveMode !== 'none') {
        const vx = bxDraw + padX;
        const vy = byDraw - Math.round(18 * spScale);
        if (waveMode === 'bars') {
          X.fillStyle = accCol;
          for (let i = 0; i < 14; i++) {
            const amp = speaking ? 4 + Math.abs(Math.sin(tt * 7 + i * 0.9) * Math.cos(tt * 4.2 - i * 0.4)) * 20 : 3 + Math.abs(Math.sin(tt * 2 + i)) * 4;
            rr(X, vx + i * 7, vy - amp / 2, 4, amp, 2);
            X.fill();
          }
        } else {
          X.lineWidth = 3;
          X.lineJoin = 'round';
          X.strokeStyle = accCol;
          X.beginPath();
          for (let i = 0; i < 75; i++) {
            const nx = i / 74;
            const env = Math.sin(nx * Math.PI);
            const w = speaking ? (Math.sin(tt * 5.5 + nx * 12) * 0.6 + Math.cos(tt * 7.2 - nx * 18) * 0.4) * 22 : Math.sin(tt * 2 - nx * 6) * 4;
            if (i) X.lineTo(vx + i, vy - w * env);
            else X.moveTo(vx, vy);
          }
          X.stroke();
        }
      }
      X.restore();
    }
  }

  if (F.on) drawGrain();

  // Broadcast News Channel Lower-Third + Scrolling Ticker Banner
  S.bnBox = null;
  const bn = S.bn;
  if (bn?.on && (bn.text?.trim() || bn.ticker?.trim() || bn.label?.trim())) {
    const sT = Number(bn.startT) || 0;
    const eT = Number(bn.endT) || 0;
    const inWin = S.sample || ((sT <= 0 || t >= sT) && (eT <= 0 || t <= eT));
    if (inWin) {
      const bw = cl((W * cl(Number(bn.w ?? 94), 30, 100)) / 100, 180, W);
      const hasTicker = !!(bn.ticker && bn.ticker.trim());
      const mainH = Math.max(54, Math.round((H * cl(Number(bn.h ?? 12), 5, 32)) / 100));
      const tickH = hasTicker ? Math.max(32, Math.round((Number(bn.tickerSize) || 24) * 1.72)) : 0;
      const totalH = mainH + tickH;
      const cx = (W * cl(Number(bn.x ?? 50), 5, 95)) / 100;
      const cy = (H * cl(Number(bn.y ?? 88), 5, 96)) / 100;
      const blurX = cl(cx - bw / 2, 0, W - bw);
      const by = cl(cy - totalH / 2, 0, H - totalH);
      const rad = Math.min(totalH / 2, Math.max(0, Number(bn.radius ?? 8)));
      const bStyle = bn.style || 'broadcast';
      const fnt = bn.font || 'Inter, "Segoe UI", Arial, sans-serif';
      const accW = bStyle === 'minimal' ? 4 : Math.max(0, Number(bn.accentW ?? 8));
      const op = cl(Number(bn.bgOpacity ?? 92), 10, 100) / 100;

      S.bnBox = { x: blurX, y: by, w: bw, h: totalH };
      X.save();
      if (bn.shadow > 0) {
        X.shadowColor = 'rgba(0,0,0,0.58)';
        X.shadowBlur = Number(bn.shadow) || 20;
        X.shadowOffsetY = 6;
      }

      // Main card container
      rr(X, blurX, by, bw, totalH, rad);
      if (bStyle === 'glass') {
        X.fillStyle = rgba(bn.bgColor || '#0f172a', op * 0.78);
      } else if (bStyle === 'alert') {
        X.fillStyle = rgba(bn.accentColor || '#dc2626', op);
      } else if (bStyle === 'minimal') {
        X.fillStyle = rgba(bn.bgColor || '#090d16', op * 0.72);
      } else {
        X.fillStyle = rgba(bn.bgColor || '#0a1428', op);
      }
      X.fill();
      X.shadowBlur = 0;
      X.shadowOffsetY = 0;

      if (bStyle === 'glass' || bStyle === 'minimal') {
        X.strokeStyle = rgba('#ffffff', 0.18);
        X.lineWidth = 1.5;
        X.stroke();
      }

      // Clip interior for stripe, headline, badge, ticker
      X.save();
      rr(X, blurX, by, bw, totalH, rad);
      X.clip();

      // Subtle glossy top edge highlight on broadcast/glass
      if (bStyle === 'broadcast' || bStyle === 'glass') {
        const tg = X.createLinearGradient(blurX, by, blurX, by + mainH);
        tg.addColorStop(0, 'rgba(255,255,255,0.09)');
        tg.addColorStop(1, 'rgba(255,255,255,0)');
        X.fillStyle = tg;
        X.fillRect(blurX, by, bw, mainH);
      }

      // Left accent bar (or top line in minimal)
      if (accW > 0) {
        X.fillStyle = bn.accentColor || '#2563eb';
        if (bStyle === 'minimal') {
          X.fillRect(blurX, by, bw, 3);
        } else {
          X.fillRect(blurX, by, accW, totalH);
        }
      }

      let curX = blurX + accW + 18;
      // Optional BREAKING / LIVE badge
      if (bn.labelOn && bn.label?.trim()) {
        const lbl = bn.label.trim().toUpperCase();
        const ls = Number(bn.labelSize) || 22;
        X.font = `800 ${ls}px ${fnt}`;
        const lw = X.measureText(lbl).width + 22;
        const lh = Math.max(26, ls + 14);
        const ly = by + (mainH - lh) / 2;
        rr(X, curX, ly, lw, lh, Math.min(6, rad));
        X.fillStyle = bn.labelBg || '#dc2626';
        X.fill();
        X.fillStyle = bn.labelColor || '#ffffff';
        X.textAlign = 'center';
        X.textBaseline = 'middle';
        X.fillText(lbl, curX + lw / 2, ly + lh / 2 + 1);
        curX += lw + 16;
      }

      // Optional Channel Logo tag on right side
      let rightReserve = 18;
      if (bn.logoText?.trim()) {
        const lg = clean(bn.logoText.trim());
        X.font = `800 ${Math.max(18, (Number(bn.labelSize) || 22))}px ${fnt}`;
        const lgW = X.measureText(lg).width + 24;
        const lgH = Math.max(28, (Number(bn.labelSize) || 22) + 14);
        const lgX = blurX + bw - lgW - 14;
        const lgY = by + (mainH - lgH) / 2;
        rr(X, lgX, lgY, lgW, lgH, Math.min(6, rad));
        X.fillStyle = 'rgba(255,255,255,0.12)';
        X.fill();
        X.fillStyle = bn.textColor || '#ffffff';
        X.textAlign = 'center';
        X.textBaseline = 'middle';
        X.fillText(lg, lgX + lgW / 2, lgY + lgH / 2 + 1);
        rightReserve = lgW + 30;
      }

      // Headline + optional kicker
      const headMaxW = Math.max(60, blurX + bw - rightReserve - curX);
      const headTxt = clean(bn.text?.trim() || '');
      const kickerTxt = clean(bn.kicker?.trim() || '');
      if (kickerTxt) {
        const ks = Math.max(14, Math.round((Number(bn.fontSize) || 36) * 0.48));
        X.font = `700 ${ks}px ${fnt}`;
        X.fillStyle = bn.accentColor || '#60a5fa';
        X.textAlign = 'left';
        X.textBaseline = 'middle';
        X.fillText(kickerTxt.toUpperCase(), curX, by + mainH * 0.3, headMaxW);
      }
      if (headTxt) {
        const fs = Number(bn.fontSize) || 36;
        X.font = `700 ${fs}px ${fnt}`;
        X.fillStyle = bn.textColor || '#ffffff';
        X.textAlign = 'left';
        X.textBaseline = 'middle';
        X.direction = isRtl(headTxt) ? 'rtl' : 'ltr';
        const drawX = X.direction === 'rtl' ? blurX + bw - rightReserve : curX;
        const textY = kickerTxt ? by + mainH * 0.68 : by + mainH / 2;
        X.fillText(headTxt, drawX, textY, headMaxW);
      }

      // Bottom scrolling news ticker strip
      if (hasTicker) {
        const ty = by + mainH;
        X.fillStyle = bn.tickerBg || '#0f2347';
        X.fillRect(blurX + (bStyle === 'minimal' ? 0 : accW), ty, bw - (bStyle === 'minimal' ? 0 : accW), tickH);
        X.fillStyle = 'rgba(255,255,255,0.14)';
        X.fillRect(blurX, ty, bw, 1);

        const ts = Number(bn.tickerSize) || 24;
        X.font = `600 ${ts}px ${fnt}`;
        X.fillStyle = bn.tickerColor || '#e2e8f0';
        X.textAlign = 'left';
        X.textBaseline = 'middle';
        X.direction = isRtl(bn.ticker) ? 'rtl' : 'ltr';
        const seg = clean(bn.ticker.trim()) + '   •   ';
        const segW = Math.max(120, X.measureText(seg).width);
        const speed = Math.max(15, Number(bn.tickerSpeed) || 85);
        const shiftX = (t * speed) % segW;
        const startX = blurX + accW - shiftX;
        for (let drawX = startX; drawX < blurX + bw; drawX += segW) {
          X.fillText(seg, drawX, ty + tickH / 2 + 1);
        }
      }

      X.restore();
      X.restore();
    }
  }

  if (S.wm.on && S.wm.text) {
    const w = S.wm;
    X.save();
    X.globalAlpha = cl(Number(w.opacity ?? 92), 5, 100) / 100;
    X.font = `700 ${w.size}px ${w.font || AMIRI}`;
    X.textAlign = 'left';
    X.textBaseline = 'middle';
    X.direction = isRtl(w.text) ? 'rtl' : 'ltr';
    const txt = clean(w.text);
    const wmW = X.measureText(txt).width + 52;
    const wmH = Math.max(46, w.size * 1.55);
    const wPos = w.pos || 'bottomCenter';
    let wx0 = (W - wmW) / 2;
    let wy0 = H - 105 + (Number(w.dy) || 0);
    if (wPos === 'topLeft') {
      wx0 = W * 0.04;
      wy0 = H * 0.04;
    } else if (wPos === 'topRight') {
      wx0 = W * 0.96 - wmW;
      wy0 = H * 0.04;
    } else if (wPos === 'bottomLeft') {
      wx0 = W * 0.04;
      wy0 = H * 0.94 - wmH;
    } else if (wPos === 'bottomRight') {
      wx0 = W * 0.96 - wmW;
      wy0 = H * 0.94 - wmH;
    } else if (wPos === 'custom') {
      wx0 = cl((W * cl(Number(w.x ?? 50), 3, 97)) / 100 - wmW / 2, 8, W - wmW - 8);
      wy0 = cl((H * cl(Number(w.y ?? 92), 3, 97)) / 100 - wmH / 2, 8, H - wmH - 8);
    }
    const col = w.color || (studioMode ? th.accent : '#ffffff');
    const wmStyle = w.style || 'outline';
    const wmRad = Number(w.radius ?? 14);
    if (wmStyle === 'pill') {
      X.fillStyle = rgba(w.bgColor || '#090c14', cl(Number(w.bgOpacity ?? 55), 0, 100) / 100);
      rr(X, wx0, wy0, wmW, wmH, wmRad);
      X.fill();
    } else if (wmStyle === 'outline') {
      X.lineWidth = 3;
      X.strokeStyle = rgba(col, studioMode ? 0.47 : 0.63);
      rr(X, wx0, wy0, wmW, wmH, wmRad);
      X.stroke();
    }
    X.fillStyle = col;
    X.fillText(txt, wx0 + 26, wy0 + wmH / 2);
    X.restore();
  }

  if (S.hd.on && S.hd.text.trim()) {
    const h = S.hd;
    const k = h.scale / 100;
    const auto = h.auto && h.ay != null;
    const { out, H: tH } = hdSpecs(X, auto ? h.am : h.s1 * k, auto ? h.as : h.s2 * k, S);
    const maxLineW = Math.max(120, ...out.map((s) => ((X.font = s.font), X.measureText(s.l).width)));
    const hx = (W * cl(Number(h.x ?? 50), 10, 90)) / 100;
    const hy0 = H * (auto ? h.ay : h.y / 100) - tH / 2;
    if (h.scrim) {
      const a = Math.max(0, hy0 - 60);
      const b = Math.min(H, hy0 + tH + 60);
      if (b > a) {
        const g = X.createLinearGradient(0, a, 0, b);
        for (let i = 0; i <= 10; i++) g.addColorStop(i / 10, `rgba(0,0,0,${0.59 * Math.sin((i / 10) * Math.PI)})`);
        X.fillStyle = g;
        X.fillRect(0, a, W, b - a);
      }
    }
    if (h.bgOn) {
      const pX = Number(h.padX ?? 28);
      const pY = Number(h.padY ?? 14);
      X.fillStyle = rgba(h.bgColor || '#090c14', cl(Number(h.bgOpacity ?? 72), 0, 100) / 100);
      rr(X, hx - maxLineW / 2 - pX, hy0 - pY, maxLineW + pX * 2, tH + pY * 2, Number(h.radius ?? 14));
      X.fill();
    }
    X.textAlign = 'center';
    X.textBaseline = 'top';
    X.lineJoin = 'round';
    let hy = hy0;
    for (const s of out) {
      X.font = s.font;
      X.direction = isRtl(s.l) ? 'rtl' : 'ltr';
      if (Number(h.shadow ?? 12) > 0) {
        X.shadowColor = 'rgba(0,0,0,.85)';
        X.shadowBlur = Number(h.shadow ?? 12) * sc;
        X.shadowOffsetY = 3 * sc;
      }
      if (Number(h.stroke ?? 4) > 0) {
        X.lineWidth = Number(h.stroke ?? 4);
        X.strokeStyle = h.strokeColor || 'rgba(0,0,0,.9)';
        X.strokeText(s.l, hx, hy);
      }
      X.fillStyle = h.color || '#ffffff';
      X.fillText(s.l, hx, hy);
      X.shadowColor = 'transparent';
      X.shadowBlur = 0;
      hy += s.lh;
    }
    X.direction = 'ltr';
    S.hdBox = { x: hx - maxLineW / 2, y: hy0, w: maxLineW, h: tH };
  }

  S.subBox = null;
  S.duSourceBox = null;
  S.duTransBox = null;
  S.act = null;

  const foundSub = S.subs.find((s) => t >= s.s && t <= s.e);
  if (foundSub) S.act = foundSub.id;
  const sampleObj =
    !S.exporting && S.sampleSub
      ? {
          id: -99,
          s: t - 1,
          e: t + 3,
          t: 'This is a sample subtitle line for styling',
          orig: 'هٰذَا مِثَالٌ لِلنَّصِّ الْأَصْلِيِّ',
          tr: 'This is a sample English translation line',
        }
      : null;
  const a = foundSub || sampleObj;

  if (a && !S.sample) {
    const st = { ...S.st, ...a.st };
    const [part, cs] = partFor(a, t);
    const col = a.st && a.st.color !== undefined ? a.st.color : st.acc ? th.accent : st.color;
    const marginPct = cl(Number(st.marginX ?? 6), 0, 25) / 100;
    const maxSubW = Math.min((W * st.w) / 100, W * (1 - marginPct * 2));
    const maxLines = Math.max(0, Number(st.maxLines ?? 3));
    const minFit = Math.max(18, Number(st.minSize ?? 36));
    const p = prep(X, st, part, maxSubW, st.fit && maxLines > 0 ? { max: maxLines, min: minFit, step: 3 } : null);
    const padY = st.bga > 0 ? Math.max(0, Number(st.padY ?? 14)) : 0;
    const Hh = p.L.length * p.size * st.lh + padY * 2;
    const dualPairedActive = S.du.on && S.du.dualMode !== 'split' && S.du.showTranslation !== false && !!a.tr;

    if (!dualPairedActive) {
      let cy;
      if (!st.auto || (a.st && a.st.y !== undefined)) cy = (st.y / 100) * H;
      else {
        const safeY = Math.max(8, Number(st.marginY ?? 24));
        const bot = H - (S.wm.on ? 140 : 36) - safeY;
        const top = studioMode && F.on ? cardB + (sp.pos === 'underCard' ? (Number(sp.gap) ?? 95) + spkReservedH : 0) + safeY : H * 0.76;
        const av = Math.max(10, bot - top);
        cy = Math.max(top + Hh / 2, Math.min(top + av / 2, bot - Hh / 2));
      }
      const k = st.anim === 'none' ? 1 : Math.min(1, Math.max(0, t - cs) / 0.32);
      const e = 1 - Math.pow(1 - k, 3);
      X.save();
      let al = 1;
      if (st.anim === 'fade') {
        al = e;
        cy += 18 * (1 - e);
      } else if (st.anim === 'slide') {
        al = Math.min(1, e * 1.4);
        cy += 36 * (1 - e);
      } else if (st.anim === 'pop') {
        const q = 0.82 + 0.18 * e;
        X.translate(W / 2, cy);
        X.scale(q, q);
        X.translate(-W / 2, -cy);
      }
      const tk = part.split(/\s+/).filter(Boolean);
      let hl = null;
      if (st.hl && a.words && a.words.length === tk.length && !a.t.includes('|')) {
        let ix = -1;
        for (let q = 0; q < a.words.length; q++) if (a.words[q].s <= t) ix = q;
        hl = { idx: ix, color: st.hlc };
      }
      S.subBox = paint(X, W, sc, { ...st, color: col }, p, W / 2, cy, st.lh, al, hl);
      X.restore();
    }

    if (S.du.on) {
      const source = a.orig !== undefined ? a.orig : a.t;
      const translated = a.tr || '';
      const anchor = studioMode && F.on ? { cy: cardB + sp.gap / 2 } : { bottom: S.subBox ? S.subBox.y - 12 : H * 0.72 };
      drawDual(X, W, H, sc, source, anchor, translated, S);
    }
  }

  for (const o of S.texts) {
    if (t >= o.s && t < o.e) {
      const stObj = {
        ...S.st,
        acc: 0,
        size: o.size ?? 76,
        color: o.color || '#ffffff',
        stroke: o.stroke || '#000000',
        sw: o.sw ?? 6,
        bg: o.bg || '#000000',
        bga: o.bga ?? 0,
        boxR: o.boxR ?? 14,
        padX: o.padX ?? 24,
        padY: o.padY ?? 14,
        font: o.font || S.st.font,
        bold: o.bold !== undefined ? (o.bold ? 1 : 0) : 1,
        upper: o.upper ? 1 : 0,
        align: o.align || 'center',
        shadow: o.shadow !== undefined ? (o.shadow ? 1 : 0) : 1,
        shc: o.shc || '#000000',
        sha: o.sha ?? 85,
        shb: o.shb ?? 10,
        shx: o.shx ?? 2,
        shy: o.shy ?? 3,
        w: o.w ?? 88,
        anim: o.anim || 'fade',
        hl: 0,
      };
      o.box = paint(X, W, sc, stObj, prep(X, stObj, o.t, (W * stObj.w) / 100), (o.x / 100) * W, (o.y / 100) * H);
    } else {
      o.box = null;
    }
  }

  if (!S.exporting) {
    if (S.guides) {
      X.fillStyle = 'rgba(255,60,60,.14)';
      const gm = S.guideMode || 'reels';
      if (gm === 'tiktok') {
        X.fillRect(0, 0, W, H * 0.13);
        X.fillRect(W * 0.82, H * 0.35, W * 0.18, H * 0.45);
        X.fillRect(0, H * 0.76, W, H * 0.24);
      } else if (gm === 'shorts') {
        X.fillRect(0, 0, W, H * 0.1);
        X.fillRect(W * 0.84, H * 0.42, W * 0.16, H * 0.42);
        X.fillRect(0, H * 0.8, W, H * 0.2);
      } else {
        X.fillRect(0, 0, W, H * 0.12);
        X.fillRect(0, H * 0.78, W, H * 0.22);
      }
      X.fillStyle = '#fffb';
      X.font = '26px system-ui';
      X.textAlign = 'center';
      X.fillText(`${gm.toUpperCase()} Safe Header`, W / 2, H * 0.06);
      X.fillText(`${gm.toUpperCase()} Caption & UI Zone`, W / 2, H * 0.89);
    }
    const drawHudBox = (box, label, col = '#ff3d81') => {
      if (!box) return;
      X.save();
      X.setLineDash([10, 8]);
      X.lineWidth = 2.5;
      X.strokeStyle = col;
      rr(X, box.x, box.y, box.w, box.h, 10);
      X.stroke();
      X.setLineDash([]);
      X.font = '600 22px system-ui';
      const tw = X.measureText(label).width + 20;
      const lx = cl(box.x, 8, W - tw - 8);
      const ly = Math.max(8, box.y - 34);
      X.fillStyle = col;
      rr(X, lx, ly, tw, 28, 7);
      X.fill();
      X.fillStyle = '#fff';
      X.textAlign = 'left';
      X.textBaseline = 'middle';
      X.fillText(label, lx + 10, ly + 14);
      X.restore();
    };
    if (dragPreview?.du) {
      const pxPos = dragPreview.du === 'source' ? S.du.sourceX : S.du.transX;
      const pyPos = dragPreview.du === 'source' ? S.du.sourceY : S.du.transY;
      X.save();
      X.strokeStyle = 'rgba(124,92,255,.9)';
      X.lineWidth = 2;
      if (Math.abs(pxPos - 50) < 0.01) {
        X.beginPath();
        X.moveTo(W / 2, 0);
        X.lineTo(W / 2, H);
        X.stroke();
      }
      if (Math.abs(pyPos - 50) < 0.01) {
        X.beginPath();
        X.moveTo(0, H / 2);
        X.lineTo(W, H / 2);
        X.stroke();
      }
      X.restore();
      drawHudBox(dragPreview.du === 'source' ? S.duSourceBox : S.duTransBox, dragPreview.du === 'source' ? 'Source · Dragging' : 'Translation · Dragging', '#7c5cff');
    } else if (S.hoverLayer === 'duSource') drawHudBox(S.duSourceBox, 'Source · Drag / Scroll size', '#7c5cff');
    else if (S.hoverLayer === 'duTrans') drawHudBox(S.duTransBox, 'Translation · Drag / Scroll size', '#3b82f6');
    else if (S.hoverLayer === 'spk') drawHudBox(S.spkBox, 'Speaker Banner · Drag', '#22c55e');
    else if (S.hoverLayer === 'bn') drawHudBox(S.bnBox, 'News Banner · Drag Y/H', '#ef4444');
    else if (S.hoverLayer === 'overlay') {
      const ov = (S.mediaOverlays || []).find((q) => q.id === S.selectedOverlayId);
      if (ov?._box) drawHudBox(ov._box, `${ov.name} · Drag / Scroll scale`, '#06b6d4');
    } else if (S.hoverLayer === 'sub') drawHudBox(S.subBox, 'Main Subtitle · Drag / Scroll size', '#ff3d81');
    else if (S.hoverLayer === 'text') {
      const tx = S.texts.find((q) => q.id === S.sel);
      if (tx?.box) drawHudBox(tx.box, 'Text Overlay · Drag', '#a855f7');
    }

    const fb = S.frBox;
    if (fb && (S.hov || dragPreview)) {
      X.save();
      X.setLineDash([14, 10]);
      X.lineWidth = 3;
      X.strokeStyle = 'rgba(255,255,255,.7)';
      rr(X, fb.x, fb.y, fb.w, fb.h, F.r);
      X.stroke();
      X.setLineDash([]);
      X.fillStyle = '#ff3d81';
      X.beginPath();
      X.arc(fb.x + fb.w, fb.y + fb.h, 20, 0, 7);
      X.fill();
      X.lineWidth = 4;
      X.strokeStyle = '#fff';
      X.stroke();
      if (dragPreview?.fr) {
        X.strokeStyle = 'rgba(255,61,129,.9)';
        X.lineWidth = 2;
        if (Math.abs(F.x - 50) < 0.01) {
          X.beginPath();
          X.moveTo(W / 2, 0);
          X.lineTo(W / 2, H);
          X.stroke();
        }
        if (Math.abs(F.y - 50) < 0.01) {
          X.beginPath();
          X.moveTo(0, H / 2);
          X.lineTo(W, H / 2);
          X.stroke();
        }
      }
      X.restore();
    }
  }
}

export function rgb2hsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const m = Math.max(r, g, b);
  const d = m - Math.min(r, g, b);
  return [d ? (m === r ? ((g - b) / d + 6) % 6 : m === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 : 0, m ? d / m : 0, m];
}

export function hsv2rgb(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return [f(5), f(3), f(1)];
}

export async function generateVideoThemes() {
  const V = studio.V;
  if (!studio.file || !V?.duration) return;
  try {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'auto';
    v.src = V.src;
    await new Promise((r) => (v.onloadeddata = r));
    const cv = document.createElement('canvas');
    cv.width = cv.height = 30;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    const P = [];
    for (const f of [0.15, 0.5, 0.85]) {
      v.currentTime = Math.min(V.duration - 0.1, V.duration * f);
      await new Promise((r) => (v.onseeked = r));
      cx.drawImage(v, v.videoWidth / 4, v.videoHeight / 4, v.videoWidth / 2, v.videoHeight / 2, 0, 0, 30, 30);
      const d = cx.getImageData(0, 0, 30, 30).data;
      for (let i = 0; i < d.length; i += 4) P.push([d[i], d[i + 1], d[i + 2]]);
    }
    let Cc = [];
    for (let i = 0; i < 8; i++) Cc.push(P[Math.floor((i * P.length) / 8)].slice());
    for (let n = 0; n < 15; n++) {
      const A = Cc.map(() => [0, 0, 0, 0]);
      for (const p of P) {
        let b = 0;
        let bd = 1e18;
        for (let j = 0; j < 8; j++) {
          const d = (p[0] - Cc[j][0]) ** 2 + (p[1] - Cc[j][1]) ** 2 + (p[2] - Cc[j][2]) ** 2;
          if (d < bd) {
            bd = d;
            b = j;
          }
        }
        const a = A[b];
        a[0] += p[0];
        a[1] += p[1];
        a[2] += p[2];
        a[3]++;
      }
      Cc = Cc.map((c, j) => (A[j][3] ? [A[j][0] / A[j][3], A[j][1] / A[j][3], A[j][2] / A[j][3]] : c));
    }
    Cc = Cc.filter((c) => {
      const q = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      return q > 20 && q < 240;
    });
    Cc.sort((a, c) => rgb2hsv(...c)[1] - rgb2hsv(...a)[1]);
    while (Cc.length < 5) {
      const [h, s, vv] = rgb2hsv(...(Cc[0] || [20, 15, 135]));
      Cc.push(hsv2rgb((h + Cc.length * 72) % 360, s, vv));
    }
    studio.themes = Cc.slice(0, 5).map((rgb) => {
      const [h, s, vv] = rgb2hsv(...rgb);
      const bs = cl(s + 60 / 255, 160 / 255, 1);
      const bv = cl(vv, 70 / 255, 140 / 255);
      const bg = hsv2rgb(h, bs, bv);
      const bn = hsv2rgb(h, bs, Math.max(50 / 255, bv - 20 / 255));
      const ac = hsv2rgb((h + 24) % 360, cl(s, 35 / 255, 55 / 255), cl(vv, 220 / 255, 250 / 255));
      return { bg: rgb2hex(...bg), banner: rgb2hex(...bn), accent: rgb2hex(...ac) };
    });
    studio.theme = 0;
    studio.inv();
  } catch (e) {
    studio.toast('Color pick failed: ' + e);
  }
}

export async function exportAll(exportOptions = {}) {
  const V = studio.V;
  if (!V?.src) return studio.toast('Open a video first');
  if (!(Number.isFinite(studio.trimS) && Number.isFinite(studio.trimE) && studio.trimE > studio.trimS)) {
    return studio.toast('Set a valid clip start and end first.');
  }

  // Implicit AI Clip Self-Training: learn when user exports (or fine-tunes) an AI-suggested range
  if (studio.activeAiClip && !exportOptions.skipTrainerFeedback) {
    try {
      recordTrimAdjustment(studio.activeAiClip, studio.trimS, studio.trimE, studio.subs);
    } catch {}
  }

  const T = getTauri();
  const desk = !!(T?.core && !T.__isDevBridge && studio.file);
  const jobId = 'exp_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
  const jobTitle = exportOptions.filename || studio.projectName?.trim() || studio.meta?.title || 'Clip Export';

  // Deep-clone immutable render state snapshot so user can immediately switch/edit another project
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const revokedUrls = [];
  const srcFile = studio.file;
  const srcVidUrl = srcFile ? URL.createObjectURL(srcFile) : V.src;
  if (srcFile) revokedUrls.push(srcVidUrl);

  const jobV = document.createElement('video');
  jobV.muted = true;
  jobV.volume = 0;
  jobV.playsInline = true;
  jobV.preload = 'auto';
  jobV.crossOrigin = 'anonymous';
  jobV.src = srcVidUrl;

  const jobC = document.createElement('canvas');
  jobC.width = studio.LW;
  jobC.height = studio.LH;
  jobC.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0.001;pointer-events:none;';
  document.body.appendChild(jobC);

  const jobBc = document.createElement('canvas');
  jobBc.width = Math.max(32, Math.round(studio.LW / 10));
  jobBc.height = Math.round((jobBc.width * studio.LH) / studio.LW);
  const jobBx = jobBc.getContext('2d');

  const jobCtx = {
    LW: studio.LW,
    LH: studio.LH,
    V: jobV,
    C: jobC,
    mode: studio.mode,
    aspect: studio.aspect,
    trimS: studio.trimS,
    trimE: studio.trimE,
    dur: studio.dur,
    speed: studio.speed || 1,
    grain: studio.grain || 0,
    themes: clone(studio.themes),
    theme: studio.theme,
    shift: studio.shift,
    cam: studio.cam,
    shots: clone(studio.shots),
    shotIdx: -1,
    fr: clone(studio.fr),
    fx: clone(studio.fx),
    gr: clone(studio.gr),
    spk: clone(studio.spk),
    bn: clone(studio.bn),
    wm: clone(studio.wm),
    hd: clone(studio.hd),
    du: clone(studio.du),
    st: clone(studio.st),
    subs: clone(studio.subs),
    texts: clone(studio.texts),
    mediaOverlays: clone(studio.mediaOverlays || []),
    fg: clone(studio.fg),
    fgImg: studio.fgImg,
    ovlC: studio.ovlC,
    mediaNodes: new Map(),
    sample: 0,
    sampleSub: 0,
    exporting: true,
    hov: 0,
    guides: 0,
    hoverLayer: null,
    saveShot() {},
    inv() {},
  };

  // Snapshot audio, export & archive settings upfront before user switches projects
  const audSnap = clone(studio.aud);
  const exSnap = clone(studio.ex);
  const projJsonSnap = studio.projJson();
  const assetLibSnap = [...studio.assetLibrary];

  let cancelled = false;
  let rafId = 0;
  let rec = null;
  let cs = null;
  let vtmp = null;
  let recordedChunks = [];
  let writeQueue = Promise.resolve();
  let writeError = null;
  let chunkCount = 0;
  let recordError = null;
  let finishLoop = null;

  studio.addExportJob({
    id: jobId,
    name: jobTitle,
    aspect: jobCtx.aspect,
    pct: 0,
    label: 'Preparing background export…',
    status: 'Initializing offscreen renderer',
    done: false,
    error: false,
    outPath: '',
    cancel: () => {
      cancelled = true;
      try { jobV.pause(); } catch {}
      try { if (rec && rec.state !== 'inactive') rec.stop(); } catch {}
      finishLoop?.(new Error('Export cancelled'));
    },
  });
  studio.toast(`Exporting "${jobTitle}" in background — you can keep editing or switch projects.`);

  const setJob = (pct, label, extra = {}) =>
    studio.updateExportJob(jobId, { pct, label, ...extra });

  const seekWait = (el, t) =>
    new Promise((resolve) => {
      if (Math.abs((el.currentTime || 0) - t) < 0.01) return resolve();
      const onSeek = () => {
        clearTimeout(tm);
        resolve();
      };
      const tm = setTimeout(onSeek, 2000);
      el.addEventListener('seeked', onSeek, { once: true });
      try { el.currentTime = t; } catch { resolve(); }
    });

  try {
    // Capture disk paths upfront BEFORE letting user reset/switch projects
    const inputPath = desk ? await ensureSourcePath() : '';
    const jobDir = desk ? await studio.projDir() : null;
    if (desk) vtmp = await T.path.join(jobDir, `render_video_${jobId}.webm`);

    // Wait for hidden offscreen video metadata
    await new Promise((resolve, reject) => {
      if (jobV.readyState >= 2) return resolve();
      jobV.onloadeddata = () => resolve();
      jobV.onerror = () => reject(new Error('Could not initialize background video decoder'));
    });
    if (cancelled) throw new Error('Export cancelled');

    // Clone active overlay nodes so switching projects never breaks running overlays
    for (const o of jobCtx.mediaOverlays) {
      const liveRec = studio.mediaNodes.get(o.id);
      if (!liveRec?.el) continue;
      if (o.type === 'image') {
        jobCtx.mediaNodes.set(o.id, { el: liveRec.el });
      } else {
        const asset = assetLibSnap.find((a) => a.id === o.assetId || a.path === o.path);
        const ovUrl = asset?.file ? URL.createObjectURL(asset.file) : liveRec.el.src;
        if (asset?.file) revokedUrls.push(ovUrl);
        const ovEl = document.createElement('video');
        ovEl.muted = true;
        ovEl.volume = 0;
        ovEl.playsInline = true;
        ovEl.loop = o.loop !== false;
        ovEl.playbackRate = jobCtx.speed;
        ovEl.crossOrigin = 'anonymous';
        ovEl.src = ovUrl;
        await new Promise((res) => {
          if (ovEl.readyState >= 2) return res();
          ovEl.onloadeddata = () => res();
          ovEl.onerror = () => res();
        });
        jobCtx.mediaNodes.set(o.id, { el: ovEl });
      }
    }

    cs = jobC.captureStream(30);
    if (!desk) {
      try {
        (jobV.captureStream ? jobV.captureStream() : jobV.mozCaptureStream()).getAudioTracks().forEach((a) => cs.addTrack(a));
      } catch {}
    }

    const mt = (desk
      ? ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      : ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm']
    ).find((m) => MediaRecorder.isTypeSupported(m));
    if (!mt) throw new Error('Compatible MediaRecorder codec not supported.');

    rec = new MediaRecorder(cs, { mimeType: mt, videoBitsPerSecond: 16e6 });
    rec.addEventListener('error', (e) => (recordError = e.error || new Error('Recorder error')), { once: true });
    rec.addEventListener('dataavailable', (e) => {
      if (!e.data || !e.data.size) return;
      const part = e.data;
      if (!desk) {
        recordedChunks.push(part);
        return;
      }
      writeQueue = writeQueue
        .then(async () => {
          if (writeError) return;
          const bytes = new Uint8Array(await part.arrayBuffer());
          await T.core.invoke(chunkCount === 0 ? 'write_file' : 'append_file', bytes, {
            headers: { path: encodeURIComponent(vtmp) },
          });
          chunkCount++;
        })
        .catch((err) => {
          writeError = err;
        });
    });

    jobV.playbackRate = jobCtx.speed;
    await seekWait(jobV, jobCtx.trimS);
    for (const o of jobCtx.mediaOverlays) {
      const ovEl = jobCtx.mediaNodes.get(o.id)?.el;
      if (ovEl?.tagName === 'VIDEO') {
        const start = Number(o.start) || 0;
        const end = Number.isFinite(+o.end) ? +o.end : jobCtx.dur;
        if (jobCtx.trimS >= start && jobCtx.trimS <= end) {
          const elDur = Number.isFinite(ovEl.duration) && ovEl.duration > 0 ? ovEl.duration : 0;
          const raw = Math.max(0, jobCtx.trimS - start);
          await seekWait(ovEl, o.loop !== false && elDur > 0 ? raw % elDur : raw);
        }
      }
    }

    const drawLoop = () => {
      if (cancelled) return;
      renderCanvasFrame(jobC, 1, null, jobCtx, jobBc, jobBx);
      rafId = requestAnimationFrame(drawLoop);
    };
    drawLoop();

    const stopped = () =>
      new Promise((resolve, reject) => {
        if (!rec || rec.state === 'inactive') return resolve();
        let fin = false;
        const tm = setTimeout(() => !fin && ((fin = true), reject(new Error('Recorder close timeout'))), 15000);
        rec.addEventListener('stop', () => !fin && ((fin = true), clearTimeout(tm), resolve()), { once: true });
        try { rec.stop(); } catch (err) {
          if (!fin) { fin = true; clearTimeout(tm); reject(err); }
        }
      });

    rec.start(1000);
    setJob(1, 'Rendering background frames · 0%');
    await jobV.play();

    const spd = Math.max(0.25, Math.abs(jobV.playbackRate) || 1);
    const expectedMs = ((jobCtx.trimE - jobCtx.trimS) / spd) * 1000;
    await new Promise((resolve, reject) => {
      let settled = false;
      const fin = (err) => {
        if (settled) return;
        settled = true;
        clearInterval(iv);
        clearTimeout(to);
        jobV.removeEventListener('ended', onEnd);
        err ? reject(err) : resolve();
      };
      finishLoop = fin;
      const onEnd = () => fin();
      const iv = setInterval(() => {
        const p = Math.min(100, Math.max(0, Math.round(((jobV.currentTime - jobCtx.trimS) / (jobCtx.trimE - jobCtx.trimS)) * 100)));
        setJob(desk ? Math.round(p * 0.4) : p, `Rendering in background · ${p}%`);
        if (jobV.currentTime >= jobCtx.trimE - 0.015 || jobV.ended) fin();
      }, 150);
      const to = setTimeout(() => fin(new Error('Background render timeout')), Math.max(30000, expectedMs + 30000));
      jobV.addEventListener('ended', onEnd, { once: true });
    });

    if (cancelled) throw new Error('Export cancelled');
    cancelAnimationFrame(rafId);
    jobV.pause();
    for (const r of jobCtx.mediaNodes.values()) {
      if (r.el?.tagName === 'VIDEO') try { r.el.pause(); } catch {}
    }

    await stopped();
    await writeQueue;
    if (recordError) throw recordError;
    if (writeError) throw new Error('Write error: ' + writeError);

    const safeName = String(exportOptions.filename || jobTitle || 'clip').replace(/[^a-zA-Z0-9._-]+/g, '_');

    if (!desk) {
      const outBlob = new Blob(recordedChunks, { type: mt });
      const ext = mt.includes('mp4') ? '.mp4' : '.webm';
      await saveBlob(outBlob, safeName + ext);
      setJob(100, 'Export complete', { done: true, status: 'Downloaded: ' + safeName + ext });
      studio.toast('Background export finished: ' + safeName + ext);
      return;
    }

    if (chunkCount === 0) throw new Error('Recorder produced zero video chunks.');
    setJob(45, 'Encoding MP4 & mastering audio (FFmpeg)…');
    const hex = jobCtx.mode === 'simple' ? 'SIMPLE' : themeAt(jobCtx.trimS, jobCtx).accent.replace('#', '').toUpperCase();
    const out = await T.path.join(jobDir, `${safeName}_${hex}.mp4`);

    await T.core.invoke('finalize_export', {
      video: vtmp,
      source: inputPath,
      audioSource: audSnap.track || '',
      start: jobCtx.trimS,
      dur: jobCtx.trimE - jobCtx.trimS,
      speed: jobCtx.speed || 1,
      enhance: !!audSnap.enh,
      pre: audSnap.pre || '',
      vocals: !!audSnap.vocals,
      demucs: audSnap.model,
      crf: exSnap.crf,
      out,
    });

    setJob(95, 'Validating exported MP4…');
    const expDur = await T.core.invoke('media_duration', { path: out });
    if (!Number.isFinite(expDur) || expDur <= 0) throw new Error('Export validation failed: MP4 unreadable.');

    if (exSnap.arch) {
      await writeBlobToPath(await T.path.join(jobDir, 'subtitles.srt'), new Blob([jobCtx.subs.map((s, i) => `${i + 1}\n${fts(s.s)} --> ${fts(s.e)}\n${s.t}\n`).join('\n')]));
      await writeBlobToPath(await T.path.join(jobDir, 'project.json'), new Blob([JSON.stringify(projJsonSnap, null, 1)]));
    }

    setJob(100, 'Export complete', { done: true, outPath: out, status: 'Saved: ' + out });
    studio.toast('Export complete: ' + out.split(/[\\/]/).pop());
    T.core.invoke('reveal', { path: out }).catch(() => {});
  } catch (e) {
    const msg = String(e?.message || e);
    const isCancel = msg === 'Export cancelled';
    setJob(0, isCancel ? 'Cancelled' : 'Export failed', {
      done: true,
      error: !isCancel,
      status: isCancel ? 'Cancelled by user' : 'Error: ' + msg,
    });
    if (!isCancel) studio.toast('Background export failed: ' + msg);
  } finally {
    cancelAnimationFrame(rafId);
    if (cs) try { cs.getTracks().forEach((t) => t.stop()); } catch {}
    try { jobV.pause(); jobV.removeAttribute('src'); jobV.load(); } catch {}
    for (const r of jobCtx.mediaNodes.values()) {
      if (r.el?.tagName === 'VIDEO') {
        try { r.el.pause(); r.el.removeAttribute('src'); r.el.load(); } catch {}
      }
    }
    try { jobC.remove(); } catch {}
    for (const u of revokedUrls) {
      try { URL.revokeObjectURL(u); } catch {}
    }
  }
}

export async function makeThumb(V, C) {
  if (!V?.src || !C) return null;
  const was = V.paused;
  V.pause();
  C.width = studio.LW;
  C.height = studio.LH;
  studio.exporting = true;
  studio.sample = 1;
  renderCanvasFrame(C, 1);
  const blob = await new Promise((r) => C.toBlob(r, 'image/png'));
  studio.sample = 0;
  studio.exporting = false;
  C.width = Math.round(studio.LW * studio.previewScale);
  C.height = Math.round(studio.LH * studio.previewScale);
  studio.inv();
  if (!was) V.play();
  return blob;
}

export async function writeBlobToPath(path, blob) {
  const T = getTauri();
  await T.core.invoke('write_file', new Uint8Array(await blob.arrayBuffer()), {
    headers: { path: encodeURIComponent(path) },
  });
}

export async function saveBlob(blob, filename) {
  const T = getTauri();
  if (T?.dialog && !T.__isDevBridge) {
    try {
      const p = await T.dialog.save({ defaultPath: filename });
      if (!p) return;
      await writeBlobToPath(p, blob);
      return studio.toast('Saved ' + p);
    } catch (e) {
      studio.toast('Save failed: ' + e);
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

export async function ensureSourcePath() {
  const T = getTauri();
  if (studio.path) return studio.path;
  if (!studio.file) throw new Error('Open a video or add audio before running this step.');
  const ext = (studio.file.name.match(/\.\w+$/) || ['.mp4'])[0];
  const p = await T.path.join(await T.path.tempDir(), 'ics_src_' + Date.now() + ext);
  await writeBlobToPath(p, studio.file);
  studio.path = p;
  return p;
}
