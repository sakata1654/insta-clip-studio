<script>
  import { tick } from 'svelte';
  import { fmt, studio } from '../state.svelte.js';
  import Icon from './Icon.svelte';

  let laneEl = $state(null);
  let scrollEl = $state(null);
  let drag = $state(null);
  let scrollLeft = $state(0);
  let viewWidth = $state(900);
  let editingId = $state(null);
  let editDraft = $state('');
  let editOrig = '';

  const touchPts = new Map();
  let pinchState = null;

  function focusOnMount(node) {
    queueMicrotask(() => {
      node.focus();
      node.select?.();
    });
  }

  const d = $derived(
    studio.dur ||
      studio.audioDuration ||
      (studio.subs.length ? Math.max(1, ...studio.subs.map((o) => o.e || 0)) : 1)
  );
  const maxZoom = $derived(Math.max(48, Math.min(240, Math.round(d * 1.6))));
  const laneWidth = $derived(Math.max(viewWidth, viewWidth * (studio.timelineZoom || 1)));
  const pxPerSec = $derived(laneWidth / Math.max(0.1, d));
  const phPx = $derived((studio.playhead / d) * laneWidth);

  // Logarithmic 0..100 slider mapping <-> [1 .. maxZoom] for silky-smooth progressive zoom
  const zoomSlider = $derived(
    maxZoom <= 1 ? 0 : Math.round((Math.log(Math.max(1, studio.timelineZoom || 1)) / Math.log(maxZoom)) * 100)
  );

  // Visible viewport time window (+ buffer) for lag-free 1,000+ subtitle performance
  const visStart = $derived(Math.max(0, (scrollLeft / laneWidth) * d - d * (0.15 / (studio.timelineZoom || 1))));
  const visEnd = $derived(Math.min(d, ((scrollLeft + viewWidth) / laneWidth) * d + d * (0.15 / (studio.timelineZoom || 1))));

  const sortedSubs = $derived([...studio.subs].sort((a, b) => a.s - b.s));
  const visibleSubs = $derived(
    sortedSubs.filter((o) => o.e >= visStart && o.s <= visEnd)
  );

  // One-click merge pairs between adjacent chronological subtitles visible in viewport
  const visibleMergePairs = $derived.by(() => {
    const pairs = [];
    for (let i = 0; i < sortedSubs.length - 1; i++) {
      const a = sortedSubs[i];
      const b = sortedSubs[i + 1];
      if (b.s < visStart || a.e > visEnd) continue;
      const gap = b.s - a.e;
      if (gap > 6 || gap < -0.5) continue;
      const wA = ((a.e - a.s) / d) * laneWidth;
      const wB = ((b.e - b.s) / d) * laneWidth;
      if (wA < 14 || wB < 14) continue;
      const midT = Math.max(0, Math.min(d, (a.e + b.s) * 0.5));
      pairs.push({
        key: `${a.id}_${b.id}`,
        leftId: a.id,
        rightId: b.id,
        leftPct: (midT / d) * 100,
        gap,
      });
    }
    return pairs;
  });

  // Dynamic precision time ruler (sub-second -> minutes) culled to visible scroll window
  const ticks = $derived.by(() => {
    const candidates = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    let step = candidates[candidates.length - 1];
    for (const c of candidates) {
      if (c * pxPerSec >= 72) {
        step = c;
        break;
      }
    }
    const first = Math.max(0, Math.floor(visStart / step) * step);
    const out = [];
    for (let t = first; t <= visEnd + step * 0.1 && t <= d; t = Math.round((t + step) * 1000) / 1000) {
      out.push({
        t,
        left: (t / d) * 100,
        label: step < 1 ? fmt(t) : fmt(t).slice(0, -2),
      });
    }
    return out;
  });

  $effect(() => {
    if (!scrollEl) return;
    const syncSize = () => {
      if (!scrollEl) return;
      viewWidth = Math.max(200, scrollEl.clientWidth);
      scrollLeft = scrollEl.scrollLeft;
    };
    syncSize();
    const ro = new ResizeObserver(syncSize);
    ro.observe(scrollEl);
    return () => ro.disconnect();
  });

  async function setZoomAnchored(nextZoom, anchorClientX = null) {
    const z = Math.min(maxZoom, Math.max(1, +nextZoom.toFixed(2)));
    if (!scrollEl) {
      studio.timelineZoom = z;
      return;
    }
    const rect = scrollEl.getBoundingClientRect();
    let offsetInView = (phPx - scrollEl.scrollLeft);
    let anchorT = studio.playhead;
    if (anchorClientX !== null) {
      offsetInView = Math.max(0, Math.min(scrollEl.clientWidth, anchorClientX - rect.left));
      anchorT = Math.min(d, Math.max(0, ((scrollEl.scrollLeft + offsetInView) / laneWidth) * d));
    } else if (offsetInView < 0 || offsetInView > scrollEl.clientWidth) {
      offsetInView = scrollEl.clientWidth * 0.5;
    }

    studio.timelineZoom = z;
    await tick();
    const nextW = Math.max(scrollEl.clientWidth, scrollEl.clientWidth * z);
    scrollEl.scrollLeft = Math.max(0, (anchorT / d) * nextW - offsetInView);
    scrollLeft = scrollEl.scrollLeft;
  }

  function sliderToZoom(val) {
    return Math.pow(maxZoom, Math.max(0, Math.min(100, Number(val))) / 100);
  }

  function zoomByFactor(factor, anchorClientX = null) {
    setZoomAnchored((studio.timelineZoom || 1) * factor, anchorClientX);
  }

  function timeAtEvent(e) {
    const r = laneEl.getBoundingClientRect();
    return Math.min(d, Math.max(0, ((e.clientX - r.left) / r.width) * d));
  }

  function maybeSnap(val, ignoreId = null) {
    if (!studio.snapGrid) return val;
    const tol = Math.max(0.03, (10 / Math.max(1, pxPerSec)));
    const points = [0, studio.playhead, studio.trimS, studio.trimE];
    for (const s of sortedSubs) {
      if (s.id !== ignoreId && s.e >= visStart - 5 && s.s <= visEnd + 5) points.push(s.s, s.e);
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

  function startInlineEdit(sub) {
    editingId = sub.id;
    editOrig = sub.t;
    editDraft = sub.t;
  }

  function commitInlineEdit(sub) {
    if (editingId !== sub.id) return;
    editingId = null;
    const next = editDraft.trim();
    if (next && next !== editOrig) {
      sub.t = next;
      if (sub.orig !== undefined) sub.orig = next;
      studio.inv();
      studio.snap();
    }
  }

  function cancelInlineEdit() {
    editingId = null;
  }

  function onWheelTimeline(e) {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      zoomByFactor(factor, e.clientX);
    } else if (scrollEl && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      scrollEl.scrollLeft += e.deltaY;
      scrollLeft = scrollEl.scrollLeft;
    }
  }

  function onPointerDown(e) {
    if (!d) return;
    if (e.target.closest('.merge-btn') || e.target.closest('.inline-sub-edit')) return;

    touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPts.size === 2) {
      const pts = [...touchPts.values()];
      const midX = (pts[0].x + pts[1].x) * 0.5;
      pinchState = {
        dist0: Math.max(10, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)),
        zoom0: studio.timelineZoom,
        midX,
      };
      drag = null;
      return;
    }

    const blk = e.target.closest('.blk');
    if (!blk) {
      drag = { k: 'seek' };
      studio.seek(timeAtEvent(e));
      laneEl.setPointerCapture(e.pointerId);
      return;
    }
    const r = blk.getBoundingClientRect();
    const edgeTol = Math.min(10, Math.max(5, r.width * 0.22));
    const m = e.clientX - r.left < edgeTol ? 'l' : r.right - e.clientX < edgeTol ? 'r' : 'm';
    const tr = blk.dataset.tr;
    if (tr === 'au') {
      drag = { k: 'seek' };
      studio.seek(timeAtEvent(e));
      laneEl.setPointerCapture(e.pointerId);
      return;
    }
    if (tr === 'vd') {
      if (m === 'm') {
        drag = { k: 'seek' };
        studio.seek(timeAtEvent(e));
      } else {
        drag = { k: 'vd', m };
      }
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
    if (touchPts.has(e.pointerId)) {
      touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pinchState && touchPts.size === 2) {
      const pts = [...touchPts.values()];
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      setZoomAnchored(pinchState.zoom0 * (dist / pinchState.dist0), pinchState.midX);
      return;
    }
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

  function onDoubleClick(e) {
    if (e.target.closest('.merge-btn')) return;
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
      startInlineEdit(sub);
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
      <button type="button" class="xs ghost" onclick={() => studio.splitSelectedAtPlayhead()} title="Split selected subtitle at playhead (D)">
        <Icon name="scissors" size={13} />
        <span>Split <kbd class="kbd-hint">D</kbd></span>
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
        <button type="button" class="xs danger" onclick={() => studio.deleteSelectedBlock()} title="Delete selected block (Delete / Backspace)">
          <Icon name="trash" size={12} />
          <span>Delete <kbd class="kbd-hint">Del</kbd></span>
        </button>
      {/if}
    </div>

    <div class="rt" style="gap:6px;margin-left:auto">
      <span class="hint" style="margin:0;font-size:11px">Ctrl+Wheel zoom · Click blue button between subtitles to merge · Double-click to edit</span>
      <span class="v-div"></span>
      <button
        type="button"
        class="xs ghost"
        onclick={() => zoomByFactor(0.7)}
        title="Zoom out timeline"
        aria-label="Zoom out timeline"
      >
        <Icon name="zoom-out" size={13} />
      </button>
      <input
        type="range"
        min="0"
        max="100"
        step="1"
        style="width:124px"
        value={zoomSlider}
        oninput={(e) => setZoomAnchored(sliderToZoom(e.currentTarget.value))}
        aria-label="Timeline zoom"
      />
      <button
        type="button"
        class="xs ghost"
        onclick={() => zoomByFactor(1.45)}
        title="Zoom in timeline"
        aria-label="Zoom in timeline"
      >
        <Icon name="zoom-in" size={13} />
      </button>
      <span class="badge mono">{studio.timelineZoom >= 10 ? Math.round(studio.timelineZoom) : studio.timelineZoom.toFixed(1).replace(/\.0$/, '')}×</span>
      <button
        type="button"
        class="xs ghost"
        onclick={() => {
          studio.timelineZoom = 1;
          if (scrollEl) {
            scrollEl.scrollLeft = 0;
            scrollLeft = 0;
          }
        }}
        title="Fit full timeline to view"
      >
        Fit
      </button>
    </div>
  </div>

  <div class="tl-body">
    <div class="tl-headers">
      <div class="hdr-ruler mono">{fmt(studio.playhead)}</div>
      <div class="hdr-row"><span class="trk-dot" style="background:var(--tl-video)"></span><span>V1 Video</span></div>
      <div class="hdr-row"><span class="trk-dot" style="background:var(--tl-audio)"></span><span>A1 Audio</span></div>
      <div class="hdr-row"><span class="trk-dot" style="background:var(--tl-sub)"></span><span>S1 Subtitles</span></div>
      <div class="hdr-row"><span class="trk-dot" style="background:var(--tl-ov)"></span><span>OV Overlays</span></div>
      <div class="hdr-row"><span class="trk-dot" style="background:var(--tl-txt)"></span><span>T1 Text</span></div>
    </div>

    <div
      class="tl-scroll"
      bind:this={scrollEl}
      onscroll={() => (scrollLeft = scrollEl?.scrollLeft || 0)}
      onwheel={onWheelTimeline}
    >
      <div
        class="lane"
        role="region"
        aria-label="Timeline tracks"
        bind:this={laneEl}
        style="width:{(studio.timelineZoom || 1) * 100}%"
        onpointerdown={onPointerDown}
        onpointermove={onPointerMove}
        onpointerup={(e) => {
          touchPts.delete(e.pointerId);
          if (touchPts.size < 2) pinchState = null;
          if (drag && drag.k !== 'seek') studio.snap();
          drag = null;
        }}
        onpointercancel={(e) => {
          touchPts.delete(e.pointerId);
          pinchState = null;
          drag = null;
        }}
        ondblclick={onDoubleClick}
      >
        <div class="ruler">
          {#each ticks as tk (tk.t)}
            <span class="tick mono" style="left:{tk.left}%">{tk.label}</span>
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

        <div class="trk sub-trk">
          {#each visibleSubs as o (o.id)}
            {@const blkPx = ((o.e - o.s) / d) * laneWidth}
            <div
              class="blk sb"
              class:on={studio.sel === o.id || studio.act === o.id}
              class:tiny={blkPx < 24}
              class:wide={blkPx >= 150}
              data-id={o.id}
              data-tr="sb"
              title={o.t}
              style="left:{(o.s / d) * 100}%;width:{Math.max(((o.e - o.s) / d) * 100, 0.08)}%"
            >
              {#if editingId === o.id}
                <input
                  class="inline-sub-edit"
                  bind:value={editDraft}
                  use:focusOnMount
                  onpointerdown={(ev) => ev.stopPropagation()}
                  onkeydown={(ev) => {
                    if (ev.key === 'Enter') {
                      ev.preventDefault();
                      commitInlineEdit(o);
                    } else if (ev.key === 'Escape') {
                      ev.preventDefault();
                      cancelInlineEdit();
                    }
                  }}
                  onblur={() => commitInlineEdit(o)}
                />
              {:else if blkPx >= 24}
                <span class="sb-txt">{o.t}</span>
              {/if}
            </div>
          {/each}

          {#each visibleMergePairs as mp (mp.key)}
            <button
              type="button"
              class="merge-btn"
              style="left:{mp.leftPct}%"
              title={mp.gap > 0.12 ? `Merge subtitles (preserves ${mp.gap.toFixed(2)}s gap)` : 'Merge subtitles'}
              aria-label="Merge adjacent subtitles"
              onpointerdown={(e) => e.stopPropagation()}
              onclick={(e) => {
                e.stopPropagation();
                studio.mergeSubByIds(mp.leftId, mp.rightId);
              }}
            >
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M2 5l3 3-3 3M14 5l-3 3 3 3M8 3v10" />
              </svg>
            </button>
          {/each}
        </div>

        <div class="trk">
          {#each studio.mediaOverlays as o (o.id)}
            <div
              class="blk ov"
              class:on={studio.selectedOverlayId === o.id}
              data-id={o.id}
              data-tr="ov"
              style="left:{((o.start || 0) / d) * 100}%;width:{Math.max((((o.end || d) - (o.start || 0)) / d) * 100, 0.2)}%"
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
              style="left:{(o.s / d) * 100}%;width:{Math.max(((o.e - o.s) / d) * 100, 0.2)}%"
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
    height: 34px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }
  .kbd-hint {
    font-family: ui-monospace, monospace;
    font-size: 9.5px;
    opacity: 0.72;
    padding: 0 3px;
    border-radius: 3px;
    border: 1px solid var(--border-mid);
    margin-left: 2px;
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
    height: 32px;
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
    white-space: nowrap;
  }
  .trk {
    position: relative;
    height: 32px;
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
    font-size: 11px;
    line-height: 24px;
    cursor: grab;
    color: #ffffff;
    min-width: 3px;
    border: 1px solid rgba(255, 255, 255, 0.2);
  }
  .blk:active {
    cursor: grabbing;
  }
  .blk.vd { background: var(--tl-video); cursor: default; }
  .blk.au { background: var(--tl-audio); cursor: pointer; }
  .blk.sb {
    background: var(--tl-sub);
    display: flex;
    align-items: center;
    padding: 0 8px;
  }
  .blk.sb.tiny {
    padding: 0;
  }
  .blk.sb.wide {
    line-height: 1.15;
    white-space: normal;
  }
  .sb-txt {
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
  }
  .blk.sb.wide .sb-txt {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .inline-sub-edit {
    width: 100%;
    height: 20px;
    padding: 1px 5px;
    font-size: 11px;
    background: var(--bg-input);
    color: var(--text-primary);
    border: 1px solid var(--accent);
    border-radius: 3px;
  }
  .blk.ov { background: var(--tl-ov); }
  .blk.tx { background: var(--tl-txt); }
  .blk.on {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
    filter: brightness(1.14);
    z-index: 3;
  }
  .blk::before,
  .blk::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 6px;
    cursor: ew-resize;
  }
  .blk::before { left: 0; }
  .blk::after { right: 0; }

  /* One-Click Blue Merge Button positioned cleanly between adjacent subtitle boundaries */
  .merge-btn {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 19px;
    height: 19px;
    min-width: 19px;
    min-height: 19px;
    padding: 0;
    border-radius: 99px;
    background: #2563eb;
    color: #ffffff;
    border: 1.5px solid var(--bg-canvas);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
    display: grid;
    place-items: center;
    cursor: pointer;
    z-index: 6;
    transition: transform 110ms ease, background 110ms ease;
  }
  .merge-btn:hover {
    background: #3b82f6;
    transform: translate(-50%, -50%) scale(1.16);
  }
  .merge-btn:active {
    transform: translate(-50%, -50%) scale(0.96);
  }

  .playhead {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 1.5px;
    background: var(--accent);
    pointer-events: none;
    z-index: 7;
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
