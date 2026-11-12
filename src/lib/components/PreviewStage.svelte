<script>
  import { onMount } from 'svelte';
  import { DIMS } from '../constants.js';
  import { createTimedBackground, loadVideoPath, openVideoFile } from '../mediaHelpers.js';
  import { renderCanvasFrame, resizeScratch, vg } from '../renderer.js';
  import { cl, fmt, studio } from '../state.svelte.js';
  import { applyStudioPreset, BUILT_IN_STUDIO_PRESETS } from '../studioPresets.js';
  import { getTauri } from '../tauriBridge.js';
  import Icon from './Icon.svelte';

  let { onOpenProjects = () => {}, onSelectWorkflow = () => {} } = $props();

  let stageEl = $state(null);
  let wrapEl = $state(null);
  let canvasEl = $state(null);
  let pd = $state(null);
  let subFrame = $state(null);
  let quickVidIn = $state(null);

  const formats = Object.keys(DIMS);
  const hasMediaOrSample = $derived(!!(studio.file || studio.aud.track || studio.sampleSub));
  const showSubBbox = $derived(
    !!(subFrame && !studio.exporting && (studio.subBoxSelected || studio.hoverLayer === 'sub' || pd?.subResize || pd?.sub))
  );
  const selectedCanvasMeta = $derived.by(() => {
    if (studio.selectedOverlayId) {
      const ov = (studio.mediaOverlays || []).find((o) => o.id === studio.selectedOverlayId);
      if (ov) return { label: `Overlay: ${ov.name}`, visible: ov.enabled !== false, canDelete: true };
    }
    if (studio.selectedCanvasKind === 'spk') {
      return { label: 'Speaker Banner', visible: !!studio.spk.on, canDelete: true };
    }
    if (studio.selectedCanvasKind === 'bn') {
      return { label: 'News Banner', visible: !!studio.bn.on, canDelete: true };
    }
    if (studio.sel) {
      const tx = studio.texts.find((x) => x.id === studio.sel);
      if (tx) return { label: `Text: ${(tx.t || '').slice(0, 18) || 'Layer'}`, visible: tx.enabled !== false, canDelete: true };
    }
    if (studio.subBoxSelected) {
      return { label: 'Subtitles', visible: studio.st.on !== 0 && studio.st.on !== false, canDelete: false };
    }
    return null;
  });
  const subHandles = [
    { dir: 'nw', cls: 'c nw' },
    { dir: 'n', cls: 'e n' },
    { dir: 'ne', cls: 'c ne' },
    { dir: 'e', cls: 'e ev' },
    { dir: 'se', cls: 'c se' },
    { dir: 's', cls: 'e s' },
    { dir: 'sw', cls: 'c sw' },
    { dir: 'w', cls: 'e wv' },
  ];

  function launchTemplatePreview(preset) {
    applyStudioPreset(studio, preset);
    studio.sampleSub = 1;
    studio.inv();
    onSelectWorkflow(preset.bn?.on ? 'canvas' : 'style');
    studio.toast('Previewing template: ' + preset.name);
  }

  export function syncCanvasSize() {
    if (!canvasEl || !stageEl) return;
    const LW = studio.LW;
    const LH = studio.LH;
    const sc = studio.previewScale;
    canvasEl.width = Math.round(LW * sc);
    canvasEl.height = Math.round(LH * sc);
    resizeScratch(LW, LH);
    const r = LW / LH;
    const w = Math.max(100, stageEl.clientWidth - 36);
    const h = Math.max(100, stageEl.clientHeight - 58);
    let cw = w;
    let ch = w / r;
    if (ch > h) {
      ch = h;
      cw = h * r;
    }
    const z = studio.previewZoom || 1;
    const cssW = Math.max(1, cw * z) + 'px';
    const cssH = Math.max(1, ch * z) + 'px';
    if (wrapEl) {
      wrapEl.style.width = cssW;
      wrapEl.style.height = cssH;
    }
    canvasEl.style.width = cssW;
    canvasEl.style.height = cssH;
    studio.inv();
  }

  onMount(() => {
    studio.C = canvasEl;
    syncCanvasSize();
    const ro = new ResizeObserver(syncCanvasSize);
    ro.observe(stageEl);

    let raf = 0;
    const tick = () => {
      const V = studio.V;
      const A = studio.A;
      const ph = studio.currentPlayhead();
      studio.playhead = ph;
      studio.playing = !!((V && !V.paused) || (A && !A.paused));
      if (!studio.exporting && V?.src && !V.paused && studio.trimE > 0 && V.currentTime >= studio.trimE) {
        if (studio.loopRange) {
          studio.seek(studio.trimS);
        } else {
          V.pause();
          if (studio.aud.track && A) A.pause();
        }
      }
      if ((V && !V.paused) || (A && !A.paused) || studio.exporting || studio.dirty > 0) {
        if (studio.dirty > 0) studio.dirty--;
        const sc = studio.exporting ? 1 : studio.previewScale;
        renderCanvasFrame(canvasEl, sc, pd);
        const nb = studio.subMaxBox;
        if (!nb && subFrame) subFrame = null;
        else if (
          nb &&
          (!subFrame ||
            Math.abs(nb.x - subFrame.x) >= 0.4 ||
            Math.abs(nb.y - subFrame.y) >= 0.4 ||
            Math.abs(nb.w - subFrame.w) >= 0.4 ||
            Math.abs(nb.h - subFrame.h) >= 0.4 ||
            nb.autoH !== subFrame.autoH)
        ) {
          subFrame = { ...nb };
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  });

  $effect(() => {
    void studio.aspect;
    void studio.previewScale;
    void studio.previewZoom;
    syncCanvasSize();
  });

  $effect(() => {
    void studio.st.w;
    void studio.st.wPx;
    void studio.st.wUnit;
    void studio.st.maxH;
    void studio.st.maxHPx;
    void studio.st.hUnit;
    void studio.st.x;
    void studio.st.y;
    void studio.st.auto;
    void studio.st.marginX;
    void studio.subBoxSelected;
    studio.inv();
  });

  async function quickPickVideo() {
    const T = getTauri();
    if (T?.dialog) {
      try {
        const p = await T.dialog.open({ filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }] });
        if (p) await loadVideoPath(p);
      } catch (e) {
        studio.toast(String(e));
      }
    } else {
      quickVidIn?.click();
    }
  }

  const cp = (e) => {
    const r = canvasEl.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * studio.LW, ((e.clientY - r.top) / r.height) * studio.LH];
  };
  const hit = (b, x, y) => b && x >= b.x - 20 && x <= b.x + b.w + 20 && y >= b.y - 20 && y <= b.y + b.h + 20;
  const inBox = (b, x, y) => b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

  function onPointerDown(e) {
    const [x, y] = cp(e);
    const fb = studio.frBox;
    const box = studio.fr.on && fb ? fb : { x: 0, y: 0, w: studio.LW, h: studio.LH };
    const txtObj = [...studio.texts].reverse().find((o) => o.enabled !== false && hit(o.box, x, y));
    const ovObj = [...(studio.mediaOverlays || [])].reverse().find((o) => o.enabled !== false && hit(o._box, x, y));
    const wantSpk = studio.spk.on && studio.spkBox && hit(studio.spkBox, x, y);
    const wantBn = studio.bn.on && studio.bnBox && hit(studio.bnBox, x, y);

    const wantSrc = studio.du.on && studio.duSourceBox && hit(studio.duSourceBox, x, y);
    const wantTr = studio.du.on && studio.duTransBox && hit(studio.duTransBox, x, y);

    if (wantSrc || wantTr || (fb && Math.hypot(x - (fb.x + fb.w), y - (fb.y + fb.h)) < 48) || wantBn || wantSpk || ovObj || txtObj) {
      studio.subBoxSelected = false;
      if (studio.hoverLayer === 'sub') studio.hoverLayer = null;
    }

    if ((wantSrc || wantTr) && (studio.du.dragTarget === 'source' || studio.du.dragTarget === 'translation')) {
      const tgt = studio.du.dragTarget === 'translation' ? (wantTr ? 'translation' : null) : wantSrc ? 'source' : null;
      if (tgt) {
        pd = {
          du: tgt,
          x0: x,
          y0: y,
          sx: (tgt === 'source' ? studio.du.sourceX : studio.du.transX) ?? 50,
          sy: (tgt === 'source' ? studio.du.sourceY : studio.du.transY) ?? (tgt === 'source' ? 44 : 56),
        };
        canvasEl.setPointerCapture(e.pointerId);
        return;
      }
    } else if (wantSrc && wantTr) {
      const ds = Math.hypot(x - (studio.duSourceBox.x + studio.duSourceBox.w / 2), y - (studio.duSourceBox.y + studio.duSourceBox.h / 2));
      const dt = Math.hypot(x - (studio.duTransBox.x + studio.duTransBox.w / 2), y - (studio.duTransBox.y + studio.duTransBox.h / 2));
      const tgt = dt < ds ? 'translation' : 'source';
      pd = {
        du: tgt,
        x0: x,
        y0: y,
        sx: (tgt === 'source' ? studio.du.sourceX : studio.du.transX) ?? 50,
        sy: (tgt === 'source' ? studio.du.sourceY : studio.du.transY) ?? (tgt === 'source' ? 44 : 56),
      };
      canvasEl.setPointerCapture(e.pointerId);
      return;
    } else if (wantSrc || wantTr) {
      const tgt = wantSrc ? 'source' : 'translation';
      pd = {
        du: tgt,
        x0: x,
        y0: y,
        sx: (tgt === 'source' ? studio.du.sourceX : studio.du.transX) ?? 50,
        sy: (tgt === 'source' ? studio.du.sourceY : studio.du.transY) ?? (tgt === 'source' ? 44 : 56),
      };
      canvasEl.setPointerCapture(e.pointerId);
      return;
    }

    if (fb && Math.hypot(x - (fb.x + fb.w), y - (fb.y + fb.h)) < 48) pd = { rs: 1, x0: x, w0: studio.fr.w };
    else if (wantBn) {
      studio.selectedOverlayId = null;
      studio.sel = null;
      studio.selectedCanvasKind = 'bn';
      pd = { bn: 1, x0: x, y0: y, bx: studio.bn.x ?? 50, by: studio.bn.y ?? 88 };
    } else if (wantSpk) {
      studio.selectedOverlayId = null;
      studio.sel = null;
      studio.selectedCanvasKind = 'spk';
      studio.spk.pos = 'custom';
      pd = { spk: 1, x0: x, y0: y, sx: studio.spk.x ?? 50, sy: studio.spk.y ?? 66 };
    } else if (ovObj) {
      studio.selectedCanvasKind = null;
      studio.sel = null;
      studio.selectedOverlayId = ovObj.id;
      pd = { ov: ovObj, x0: x, y0: y, ox: ovObj.x ?? 50, oy: ovObj.y ?? 50 };
    } else if (txtObj) {
      studio.selectedCanvasKind = null;
      studio.selectedOverlayId = null;
      studio.sel = txtObj.id;
      pd = { o: txtObj };
    } else if (hit(studio.subBox, x, y) || hit(studio.subMaxBox, x, y)) {
      studio.selectedCanvasKind = 'sub';
      studio.selectedOverlayId = null;
      studio.subBoxSelected = true;
      pd = { sub: 1, x0: x, y0: y, sx: studio.st.x ?? 50, sy: studio.st.y ?? 80 };
    } else if (inBox(box, x, y)) {
      studio.clearSelection();
      if (studio.hoverLayer === 'sub') studio.hoverLayer = null;
      pd =
        studio.fr.on && (studio.dm === 'frame' || e.shiftKey)
          ? { fr: 1, x0: x, y0: y, fx: studio.fr.x, fy: studio.fr.y }
          : { pan: 1, x0: x, y0: y, px: studio.fx.px, py: studio.fx.py, bw: box.w, bh: box.h };
    } else {
      studio.clearSelection();
      if (studio.hoverLayer === 'sub') studio.hoverLayer = null;
      return;
    }

    canvasEl.setPointerCapture(e.pointerId);
    studio.inv();
  }

  function onPointerMove(e) {
    const [x, y] = cp(e);
    if (!pd) {
      let h = null;
      if (studio.du.on && studio.duTransBox && hit(studio.duTransBox, x, y) && (!hit(studio.duSourceBox, x, y) || studio.du.dragTarget === 'translation')) h = 'duTrans';
      else if (studio.du.on && studio.duSourceBox && hit(studio.duSourceBox, x, y)) h = 'duSource';
      else if (studio.bn.on && studio.bnBox && hit(studio.bnBox, x, y)) h = 'bn';
      else if (studio.spk.on && studio.spkBox && hit(studio.spkBox, x, y)) h = 'spk';
      else if ((studio.mediaOverlays || []).some((o) => hit(o._box, x, y))) {
        const ov = [...(studio.mediaOverlays || [])].reverse().find((o) => hit(o._box, x, y));
        studio.selectedOverlayId = ov?.id || null;
        h = 'overlay';
      } else if (studio.texts.some((o) => hit(o.box, x, y))) h = 'text';
      else if (hit(studio.subBox, x, y) || hit(studio.subMaxBox, x, y)) h = 'sub';
      if (h !== studio.hoverLayer) {
        studio.hoverLayer = h;
        studio.inv();
      }
      return;
    }
    if (pd.du) {
      const pfx = pd.du === 'source' ? 'source' : 'trans';
      let nx = pd.sx + ((x - pd.x0) / studio.LW) * 100;
      let ny = pd.sy + ((y - pd.y0) / studio.LH) * 100;
      if (Math.abs(nx - 50) < 1.4) nx = 50;
      if (Math.abs(ny - 50) < 1.4) ny = 50;
      studio.du[pfx + 'X'] = cl(Math.round(nx * 10) / 10, 5, 95);
      studio.du[pfx + 'Y'] = cl(Math.round(ny * 10) / 10, 5, 95);
      studio.inv();
      return;
    }
    if (pd.bn) {
      let nx = pd.bx + ((x - pd.x0) / studio.LW) * 100;
      let ny = pd.by + ((y - pd.y0) / studio.LH) * 100;
      if (Math.abs(nx - 50) < 1.5) nx = 50;
      studio.bn.x = cl(Math.round(nx * 10) / 10, 10, 90);
      studio.bn.y = cl(Math.round(ny * 10) / 10, 5, 96);
    } else if (pd.spk) {
      let nx = pd.sx + ((x - pd.x0) / studio.LW) * 100;
      let ny = pd.sy + ((y - pd.y0) / studio.LH) * 100;
      if (Math.abs(nx - 50) < 1.5) nx = 50;
      studio.spk.x = cl(Math.round(nx * 10) / 10, 5, 95);
      studio.spk.y = cl(Math.round(ny * 10) / 10, 5, 95);
    } else if (pd.ov) {
      let nx = pd.ox + ((x - pd.x0) / studio.LW) * 100;
      let ny = pd.oy + ((y - pd.y0) / studio.LH) * 100;
      if (Math.abs(nx - 50) < 1.5) nx = 50;
      if (Math.abs(ny - 50) < 1.5) ny = 50;
      pd.ov.x = cl(Math.round(nx * 10) / 10, 0, 100);
      pd.ov.y = cl(Math.round(ny * 10) / 10, 0, 100);
    } else if (pd.rs) studio.fr.w = cl(Math.round((pd.w0 + ((x - pd.x0) / studio.LW) * 200) * 10) / 10, 30, 100);
    else if (pd.o) {
      pd.o.x = Math.round((x / studio.LW) * 1000) / 10;
      pd.o.y = Math.round((y / studio.LH) * 1000) / 10;
    } else if (pd.fr) {
      let nx = pd.fx + ((x - pd.x0) / studio.LW) * 100;
      let ny = pd.fy + ((y - pd.y0) / studio.LH) * 100;
      if (Math.abs(nx - 50) < 1.5) nx = 50;
      if (Math.abs(ny - 50) < 1.5) ny = 50;
      studio.fr.x = Math.round(nx * 10) / 10;
      studio.fr.y = Math.round(ny * 10) / 10;
    } else if (pd.pan) {
      const [dw, dh] = vg(pd.bw, pd.bh, studio.fx.zoom / 100);
      const mx = ((dw - pd.bw) / 2 / pd.bw) * 100;
      const my = ((dh - pd.bh) / 2 / pd.bh) * 100;
      studio.fx.px = Math.round(cl(pd.px + ((x - pd.x0) / pd.bw) * 100, -mx, mx) * 10) / 10;
      studio.fx.py = Math.round(cl(pd.py + ((y - pd.y0) / pd.bh) * 100, -my, my) * 10) / 10;
      studio.saveShot();
    } else if (pd.sub) {
      const vY = cl(Math.round((pd.sy + ((y - pd.y0) / studio.LH) * 100) * 10) / 10, 5, 95);
      let vX = pd.sx + ((x - pd.x0) / studio.LW) * 100;
      if (Math.abs(vX - 50) < 1.4) vX = 50;
      vX = cl(Math.round(vX * 10) / 10, 10, 90);
      const a = studio.subs.find((s) => s.id === studio.act);
      if (a?.st && a.st.y !== undefined) a.st.y = vY;
      else {
        studio.st.y = vY;
        studio.st.x = vX;
        studio.st.auto = 0;
      }
    }
    studio.inv();
  }

  function onWheel(e) {
    e.preventDefault();
    const d = e.deltaY < 0 ? 1 : -1;
    const [wx, wy] = cp(e);
    if (studio.du.on && studio.duTransBox && hit(studio.duTransBox, wx, wy) && (!hit(studio.duSourceBox, wx, wy) || studio.du.dragTarget === 'translation')) {
      studio.du.transSize = cl((studio.du.transSize || 32) + d * 2, 14, 120);
      studio.inv();
      return;
    }
    if (studio.du.on && studio.duSourceBox && hit(studio.duSourceBox, wx, wy)) {
      studio.du.size = cl((studio.du.size || 44) + d * 2, 16, 140);
      studio.inv();
      return;
    }
    if (studio.bn.on && studio.bnBox && hit(studio.bnBox, wx, wy)) {
      studio.bn.fontSize = cl((studio.bn.fontSize ?? 36) + d * 2, 18, 72);
      studio.inv();
      return;
    }
    if (studio.spk.on && studio.spkBox && hit(studio.spkBox, wx, wy)) {
      studio.spk.scale = cl((studio.spk.scale ?? 100) + d * 4, 50, 180);
      studio.inv();
      return;
    }
    const ovObj = [...(studio.mediaOverlays || [])].reverse().find((o) => hit(o._box, wx, wy));
    if (ovObj) {
      ovObj.w = cl((ovObj.w || 30) + d * 3, 5, 100);
      ovObj.h = cl((ovObj.h || 30) + d * 3, 5, 100);
      studio.inv();
      return;
    }
    if (hit(studio.subBox, wx, wy)) {
      const a = studio.subs.find((q) => q.id === studio.act);
      if (a?.st && a.st.size !== undefined) a.st.size = cl(a.st.size + d * 2, 10, 300);
      else studio.st.size = cl(studio.st.size + d * 2, 20, 200);
      studio.inv();
      return;
    }
    if (studio.fr.on && (studio.dm === 'frame' || e.shiftKey)) studio.fr.w = cl(studio.fr.w + d * 2, 30, 100);
    else {
      studio.fx.zoom = cl(studio.fx.zoom + d * 4, 100, 300);
      studio.saveShot();
    }
    studio.inv();
  }

  function startSubResize(dir, e) {
    if (!subFrame) return;
    e.stopPropagation();
    e.preventDefault();
    studio.subBoxSelected = true;
    const [x0, y0] = cp(e);
    pd = {
      subResize: dir,
      x0,
      y0,
      left0: subFrame.x,
      right0: subFrame.x + subFrame.w,
      top0: subFrame.y,
      bot0: subFrame.y + subFrame.h,
      cx0: subFrame.cx,
      cy0: subFrame.cy,
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  }

  function endSubResize() {
    if (pd?.subResize) {
      pd = null;
      studio.snap();
      studio.inv();
    }
  }

  function onResizeHandleMove(e) {
    if (!pd?.subResize || !subFrame) return;
    const [cx, cy] = cp(e);
    const W = studio.LW;
    const H = studio.LH;
    const dx = cx - pd.x0;
    const dy = cy - pd.y0;
    const marginPct = cl(Number(studio.st.marginX ?? 6), 0, 25) / 100;
    const minEdge = W * marginPct;
    const minBoxW = Math.max(180, W * 0.18);
    const minBoxH = Math.max(56, H * 0.05);
    const resScale = Math.min(W, H) / 1080;
    const d = pd.subResize;

    if (d.includes('w') || d.includes('e')) {
      let newL = pd.left0;
      let newR = pd.right0;
      if (e.altKey) {
        const delta = d.includes('e') ? dx : -dx;
        const half = cl((pd.right0 - pd.left0) * 0.5 + delta, minBoxW * 0.5, Math.min(pd.cx0 - minEdge, W - minEdge - pd.cx0));
        newL = pd.cx0 - half;
        newR = pd.cx0 + half;
      } else if (d.includes('e')) {
        newR = cl(pd.right0 + dx, pd.left0 + minBoxW, W - minEdge);
      } else {
        newL = cl(pd.left0 + dx, minEdge, pd.right0 - minBoxW);
      }
      const newW = newR - newL;
      let nx = ((newL + newW * 0.5) / W) * 100;
      if (Math.abs(nx - 50) < 1.2) nx = 50;
      studio.st.x = cl(Math.round(nx * 10) / 10, 10, 90);
      if (studio.st.wUnit === 'px') {
        studio.st.wPx = cl(Math.round(newW / resScale / 2) * 2, 220, 1800);
      } else {
        studio.st.w = cl(Math.round((newW / W) * 1000) / 10, 20, 96);
      }
    }

    if (d.includes('n') || d.includes('s')) {
      let newT = pd.top0;
      let newB = pd.bot0;
      if (e.altKey) {
        const delta = d.includes('s') ? dy : -dy;
        const half = cl((pd.bot0 - pd.top0) * 0.5 + delta, minBoxH * 0.5, Math.min(pd.cy0 - 12, H - 12 - pd.cy0));
        newT = pd.cy0 - half;
        newB = pd.cy0 + half;
      } else if (d.includes('s')) {
        newB = cl(pd.bot0 + dy, pd.top0 + minBoxH, H - 12);
      } else {
        newT = cl(pd.top0 + dy, 12, pd.bot0 - minBoxH);
      }
      const newH = newB - newT;
      const ny = ((newT + newH * 0.5) / H) * 100;
      studio.st.auto = 0;
      studio.st.y = cl(Math.round(ny * 10) / 10, 5, 95);
      if (studio.st.hUnit === 'px') {
        studio.st.maxHPx = cl(Math.round(newH / resScale / 2) * 2, 60, 900);
      } else {
        studio.st.maxH = cl(Math.round((newH / H) * 1000) / 10, 6, 70);
      }
    }
    studio.inv();
  }

  export async function togglePlay() {
    const V = studio.V;
    const A = studio.A;
    if (!V?.src && !studio.aud.track) return studio.toast('Drop a video or add audio first.');
    if (!V?.src && studio.aud.track) {
      const img = studio.assetLibrary.find((a) => a.type === 'image');
      if (img) {
        try {
          await createTimedBackground(img);
        } catch {}
      }
    }
    const isPlaying = (V && !V.paused) || (A && !A.paused);
    if (!isPlaying) {
      if (V?.src) {
        if (V.currentTime >= studio.trimE - 0.05) V.currentTime = studio.trimS;
        V.playbackRate = studio.speed || 1;
        V.play().catch((e) => studio.toast('Playback failed: ' + e.message));
      }
      if (studio.aud.track && A?.src) {
        if (A.currentTime >= A.duration - 0.05) A.currentTime = studio.trimS;
        A.playbackRate = studio.speed || 1;
        A.play().catch((e) => studio.toast('Audio playback failed: ' + e.message));
      }
    } else {
      V?.pause();
      A?.pause();
    }
  }
</script>

<svelte:window onkeydown={(e) => {
  if (e.key === 'Escape' && studio.subBoxSelected) {
    studio.subBoxSelected = false;
    studio.inv();
  }
}} />

<input
  bind:this={quickVidIn}
  type="file"
  accept="video/*"
  hidden
  onchange={(e) => {
    const f = e.currentTarget.files?.[0];
    if (f) openVideoFile(f);
    e.currentTarget.value = '';
  }}
/>

<section class="stage-col">
  <div class="stage-canvas-area" bind:this={stageEl}>
    <div class="hud-top">
      <div class="hud-group">
        {#each formats as f}
          <button
            type="button"
            class:on={studio.aspect === f}
            onclick={() => {
              studio.aspect = f;
              studio.inv();
            }}
          >
            {f}
          </button>
        {/each}
      </div>

      <div class="hud-group">
        <select
          class="mini-sel"
          aria-label="Preview zoom"
          value={String(studio.previewZoom)}
          onchange={(e) => (studio.previewZoom = +e.currentTarget.value)}
        >
          <option value="0.75">Zoom 75%</option>
          <option value="1">Fit 100%</option>
          <option value="1.25">125%</option>
          <option value="1.5">150%</option>
        </select>
        <button
          type="button"
          class:on={!!studio.sampleSub}
          onclick={() => {
            studio.sampleSub ^= 1;
            studio.inv();
          }}
          title="Toggle preview sample subtitles"
        >
          <Icon name="eye" size={13} /> Sample
        </button>
        <button
          type="button"
          class:on={!!studio.guides}
          onclick={() => {
            studio.guides ^= 1;
            studio.inv();
          }}
          title="Toggle social platform safe-zone overlay"
        >
          Safe zones
        </button>
        {#if studio.guides}
          <select class="mini-sel" value={studio.guideMode} onchange={(e) => ((studio.guideMode = e.currentTarget.value), studio.inv())}>
            <option value="reels">Reels</option>
            <option value="tiktok">TikTok</option>
            <option value="shorts">Shorts</option>
          </select>
        {/if}
      </div>
    </div>

    <div class="canvas-scroll">
      <div class="canvas-stage-wrap" bind:this={wrapEl}>
        <canvas
          bind:this={canvasEl}
          class="canvas-el"
          onpointerenter={() => {
            studio.hov = 1;
            studio.inv();
          }}
          onpointerleave={() => {
            studio.hov = 0;
            studio.hoverLayer = null;
            studio.inv();
          }}
          onpointerdown={onPointerDown}
          onpointermove={onPointerMove}
          onpointerup={() => {
            if (pd) studio.snap();
            pd = null;
          }}
          onwheel={onWheel}
        ></canvas>
        {#if showSubBbox}
          <div
            class="sub-bbox"
            class:selected={studio.subBoxSelected || !!pd?.subResize || !!pd?.sub}
            class:hoverOnly={!studio.subBoxSelected && studio.hoverLayer === 'sub'}
            style="left:{(subFrame.x / studio.LW) * 100}%;top:{(subFrame.y / studio.LH) * 100}%;width:{(subFrame.w / studio.LW) * 100}%;height:{(subFrame.h / studio.LH) * 100}%"
            aria-label="Subtitle layout bounding box"
          >
            {#if studio.subBoxSelected || pd?.subResize}
              {#each subHandles as h (h.dir)}
                <button
                  type="button"
                  class="sub-handle {h.cls}"
                  aria-label="Resize subtitle box {h.dir}"
                  onpointerdown={(e) => startSubResize(h.dir, e)}
                  onpointermove={onResizeHandleMove}
                  onpointerup={endSubResize}
                  onpointercancel={endSubResize}
                ></button>
              {/each}
            {/if}
            {#if pd?.subResize || studio.subBoxSelected}
              <div class="sub-dim-pill mono" class:below={subFrame.y < studio.LH * 0.12}>
                {studio.st.wUnit === 'px' ? `${studio.st.wPx}px` : `${studio.st.w}%`} × {studio.st.hUnit === 'px' ? (studio.st.maxHPx > 0 ? `${studio.st.maxHPx}px` : 'Auto') : (studio.st.maxH > 0 ? `${studio.st.maxH}%` : 'Auto')}
                <span class="px-sub">({Math.round(subFrame.w)}×{Math.round(subFrame.h)})</span>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>

    {#if selectedCanvasMeta}
      <div class="canvas-sel-bar" role="toolbar" aria-label="Selected canvas element actions">
        <span class="sel-name">{selectedCanvasMeta.label}</span>
        <button
          type="button"
          class="xs"
          onclick={() => studio.toggleSelectedVisibility()}
          title={selectedCanvasMeta.visible ? 'Hide element' : 'Show element'}
        >
          <Icon name={selectedCanvasMeta.visible ? 'eye-off' : 'eye'} size={12} />
          <span>{selectedCanvasMeta.visible ? 'Hide' : 'Show'}</span>
        </button>
        {#if selectedCanvasMeta.canDelete}
          <button
            type="button"
            class="xs danger"
            onclick={() => studio.deleteSelectedBlock()}
            title="Delete selected element (Undo restores)"
          >
            <Icon name="trash" size={12} />
            <span>Delete</span>
          </button>
        {/if}
        <button type="button" class="xs ghost" onclick={() => studio.clearSelection()} title="Deselect">
          <Icon name="x" size={12} />
        </button>
      </div>
    {/if}

  </div>

  <!-- Minimalist Pro Transport Bar -->
  <div class="transport-bar">
    <div class="tr-left">
      <button type="button" class="xs ghost" onclick={() => ((studio.trimS = Math.min(studio.currentPlayhead(), studio.trimE - 0.2)), studio.inv())} title="Set clip start (I)">
        [ In
      </button>
      <button type="button" class="xs ghost" onclick={() => ((studio.trimE = Math.max(studio.currentPlayhead(), studio.trimS + 0.2)), studio.inv())} title="Set clip end (O)">
        Out ]
      </button>
      <button
        type="button"
        class="xs"
        class:pri={studio.loopRange}
        onclick={() => (studio.loopRange = !studio.loopRange)}
        title="Loop range"
      >
        <Icon name="repeat" size={12} /> Loop
      </button>
    </div>

    <div class="tr-center">
      <button type="button" class="xs ghost" onclick={() => studio.seek(studio.trimS)} title="Jump to In point">
        <Icon name="skip-back" size={13} />
      </button>
      <button type="button" class="play-btn" onclick={togglePlay} title="Play / Pause (Space)" aria-label="Play or pause">
        <Icon name={studio.playing ? 'pause' : 'play'} size={14} />
      </button>
      <button type="button" class="xs ghost" onclick={() => studio.seek(studio.trimE || studio.dur)} title="Jump to Out point">
        <Icon name="skip-forward" size={13} />
      </button>
      <span class="time-pill mono">{fmt(studio.playhead)} / {fmt(studio.dur || studio.audioDuration)}</span>
    </div>

    <div class="tr-right">
      <button
        type="button"
        class="xs"
        class:pri={studio.dm === 'frame'}
        onclick={() => (studio.dm = studio.dm === 'video' ? 'frame' : 'video')}
        title="Toggle canvas drag target between panning video or moving card frame"
      >
        {studio.dm === 'frame' ? 'Move Card' : 'Pan Video'}
      </button>
      <select
        class="mini-sel"
        aria-label="Playback speed"
        value={String(studio.speed)}
        onchange={(e) => {
          studio.speed = +e.currentTarget.value;
          if (studio.V) studio.V.playbackRate = studio.speed;
          if (studio.A) studio.A.playbackRate = studio.speed;
        }}
      >
        <option value="0.5">0.5×</option>
        <option value="0.75">0.75×</option>
        <option value="1">1×</option>
        <option value="1.25">1.25×</option>
        <option value="1.5">1.5×</option>
        <option value="2">2×</option>
      </select>
      <select
        class="mini-sel"
        value={String(studio.previewScale)}
        onchange={(e) => {
          studio.previewScale = +e.currentTarget.value;
          syncCanvasSize();
        }}
      >
        <option value="0.35">Fast</option>
        <option value="0.5">Balanced</option>
        <option value="1">Sharp</option>
      </select>
    </div>
  </div>
</section>

<style>
  .stage-col {
    grid-area: m;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
    background: var(--bg-canvas);
  }
  .stage-canvas-area {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    background: var(--bg-canvas);
  }
  .canvas-scroll {
    flex: 1;
    width: 100%;
    min-height: 0;
    overflow: auto;
    display: grid;
    place-items: center;
    padding: 46px 18px 14px;
  }
  .canvas-el {
    background: #000000;
    border-radius: var(--radius-sm);
    box-shadow: var(--shadow-lg), 0 0 0 1px var(--border-mid);
    cursor: move;
    touch-action: none;
    display: block;
  }
  .canvas-stage-wrap {
    position: relative;
    line-height: 0;
  }
  .sub-bbox {
    position: absolute;
    box-sizing: border-box;
    pointer-events: none;
    z-index: 3;
    border: 1.5px solid rgba(59, 130, 246, 0.92);
    border-radius: 4px;
    box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.45);
    transition: border-color 120ms ease;
  }
  .sub-bbox.hoverOnly {
    border-style: dashed;
    border-color: rgba(96, 165, 250, 0.78);
    background: rgba(59, 130, 246, 0.04);
  }
  .sub-bbox.selected {
    border-color: #3b82f6;
    background: rgba(59, 130, 246, 0.05);
  }
  .sub-handle {
    position: absolute;
    pointer-events: auto;
    padding: 0;
    border: 0;
    background: transparent;
    touch-action: none;
    z-index: 4;
  }
  .sub-handle::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #ffffff;
    border: 1.5px solid #2563eb;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
    transition: transform 90ms ease, background 90ms ease;
  }
  .sub-handle:hover::after {
    background: #dbeafe;
    transform: translate(-50%, -50%) scale(1.18);
  }
  .sub-handle.c {
    width: 22px;
    height: 22px;
  }
  .sub-handle.c::after {
    width: 9px;
    height: 9px;
    border-radius: 2px;
  }
  .sub-handle.nw { top: -11px; left: -11px; cursor: nwse-resize; }
  .sub-handle.ne { top: -11px; right: -11px; cursor: nesw-resize; }
  .sub-handle.se { bottom: -11px; right: -11px; cursor: nwse-resize; }
  .sub-handle.sw { bottom: -11px; left: -11px; cursor: nesw-resize; }

  .sub-handle.n { top: -10px; left: 12px; right: 12px; height: 20px; cursor: ns-resize; }
  .sub-handle.s { bottom: -10px; left: 12px; right: 12px; height: 20px; cursor: ns-resize; }
  .sub-handle.n::after,
  .sub-handle.s::after {
    width: 20px;
    height: 5px;
    border-radius: 99px;
  }
  .sub-handle.wv { left: -10px; top: 12px; bottom: 12px; width: 20px; cursor: ew-resize; }
  .sub-handle.ev { right: -10px; top: 12px; bottom: 12px; width: 20px; cursor: ew-resize; }
  .sub-handle.wv::after,
  .sub-handle.ev::after {
    width: 5px;
    height: 20px;
    border-radius: 99px;
  }
  .sub-dim-pill {
    position: absolute;
    left: 50%;
    top: -24px;
    transform: translateX(-50%);
    background: rgba(15, 23, 42, 0.9);
    border: 1px solid rgba(59, 130, 246, 0.65);
    color: #e2e8f0;
    font-size: 10px;
    line-height: 1.3;
    padding: 2px 7px;
    border-radius: 99px;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  }
  .sub-dim-pill.below {
    top: auto;
    bottom: -24px;
  }
  .sub-dim-pill .px-sub {
    opacity: 0.72;
    margin-left: 3px;
  }
  .hud-top {
    position: absolute;
    top: 10px;
    left: 14px;
    right: 14px;
    display: flex;
    justify-content: space-between;
    pointer-events: none;
    z-index: 4;
  }
  .hud-group {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 3px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-sm);
  }
  .hud-group button {
    border: 0;
    background: transparent;
    padding: 4px 9px;
    border-radius: var(--radius-sm);
    font-size: 11.2px;
    color: var(--text-thirdly);
    font-weight: 560;
  }
  .hud-group button:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .hud-group button.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .transport-bar {
    height: 44px;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    background: var(--bg-titlebar);
    border-top: 1px solid var(--border-color);
    flex-shrink: 0;
  }
  .tr-left,
  .tr-center,
  .tr-right {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tr-center {
    justify-content: center;
  }
  .tr-right {
    justify-content: flex-end;
  }
  .play-btn {
    width: 30px;
    height: 30px;
    padding: 0;
    border-radius: 50%;
    background: var(--accent);
    border-color: transparent;
    color: #ffffff;
  }
  .play-btn:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .time-pill {
    font-size: 11.5px;
    color: var(--text-secondary);
    padding-left: 6px;
    font-weight: 560;
  }
  .mini-sel {
    padding: 3px 20px 3px 8px;
    font-size: 11.2px;
    border-radius: var(--radius-sm);
    background: var(--bg-elevated);
  }
  .canvas-sel-bar {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 8;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border-radius: 10px;
    background: rgba(17, 20, 27, 0.92);
    border: 1px solid var(--border-strong);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(10px);
  }
  .sel-name {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-primary);
    padding: 0 4px;
    max-width: 180px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  @media (max-width: 980px) {
    .tr-left {
      display: none;
    }
    .transport-bar {
      grid-template-columns: auto 1fr;
    }
  }
</style>
