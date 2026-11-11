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
  let canvasEl = $state(null);
  let pd = $state(null);
  let quickVidIn = $state(null);

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
    const w = Math.max(100, stageEl.clientWidth - 28);
    const h = Math.max(100, stageEl.clientHeight - 28);
    let cw = w;
    let ch = w / r;
    if (ch > h) {
      ch = h;
      cw = h * r;
    }
    canvasEl.style.width = Math.max(1, cw) + 'px';
    canvasEl.style.height = Math.max(1, ch) + 'px';
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
    syncCanvasSize();
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
          ? { fr: 1, x0: x, y0: y, fx: studio.fr.x, fy: studio.fr.y }
          : { pan: 1, x0: x, y0: y, px: studio.fx.px, py: studio.fx.py, bw: box.w, bh: box.h };
    } else return;

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
        <button
          type="button"
          class:on={!!studio.sampleSub}
          onclick={() => {
            studio.sampleSub ^= 1;
            studio.inv();
          }}
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

    {#if !hasMediaOrSample}
      <div class="start-dashboard">
        <div class="sd-hero">
          <div class="wc-icon"><Icon name="film" size={24} /></div>
          <div class="sd-hero-txt">
            <div class="rt" style="gap:8px">
              <h3>InstaClip Studio</h3>
              <span class="badge pri">PRO v1.5</span>
            </div>
            <p class="hint" style="margin:3px 0 0">
              Drop any video file anywhere, download from URL, or start from a broadcast-ready look.
            </p>
          </div>
        </div>

        <div class="sd-actions">
          <button type="button" class="sd-action-card pri-card" onclick={quickPickVideo}>
            <span class="sd-act-ic"><Icon name="upload" size={18} /></span>
            <span class="sd-act-body">
              <b>Open Local Video</b>
              <span>MP4, MOV, MKV, WebM</span>
            </span>
          </button>

          <button type="button" class="sd-action-card" onclick={() => onSelectWorkflow('media')}>
            <span class="sd-act-ic"><Icon name="download" size={18} /></span>
            <span class="sd-act-body">
              <b>URL &amp; Media Bin</b>
              <span>YouTube, B-Roll, Audio</span>
            </span>
          </button>

          <button type="button" class="sd-action-card" onclick={onOpenProjects}>
            <span class="sd-act-ic"><Icon name="folder" size={18} /></span>
            <span class="sd-act-body">
              <b>Projects Library</b>
              <span>{studio.projects.length} saved · Import .JSON</span>
            </span>
          </button>
        </div>

        <div class="sd-section">
          <div class="sd-sec-hdr">
            <span>INSTANT TEMPLATE PREVIEWS</span>
            <button type="button" class="xs ghost" onclick={() => onSelectWorkflow('presets')}>All Presets →</button>
          </div>
          <div class="sd-tpl-grid">
            {#each BUILT_IN_STUDIO_PRESETS as bp (bp.id)}
              <button type="button" class="sd-tpl" onclick={() => launchTemplatePreview(bp)}>
                <div class="rt" style="justify-content:space-between;width:100%">
                  <b>{bp.name}</b>
                  <span class="badge">{bp.format}</span>
                </div>
                <span class="sd-tpl-desc">{bp.description}</span>
              </button>
            {/each}
          </div>
        </div>

        {#if studio.projects.length}
          <div class="sd-section" style="margin-top:12px">
            <div class="sd-sec-hdr">
              <span>RECENT PROJECTS</span>
              <button type="button" class="xs ghost" onclick={onOpenProjects}>Manage All →</button>
            </div>
            <div class="sd-recent-row">
              {#each studio.projects.slice(0, 3) as p (p.id)}
                <button type="button" class="sd-recent-chip" onclick={onOpenProjects}>
                  <b>{p.name || 'Untitled'}</b>
                  <span>{p.state?.subs?.length || 0} cues · {p.state?.aspect || '9:16'}</span>
                </button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}

    {#if studio.exporting}
      <div class="export-cover">
        <div>
          <div style="font-size:20px;font-weight:700;margin-bottom:8px">Rendering MP4…</div>
          <div class="pbar" style="width:320px;margin:12px auto"><i style="width:{studio.exportPct}%"></i></div>
          <div class="hint">{studio.exportLabel}</div>
        </div>
      </div>
    {/if}
  </div>

  <!-- Centered Sleek Transport Bar -->
  <div class="transport-bar">
    <div class="tr-pill">
      <button type="button" class="pri sm" onclick={togglePlay}>
        <Icon name={studio.playing ? 'pause' : 'play'} size={13} />
        {studio.playing ? 'Pause' : 'Play'}
      </button>
      <span class="time-pill mono">{fmt(studio.playhead)} / {fmt(studio.dur || studio.audioDuration)}</span>
      <button
        type="button"
        class="xs ghost"
        onclick={() => ((studio.trimS = Math.min(studio.currentPlayhead(), studio.trimE - 0.2)), studio.inv())}
      >
        [ In
      </button>
      <button
        type="button"
        class="xs ghost"
        onclick={() => ((studio.trimE = Math.max(studio.currentPlayhead(), studio.trimS + 0.2)), studio.inv())}
      >
        Out ]
      </button>
      <button
        type="button"
        class="xs"
        class:pri={studio.loopRange}
        onclick={() => (studio.loopRange = !studio.loopRange)}
        title="Loop between In and Out"
      >
        ↻ Loop
      </button>
      <span class="v-sep"></span>
      <button
        type="button"
        class="xs"
        class:pri={studio.dm === 'frame'}
        onclick={() => (studio.dm = studio.dm === 'video' ? 'frame' : 'video')}
      >
        {studio.dm === 'frame' ? 'Move Card' : 'Pan Video'}
      </button>
      <select
        class="mini-sel"
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
    align-items: center;
    justify-content: center;
    padding: 44px 18px 12px;
    background:
      radial-gradient(rgba(255,255,255,0.028) 1px, transparent 1px),
      radial-gradient(ellipse at 50% 60%, #0e1428 0%, var(--bg-canvas) 65%);
    background-size: 22px 22px, 100% 100%;
  }
  .canvas-el {
    max-width: 100%;
    max-height: 100%;
    background: #000;
    border-radius: var(--radius-md);
    box-shadow:
      0 32px 90px rgba(0,0,0,0.9),
      0 0 0 1px rgba(255,255,255,0.09),
      0 0 60px rgba(99,102,241,0.08);
    cursor: move;
    touch-action: none;
  }
  /* HUD overlay pill row (top) */
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
    gap: 2px;
    padding: 3px 4px;
    background: rgba(10,13,22,0.84);
    backdrop-filter: blur(14px) saturate(0.9);
    border: 1px solid var(--border-mid);
    border-radius: 99px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.055);
  }
  .hud-group button {
    border: 0;
    background: transparent;
    padding: 4px 10px;
    border-radius: 99px;
    font-size: 11px;
    color: var(--text-thirdly);
    font-weight: 600;
    letter-spacing: -0.01em;
    transition: color var(--dur-fast) ease, background var(--dur-fast) ease;
  }
  .hud-group button:hover {
    color: var(--text-primary);
    background: rgba(255,255,255,0.07);
  }
  .hud-group button.on {
    background: var(--accent-primary-soft);
    color: #e8edf8;
    box-shadow: inset 0 0 0 1px rgba(99,102,241,0.3);
  }
  /* Executive Starting Dashboard */
  .start-dashboard {
    position: absolute;
    width: 620px;
    max-width: 92%;
    max-height: calc(100% - 64px);
    overflow-y: auto;
    background: rgba(13, 17, 25, 0.94);
    backdrop-filter: blur(22px) saturate(1.1);
    border: 1px solid var(--border-mid);
    border-radius: var(--radius-xl);
    padding: 24px;
    box-shadow: var(--shadow-lg), inset 0 1px 0 rgba(255, 255, 255, 0.055);
    z-index: 5;
    animation: welcome-in 260ms var(--ease-out);
  }
  @keyframes welcome-in {
    from { opacity: 0; transform: translateY(12px) scale(0.975); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  .sd-hero {
    display: flex;
    align-items: center;
    gap: 14px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border-color);
  }
  .sd-hero h3 {
    margin: 0;
    font-size: 17px;
    letter-spacing: -0.025em;
    font-weight: 750;
  }
  .wc-icon {
    width: 46px;
    height: 46px;
    border-radius: 12px;
    background: var(--grad-accent);
    color: #fff;
    display: inline-grid;
    place-items: center;
    flex-shrink: 0;
    box-shadow: 0 6px 20px color-mix(in srgb, var(--accent-primary) 35%, transparent);
  }
  .sd-actions {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    margin: 16px 0;
  }
  .sd-action-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px;
    border-radius: var(--radius-lg);
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    text-align: left;
    justify-content: flex-start;
    white-space: normal;
  }
  .sd-action-card:hover {
    border-color: var(--accent-primary);
    background: var(--bg-hover);
  }
  .sd-action-card.pri-card {
    background: var(--grad-accent);
    border-color: transparent;
    color: #fff;
  }
  .sd-action-card.pri-card span {
    color: rgba(255, 255, 255, 0.84);
  }
  .sd-act-ic {
    width: 34px;
    height: 34px;
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.08);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .sd-act-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .sd-act-body b {
    font-size: 12.2px;
    font-weight: 650;
  }
  .sd-act-body span {
    font-size: 10.6px;
    color: var(--text-thirdly);
  }
  .sd-section {
    margin-top: 6px;
  }
  .sd-sec-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--text-thirdly);
    margin-bottom: 7px;
  }
  .sd-tpl-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .sd-tpl {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 5px;
    padding: 10px;
    border-radius: var(--radius-md);
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    text-align: left;
    white-space: normal;
  }
  .sd-tpl:hover {
    border-color: var(--accent-primary);
    background: var(--accent-primary-soft);
  }
  .sd-tpl b {
    font-size: 11.8px;
  }
  .sd-tpl-desc {
    font-size: 10.5px;
    color: var(--text-thirdly);
    line-height: 1.38;
  }
  .sd-recent-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .sd-recent-chip {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 8px 10px;
    border-radius: var(--radius-md);
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    text-align: left;
  }
  .sd-recent-chip b {
    font-size: 11.6px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }
  .sd-recent-chip span {
    font-size: 10.3px;
    color: var(--text-thirdly);
  }
  /* Export progress overlay */
  .export-cover {
    position: absolute;
    inset: 0;
    z-index: 9;
    background: rgba(6,8,13,0.92);
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
  }
  /* Transport bar */
  .transport-bar {
    display: flex;
    justify-content: center;
    padding: 7px 12px;
    background: var(--bg-canvas);
    border-top: 1px solid var(--border-color);
    flex-shrink: 0;
  }
  .tr-pill {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 99px;
    flex-wrap: wrap;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.045);
  }
  .time-pill {
    font-size: 11.5px;
    color: var(--text-secondary);
    padding: 0 5px;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .v-sep {
    width: 1px;
    height: 14px;
    background: var(--border-mid);
  }
  .mini-sel {
    padding: 3px 22px 3px 8px;
    font-size: 11px;
    border-radius: 99px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='5'%3E%3Cpath d='M0 0l4 5 4-5z' fill='%237a879f'/%3E%3C/svg%3E");
  }
</style>
