<script>
  import { fmt, studio } from '../state.svelte.js';
  import Icon from './Icon.svelte';

  let laneEl = $state(null);
  let scrollEl = $state(null);
  let drag = $state(null);

  const d = $derived(studio.dur || studio.audioDuration || 1);
  const phPx = $derived(laneEl ? (studio.playhead / d) * laneEl.clientWidth : 0);

  const ticks = $derived.by(() => {
    const step = d > 180 ? 30 : d > 60 ? 10 : d > 20 ? 5 : 1;
    const out = [];
    for (let t = 0; t <= d; t += step) out.push({ t, left: (t / d) * 100 });
    return out;
  });

  function timeAtEvent(e) {
    const r = laneEl.getBoundingClientRect();
    return Math.min(d, Math.max(0, ((e.clientX - r.left) / r.width) * d));
  }

  function maybeSnap(val, ignoreId = null) {
    if (!studio.snapGrid) return val;
    const tol = Math.max(0.08, d * 0.008 / (studio.timelineZoom || 1));
    const points = [0, studio.playhead, studio.trimS, studio.trimE];
    for (const s of studio.subs) {
      if (s.id !== ignoreId) points.push(s.s, s.e);
    }
    let best = val;
    let bestDiff = tol;
    for (const p of points) {
      const diff = Math.abs(val - p);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = p;
      }
    }
    return best;
  }

  function onPointerDown(e) {
    if (!d) return;
    const blk = e.target.closest('.blk');
    if (!blk) {
      drag = { k: 'seek' };
      studio.seek(timeAtEvent(e));
      laneEl.setPointerCapture(e.pointerId);
      return;
    }
    const r = blk.getBoundingClientRect();
    const m = e.clientX - r.left < 7 ? 'l' : r.right - e.clientX < 7 ? 'r' : 'm';
    const tr = blk.dataset.tr;
    if (tr === 'au') {
      drag = { k: 'seek' };
      studio.seek(timeAtEvent(e));
      laneEl.setPointerCapture(e.pointerId);
      return;
    }
    if (tr === 'vd') {
      if (m === 'm') return;
      drag = { k: 'vd', m };
    } else {
      const arr = tr === 'sb' ? studio.subs : tr === 'ov' ? studio.mediaOverlays : studio.texts;
      const o = arr.find((x) => x.id === +blk.dataset.id);
      if (!o) return;
      if (tr === 'ov') {
        studio.selectedOverlayId = o.id;
        studio.sel = null;
      } else {
        studio.sel = o.id;
        studio.selectedOverlayId = null;
      }
      drag = { k: 'blk', tr, o, m, x0: timeAtEvent(e), s0: o.s ?? o.start, e0: o.e ?? o.end };
    }
    laneEl.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!drag) return;
    const t = timeAtEvent(e);
    if (drag.k === 'seek') {
      studio.seek(t);
    } else if (drag.k === 'vd') {
      const snapped = maybeSnap(t);
      if (drag.m === 'l') studio.trimS = Math.min(snapped, studio.trimE - 0.2);
      else studio.trimE = Math.max(snapped, studio.trimS + 0.2);
      studio.inv();
    } else if (drag.k === 'blk') {
      const o = drag.o;
      const dx = t - drag.x0;
      const isOv = drag.tr === 'ov';
      let ns = isOv ? o.start : o.s;
      let ne = isOv ? o.end : o.e;
      if (drag.m === 'm') {
        const len = drag.e0 - drag.s0;
        const cand = Math.min(Math.max(0, drag.s0 + dx), Math.max(0, d - len));
        ns = Math.min(Math.max(0, maybeSnap(cand, o.id)), Math.max(0, d - len));
        ne = ns + len;
      } else if (drag.m === 'l') {
        ns = Math.min(Math.max(0, maybeSnap(drag.s0 + dx, o.id)), ne - 0.1);
      } else {
        ne = Math.max(ns + 0.1, Math.min(d, maybeSnap(drag.e0 + dx, o.id)));
      }
      if (isOv) {
        o.start = +ns.toFixed(2);
        o.end = +ne.toFixed(2);
      } else {
        o.s = ns;
        o.e = ne;
        o.rawS = ns;
        o.rawE = ne;
      }
      studio.inv();
    }
  }

  function splitAtPlayhead() {
    const t = studio.currentPlayhead();
    const ix = studio.subs.findIndex((s) => t > s.s + 0.05 && t < s.e - 0.05);
    if (ix < 0) return studio.toast('Move playhead inside a subtitle block to split');
    const s = studio.subs[ix];
    const ws = s.t.trim().split(/\s+/);
    const ratio = (t - s.s) / Math.max(0.1, s.e - s.s);
    const splitIdx = Math.max(1, Math.min(ws.length - 1, Math.round(ws.length * ratio)));
    const right = { ...s, id: studio.nextId(), s: t, rawS: t, t: ws.slice(splitIdx).join(' ') || '…' };
    s.e = t;
    s.rawE = t;
    s.t = ws.slice(0, splitIdx).join(' ') || s.t;
    studio.subs.splice(ix + 1, 0, right);
    studio.sel = right.id;
    studio.inv();
    studio.snap();
  }

  function deleteSelected() {
    if (studio.selectedOverlayId) {
      studio.mediaOverlays = studio.mediaOverlays.filter((o) => o.id !== studio.selectedOverlayId);
      studio.selectedOverlayId = null;
      studio.inv();
      studio.snap();
      return;
    }
    if (studio.sel) {
      const sIdx = studio.subs.findIndex((s) => s.id === studio.sel);
      if (sIdx >= 0) {
        studio.subs.splice(sIdx, 1);
        studio.sel = null;
        studio.inv();
        studio.snap();
        return;
      }
      const tIdx = studio.texts.findIndex((x) => x.id === studio.sel);
      if (tIdx >= 0) {
        studio.texts.splice(tIdx, 1);
        studio.sel = null;
        studio.inv();
        studio.snap();
      }
    }
  }

  function onDoubleClick(e) {
    const blk = e.target.closest('.blk');
    if (!blk) return;
    const id = +blk.dataset.id;
    if (blk.dataset.tr === 'sb') {
      const sub = studio.subs.find((x) => x.id === id);
      if (!sub) return;
      studio.sel = id;
      studio.seek(sub.s);
      studio.leftTab = 'subtitles';
      studio.sideTab = 'subs';
    } else if (blk.dataset.tr === 'tx') {
      const tx = studio.texts.find((x) => x.id === id);
      if (!tx) return;
      studio.sel = id;
      studio.selectedOverlayId = null;
      studio.seek(tx.s);
      studio.leftTab = 'banners';
      studio.sideTab = 'txt';
    } else if (blk.dataset.tr === 'ov') {
      const ov = (studio.mediaOverlays || []).find((x) => x.id === id);
      if (!ov) return;
      studio.selectedOverlayId = id;
      studio.sel = null;
      studio.seek(ov.start || 0);
      studio.leftTab = 'media';
    }
  }
