<script>
  import { onMount } from 'svelte';
  import { DIMS } from '../constants.js';
  import { createTimedBackground, openVideoFile, pickAndOpenVideo } from '../mediaHelpers.js';
  import { renderCanvasFrame, resizeScratch, vg } from '../renderer.js';
  import { cl, fmt, studio } from '../state.svelte.js';
  import { applyStudioPreset, BUILT_IN_STUDIO_PRESETS } from '../studioPresets.js';
  import { viewport } from '../webPlatform/viewport.svelte.js';
  import Icon from './Icon.svelte';

  let { onOpenProjects = () => {}, onSelectWorkflow = () => {} } = $props();

  let stageEl = $state(null);
  let canvasEl = $state(null);
  let pd = $state(null);
  let quickVidIn = $state(null);
  let hudControlsOpen = $state(false);
  const touchPts = new Map();
  let pinchState = null;

  const formats = Object.keys(DIMS);
  const hasMediaOrSample = $derived(!!(studio.file || studio.aud.track || studio.sampleSub));

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
    const padW = viewport.isMobile ? 16 : 36;
    const padH = viewport.isMobile ? 46 : 58;
    const w = Math.max(96, stageEl.clientWidth - padW);
    const h = Math.max(96, stageEl.clientHeight - padH);
    let cw = w;
    let ch = w / r;
    if (ch > h) {
      ch = h;
      cw = h * r;
    }
    const z = studio.previewZoom || 1;
    canvasEl.style.width = Math.max(1, cw * z) + 'px';
    canvasEl.style.height = Math.max(1, ch * z) + 'px';
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
    void studio.previewFullscreen;
    void viewport.width;
    void viewport.height;
    syncCanvasSize();
  });

  async function quickPickVideo() {
    const ok = await pickAndOpenVideo();
    if (!ok && !window.showOpenFilePicker) quickVidIn?.click();
  }

  const cp = (e) => {
    const r = canvasEl.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * studio.LW, ((e.clientY - r.top) / r.height) * studio.LH];
  };
  const hit = (b, x, y) => b && x >= b.x - 20 && x <= b.x + b.w + 20 && y >= b.y - 20 && y <= b.y + b.h + 20;
  const inBox = (b, x, y) => b && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;

  function onPointerDown(e) {
    touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPts.size === 2) {
      const pts = [...touchPts.values()];
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      pinchState = { dist0: Math.max(10, dist), zoom0: studio.fx.zoom };
      pd = null;
      return;
    }
    const [x, y] = cp(e);
    const fb = studio.frBox;
    const box = studio.fr.on && fb ? fb : { x: 0, y: 0, w: studio.LW, h: studio.LH };
    const txtObj = [...studio.texts].reverse().find((o) => hit(o.box, x, y));
    const ovObj = [...(studio.mediaOverlays || [])].reverse().find((o) => hit(o._box, x, y));
    const wantSpk = studio.spk.on && studio.spkBox && hit(studio.spkBox, x, y);
    const wantBn = studio.bn.on && studio.bnBox && hit(studio.bnBox, x, y);

    const wantSrc = studio.du.on && studio.duSourceBox && hit(studio.duSourceBox, x, y);
    const wantTr = studio.du.on && studio.duTransBox && hit(studio.duTransBox, x, y);

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
      pd = { bn: 1, x0: x, y0: y, bx: studio.bn.x ?? 50, by: studio.bn.y ?? 88 };
    } else if (wantSpk) {
      studio.spk.pos = 'custom';
      pd = { spk: 1, x0: x, y0: y, sx: studio.spk.x ?? 50, sy: studio.spk.y ?? 66 };
    } else if (ovObj) {
      studio.selectedOverlayId = ovObj.id;
      pd = { ov: ovObj, x0: x, y0: y, ox: ovObj.x ?? 50, oy: ovObj.y ?? 50 };
    } else if (txtObj) {
      studio.sel = txtObj.id;
      pd = { o: txtObj };
    } else if (hit(studio.subBox, x, y)) pd = { sub: 1 };
    else if (inBox(box, x, y)) {
      pd =
        studio.fr.on && (studio.dm === 'frame' || e.shiftKey)
          ? { fr: 1, x0: x, y0: y, fx: studio.fr.x, fy: studio.fr.y, cx0: e.clientX, cy0: e.clientY }
          : { pan: 1, x0: x, y0: y, px: studio.fx.px, py: studio.fx.py, bw: box.w, bh: box.h, cx0: e.clientX, cy0: e.clientY };
    } else {
      pd = { tapOnly: 1, cx0: e.clientX, cy0: e.clientY };
    }

    if (pd) pd.moved = false;
    try { canvasEl.setPointerCapture(e.pointerId); } catch {}
    studio.inv();
  }

  function onPointerMove(e) {
    if (touchPts.has(e.pointerId)) {
      touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pinchState && touchPts.size === 2) {
      const pts = [...touchPts.values()];
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const scale = dist / pinchState.dist0;
      studio.fx.zoom = cl(Math.round(pinchState.zoom0 * scale), 100, 300);
      studio.saveShot();
      studio.inv();
      return;
    }
    if (pd && pd.cx0 !== undefined && Math.hypot(e.clientX - pd.cx0, e.clientY - pd.cy0) > 6) {
      pd.moved = true;
    }
    if (pd?.tapOnly) return;
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
      else if (hit(studio.subBox, x, y)) h = 'sub';
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
      const v = cl(Math.round((y / studio.LH) * 100), 5, 95);
      const a = studio.subs.find((s) => s.id === studio.act);
      if (a?.st && a.st.y !== undefined) a.st.y = v;
      else {
        studio.st.y = v;
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

<section class="stage-col" class:fs={studio.previewFullscreen}>
  <div class="stage-canvas-area" bind:this={stageEl}>
    <div class="hud-top">
      <div class="hud-group aspect-group">
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
        {#if !viewport.isMobile || hudControlsOpen}
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
            <Icon name="eye" size={13} /> {!viewport.isMobile ? 'Sample' : ''}
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
            Safe
          </button>
          {#if studio.guides}
            <select class="mini-sel" value={studio.guideMode} onchange={(e) => ((studio.guideMode = e.currentTarget.value), studio.inv())}>
              <option value="reels">Reels</option>
              <option value="tiktok">TikTok</option>
              <option value="shorts">Shorts</option>
            </select>
          {/if}
        {/if}
        {#if viewport.isMobile}
          <button type="button" class:on={hudControlsOpen} onclick={() => (hudControlsOpen = !hudControlsOpen)} aria-label="Toggle canvas tools">
            <Icon name="sliders" size={13} />
          </button>
        {/if}
        <button
          type="button"
          class:on={studio.previewFullscreen}
          onclick={() => (studio.previewFullscreen = !studio.previewFullscreen)}
          title={studio.previewFullscreen ? 'Exit fullscreen preview' : 'Expand fullscreen preview'}
          aria-label="Toggle fullscreen preview"
        >
          <Icon name={studio.previewFullscreen ? 'minimize' : 'maximize'} size={13} />
        </button>
      </div>
    </div>

    <div class="canvas-scroll">
      <canvas
        bind:this={canvasEl}
        class="canvas-el"
        onpointerenter={() => {
          studio.hov = 1;
          studio.inv();
        }}
        onpointerleave={(e) => {
          touchPts.delete(e.pointerId);
          studio.hov = 0;
          studio.hoverLayer = null;
          studio.inv();
        }}
        onpointercancel={(e) => {
          touchPts.delete(e.pointerId);
          pinchState = null;
          pd = null;
        }}
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={(e) => {
          touchPts.delete(e.pointerId);
          if (touchPts.size < 2) pinchState = null;
          if (viewport.isCoarse && pd && !pd.moved && (pd.tapOnly || pd.pan) && hasMediaOrSample) {
            togglePlay();
          } else if (pd && !pd.tapOnly) {
            studio.snap();
          }
          pd = null;
        }}
        onwheel={onWheel}
      ></canvas>
    </div>

    {#if !hasMediaOrSample}
      <div class="empty-stage-card">
        <div class="es-icon"><Icon name="media" size={22} /></div>
        <h3>No Video Loaded</h3>
        <p class="hint" style="margin:4px 0 14px">
          {viewport.isMobile ? 'Tap Open Video to pick from your phone library or preview a look.' : 'Drop a video file directly onto the canvas, import media, or preview a sample template layout.'}
        </p>
        <div class="bar" style="justify-content:center;margin:0">
          <button type="button" class="sm pri" onclick={quickPickVideo}>
            <Icon name="upload" size={13} /> Open Video
          </button>
          <button type="button" class="sm" onclick={() => onSelectWorkflow('media')}>
            <Icon name="layers" size={13} /> Media &amp; Audio
          </button>
          <button type="button" class="sm ghost" onclick={() => launchTemplatePreview(BUILT_IN_STUDIO_PRESETS[0])}>
            Preview Look
          </button>
        </div>
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
  .stage-col.fs {
    position: fixed;
    inset: 0;
    z-index: 65;
    padding-top: var(--sat);
    padding-bottom: var(--sab);
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
  .empty-stage-card {
    position: absolute;
    background: var(--bg-secondary);
    border: 1px solid var(--border-mid);
    border-radius: var(--radius-xl);
    padding: 24px 26px;
    text-align: center;
    max-width: 390px;
    box-shadow: var(--shadow-lg);
    z-index: 5;
  }
  .empty-stage-card h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 650;
  }
  .es-icon {
    width: 42px;
    height: 42px;
    border-radius: var(--radius-lg);
    background: var(--accent-soft);
    color: var(--accent);
    display: inline-grid;
    place-items: center;
    margin-bottom: 10px;
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
  @media (max-width: 980px) {
    .tr-left {
      display: none;
    }
    .transport-bar {
      grid-template-columns: auto 1fr;
      padding: 0 10px;
    }
    .hud-top {
      left: 8px;
      right: 8px;
      top: 8px;
      gap: 4px;
    }
    .hud-group button {
      padding: 4px 6px;
      font-size: 10.8px;
    }
    .canvas-scroll {
      padding: 42px 8px 8px;
    }
    .empty-stage-card {
      max-width: calc(100vw - 24px);
      padding: 18px 16px;
    }
  }
</style>