</script>

<section class="tl-dock" aria-label="Multi-track timeline">
  <div class="tl-tools">
    <div class="rt" style="gap:4px">
      <button type="button" class="xs ghost" onclick={splitAtPlayhead} title="Split subtitle block at playhead (S)">
        <Icon name="scissors" size={13} />
        <span>Split</span>
      </button>
      <button
        type="button"
        class="xs"
        class:pri={studio.snapGrid}
        onclick={() => (studio.snapGrid = !studio.snapGrid)}
        title="Snap edges to playhead and adjacent blocks"
      >
        <Icon name="magnet" size={12} />
        <span>Snap</span>
      </button>
      {#if studio.sel || studio.selectedOverlayId}
        <button type="button" class="xs danger" onclick={deleteSelected} title="Remove selected block">
          <Icon name="trash" size={12} />
          <span>Delete</span>
        </button>
      {/if}
    </div>

    <div class="rt" style="gap:6px;margin-left:auto">
      <span class="hint" style="margin:0;font-size:11px">Drag edges to trim · Double-click to inspect</span>
      <span class="v-div"></span>
      <button
        type="button"
        class="xs ghost"
        onclick={() => (studio.timelineZoom = Math.max(1, studio.timelineZoom - 0.5))}
        title="Zoom out timeline"
        aria-label="Zoom out timeline"
      >
        <Icon name="zoom-out" size={13} />
      </button>
      <input
        type="range"
        min="1"
        max="8"
        step="0.25"
        style="width:96px"
        bind:value={studio.timelineZoom}
        aria-label="Timeline zoom"
      />
      <button
        type="button"
        class="xs ghost"
        onclick={() => (studio.timelineZoom = Math.min(8, studio.timelineZoom + 0.5))}
        title="Zoom in timeline"
        aria-label="Zoom in timeline"
      >
        <Icon name="zoom-in" size={13} />
      </button>
      <span class="badge mono">{studio.timelineZoom.toFixed(1).replace(/\.0$/, '')}×</span>
      <button
        type="button"
        class="xs ghost"
        onclick={() => {
          studio.timelineZoom = 1;
          if (scrollEl) scrollEl.scrollLeft = 0;
        }}
        title="Fit timeline to view"
      >
        Fit
      </button>
    </div>
  </div>

  <div class="tl-body">
    <!-- Fixed Left Track Headers -->
    <div class="tl-headers">
      <div class="hdr-ruler mono">{fmt(studio.playhead)}</div>
      <div class="hdr-row"><span class="trk-dot" style="background:var(--tl-video)"></span><span>V1 Video</span></div>
      <div class="hdr-row"><span class="trk-dot" style="background:var(--tl-audio)"></span><span>A1 Audio</span></div>
      <div class="hdr-row"><span class="trk-dot" style="background:var(--tl-sub)"></span><span>S1 Subtitles</span></div>
      <div class="hdr-row"><span class="trk-dot" style="background:var(--tl-ov)"></span><span>OV Overlays</span></div>
      <div class="hdr-row"><span class="trk-dot" style="background:var(--tl-txt)"></span><span>T1 Text</span></div>
    </div>

    <!-- Scrollable Track Lanes -->
    <div class="tl-scroll" bind:this={scrollEl}>
      <div
        class="lane"
        role="region"
        aria-label="Timeline tracks"
        bind:this={laneEl}
        style="width:{studio.timelineZoom * 100}%"
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={() => {
          if (drag && drag.k !== 'seek') studio.snap();
          drag = null;
        }}
        ondblclick={onDoubleClick}
      >
        <div class="ruler">
          {#each ticks as tk}
            <span class="tick mono" style="left:{tk.left}%">{fmt(tk.t).slice(0, -2)}</span>
          {/each}
        </div>

        <div class="trk">
          {#each studio.shots.slice(1) as sh}
            <u class="cut" style="left:{(sh.t / d) * 100}%"></u>
          {/each}
          <div
            class="blk vd"
            data-tr="vd"
            style="left:{(studio.trimS / d) * 100}%;width:{((studio.trimE - studio.trimS) / d) * 100}%"
          >
            {studio.file?.name || 'Active Video'} · {fmt(studio.trimS)} – {fmt(studio.trimE)}
          </div>
        </div>

        <div class="trk">
          {#if studio.aud.track}
            <div
              class="blk au"
              data-tr="au"
              style="left:0;width:{Math.min(100, ((studio.audioDuration || d) / d) * 100)}%"
            >
              {studio.aud.trackName || 'Audio track'} · {fmt(studio.audioDuration || d)}
            </div>
          {:else}
            <span class="empty-lane">Embedded video audio</span>
          {/if}
        </div>

        <div class="trk">
          {#each studio.subs as o (o.id)}
            <div
              class="blk sb"
              class:on={studio.sel === o.id || studio.act === o.id}
              data-id={o.id}
              data-tr="sb"
              style="left:{(o.s / d) * 100}%;width:{Math.max(((o.e - o.s) / d) * 100, 0.35)}%"
            >
              {o.t}
            </div>
          {/each}
        </div>

        <div class="trk">
          {#each studio.mediaOverlays as o (o.id)}
            <div
              class="blk ov"
              class:on={studio.selectedOverlayId === o.id}
              data-id={o.id}
              data-tr="ov"
              style="left:{((o.start || 0) / d) * 100}%;width:{Math.max((((o.end || d) - (o.start || 0)) / d) * 100, 0.6)}%"
            >
              {o.name}
            </div>
          {/each}
        </div>

        <div class="trk">
          {#each studio.texts as o (o.id)}
            <div
              class="blk tx"
              class:on={studio.sel === o.id}
              data-id={o.id}
              data-tr="tx"
              style="left:{(o.s / d) * 100}%;width:{Math.max(((o.e - o.s) / d) * 100, 0.35)}%"
            >
              {o.t}
            </div>
          {/each}
        </div>

        <div class="playhead" style="transform:translateX({phPx}px)"></div>
      </div>
    </div>
  </div>
</section>

<style>
  .tl-dock {
    grid-area: t;
    background: var(--bg-rail);
    border-top: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }
  .tl-tools {
    height: 32px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }
  .v-div {
    width: 1px;
    height: 14px;
    background: var(--border-color);
  }
  .tl-body {
    flex: 1;
    display: flex;
    min-height: 0;
    overflow: hidden;
  }
  .tl-headers {
    width: 112px;
    flex-shrink: 0;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    padding-bottom: 6px;
  }
  .hdr-ruler {
    height: 22px;
    padding: 0 10px;
    font-size: 11px;
    font-weight: 600;
    color: var(--accent);
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--border-color);
  }
  .hdr-row {
    height: 30px;
    margin-top: 3px;
    padding: 0 10px;
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11px;
    font-weight: 560;
    color: var(--text-secondary);
  }
  .trk-dot {
    width: 7px;
    height: 7px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .tl-scroll {
    flex: 1;
    overflow-x: auto;
    overflow-y: hidden;
    min-width: 0;
    background: var(--bg-canvas);
  }
  .lane {
    position: relative;
    min-width: 100%;
    user-select: none;
    padding-bottom: 6px;
  }
  .ruler {
    position: relative;
    height: 22px;
    background: var(--bg-titlebar);
    border-bottom: 1px solid var(--border-color);
    cursor: pointer;
    overflow: hidden;
  }
  .tick {
    position: absolute;
    font-size: 9.8px;
    color: var(--text-thirdly);
    padding-left: 4px;
    border-left: 1px solid var(--border-mid);
    line-height: 21px;
  }
  .trk {
    position: relative;
    height: 30px;
    margin-top: 3px;
    background: var(--bg-primary);
    border-top: 1px solid var(--border-color);
    border-bottom: 1px solid var(--border-color);
  }
  .empty-lane {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 10.5px;
    color: var(--text-muted);
  }
  .cut {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--accent-amber);
    pointer-events: none;
    z-index: 2;
  }
  .blk {
    position: absolute;
    top: 3px;
    bottom: 3px;
    border-radius: var(--radius-xs);
    padding: 0 7px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 10.8px;
    line-height: 22px;
    cursor: grab;
    color: #ffffff;
    min-width: 4px;
    border: 1px solid rgba(255, 255, 255, 0.14);
  }
  .blk:active {
    cursor: grabbing;
  }
  .blk.vd { background: var(--tl-video); cursor: default; }
  .blk.au { background: var(--tl-audio); cursor: pointer; }
  .blk.sb { background: var(--tl-sub); }
  .blk.ov { background: var(--tl-ov); }
  .blk.tx { background: var(--tl-txt); }
  .blk.on {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
    filter: brightness(1.12);
  }
  .blk::before,
  .blk::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 5px;
    cursor: ew-resize;
  }
  .blk::before { left: 0; }
  .blk::after { right: 0; }
  .playhead {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 1.5px;
    background: var(--accent);
    pointer-events: none;
    z-index: 5;
    will-change: transform;
  }
  .playhead::before {
    content: '';
    position: absolute;
    top: 0;
    left: -5px;
    border-left: 5.5px solid transparent;
    border-right: 5.5px solid transparent;
    border-top: 7px solid var(--accent);
  }
</style>
