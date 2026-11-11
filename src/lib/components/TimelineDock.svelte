<script>
  import { fmt, studio } from '../state.svelte.js';

  let laneEl = $state(null);
  let scrollEl = $state(null);
  let drag = $state(null);

  const d = $derived(studio.dur || studio.audioDuration || 1);
  const phPx = $derived(laneEl ? (studio.playhead / d) * laneEl.clientWidth : 0);

  const ticks = $derived.by(() => {
    const step = d > 120 ? 30 : d > 40 ? 10 : d > 15 ? 5 : 1;
    const out = [];
    for (let t = 0; t < d; t += step) out.push({ t, left: (t / d) * 100 });
    return out;
  });

  function timeAtEvent(e) {
    const r = laneEl.getBoundingClientRect();
    return Math.min(d, Math.max(0, ((e.clientX - r.left) / r.width) * d));
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
      if (tr === 'ov') studio.selectedOverlayId = o.id;
      else studio.sel = o.id;
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
      if (drag.m === 'l') studio.trimS = Math.min(t, studio.trimE - 0.2);
      else studio.trimE = Math.max(t, studio.trimS + 0.2);
      studio.inv();
    } else if (drag.k === 'blk') {
      const o = drag.o;
      const dx = t - drag.x0;
      const isOv = drag.tr === 'ov';
      let ns = isOv ? o.start : o.s;
      let ne = isOv ? o.end : o.e;
      if (drag.m === 'm') {
        const len = drag.e0 - drag.s0;
        ns = Math.min(Math.max(0, drag.s0 + dx), Math.max(0, d - len));
        ne = ns + len;
      } else if (drag.m === 'l') {
        ns = Math.min(Math.max(0, drag.s0 + dx), ne - 0.1);
      } else {
        ne = Math.max(ns + 0.1, Math.min(d, drag.e0 + dx));
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

  function onDoubleClick(e) {
    const blk = e.target.closest('.blk');
    if (!blk) return;
    const id = +blk.dataset.id;
    if (blk.dataset.tr === 'sb') {
      const sub = studio.subs.find((x) => x.id === id);
      if (!sub) return;
      studio.sel = id;
      studio.seek(sub.s);
      studio.setView('su');
      studio.sideTab = 'subs';
    } else if (blk.dataset.tr === 'tx') {
      const tx = studio.texts.find((x) => x.id === id);
      if (!tx) return;
      studio.sel = id;
      studio.seek(tx.s);
      studio.setView('ed');
      studio.sideTab = 'txt';
    }
  }
</script>

<section class="tl-dock">
  <div class="tl-tools">
    <span class="tl-label">Timeline</span>
    <button type="button" class="xs ghost" onclick={() => (studio.timelineZoom = Math.max(1, studio.timelineZoom - 0.5))}>−</button>
    <input
      type="range"
      min="1"
      max="8"
      step="0.25"
      style="width:110px"
      bind:value={studio.timelineZoom}
    />
    <button type="button" class="xs ghost" onclick={() => (studio.timelineZoom = Math.min(8, studio.timelineZoom + 0.5))}>＋</button>
    <span class="badge mono">{studio.timelineZoom.toFixed(2).replace(/\.?0+$/, '')}×</span>
    <button
      type="button"
      class="xs ghost"
      onclick={() => {
        studio.timelineZoom = 1;
        if (scrollEl) scrollEl.scrollLeft = 0;
      }}
    >
      Fit
    </button>
    <button type="button" class="xs" onclick={splitAtPlayhead} title="Split subtitle at playhead">✂ Split</button>
    <span class="hint" style="margin:0 0 0 auto;font-size:10.5px;color:var(--text-muted)">
      Scrub · Drag blocks · Dbl-click to edit
    </span>
  </div>

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
        <i>VIDEO (trim)</i>
        {#each studio.shots.slice(1) as sh}
          <u class="cut" style="left:{(sh.t / d) * 100}%"></u>
        {/each}
        <div
          class="blk vd"
          data-tr="vd"
          style="left:{(studio.trimS / d) * 100}%;width:{((studio.trimE - studio.trimS) / d) * 100}%"
        >
          {fmt(studio.trimS)} – {fmt(studio.trimE)}
        </div>
      </div>

      <div class="trk">
        <i>AUDIO / MP3</i>
        {#if studio.aud.track}
          <div
            class="blk au"
            data-tr="au"
            style="left:0;width:{Math.min(100, ((studio.audioDuration || d) / d) * 100)}%"
          >
            {studio.aud.trackName || 'Active audio'} · {fmt(studio.audioDuration || d)}
          </div>
        {:else}
          <span class="no-aud">Source video audio</span>
        {/if}
      </div>

      <div class="trk">
        <i>SUBTITLES</i>
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
        <i>OVERLAYS / B-ROLL</i>
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
        <i>TEXT</i>
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
</section>

<style>
  .tl-dock {
    grid-area: t;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border-color);
    padding: 7px 14px 8px;
    overflow: hidden;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .tl-tools {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-shrink: 0;
  }
  .tl-label {
    font-size: 10px;
    font-weight: 750;
    letter-spacing: 0.08em;
    color: var(--text-thirdly);
    text-transform: uppercase;
    margin-right: 2px;
  }
  .tl-scroll {
    overflow-x: auto;
    overflow-y: hidden;
    flex: 1;
    min-height: 0;
  }
  .lane {
    position: relative;
    min-width: 100%;
    user-select: none;
  }
  .ruler {
    position: relative;
    height: 20px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    cursor: pointer;
    overflow: hidden;
  }
  .tick {
    position: absolute;
    font-size: 9.5px;
    color: var(--text-thirdly);
    padding-left: 4px;
    border-left: 1px solid var(--border-mid);
    line-height: 18px;
    font-variant-numeric: tabular-nums;
  }
  .trk {
    position: relative;
    height: 32px;
    margin-top: 3px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .trk:hover { border-color: var(--border-mid); }
  .trk i {
    position: absolute;
    left: 7px;
    top: 2px;
    font-size: 8.5px;
    font-weight: 750;
    letter-spacing: 0.07em;
    color: var(--text-muted);
    font-style: normal;
    pointer-events: none;
    z-index: 2;
    text-transform: uppercase;
  }
  .no-aud {
    position: absolute;
    left: 8px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 10px;
    color: var(--text-muted);
  }
  .cut {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: #fbbf24;
    pointer-events: none;
  }
  .blk {
    position: absolute;
    top: 10px;
    bottom: 2px;
    border-radius: 4px;
    padding: 0 6px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 10.5px;
    line-height: 18px;
    cursor: grab;
    border: 1px solid rgba(255,255,255,0.18);
    min-width: 4px;
    color: rgba(255,255,255,0.92);
    transition: box-shadow 100ms ease;
  }
  .blk:active { cursor: grabbing; }
  .blk.vd { background: var(--tl-video); cursor: default; }
  .blk.au { background: var(--tl-audio); cursor: pointer; }
  .blk.sb { background: var(--tl-sub); }
  .blk.tx { background: var(--tl-txt); }
  .blk.ov { background: var(--tl-ov); }
  .blk.on {
    outline: 2px solid rgba(255,255,255,0.8);
    box-shadow: 0 0 12px rgba(255,255,255,0.25);
  }
  /* trim handles */
  .blk::before, .blk::after {
    content: '';
    position: absolute;
    top: 0; bottom: 0;
    width: 5px;
    cursor: ew-resize;
  }
  .blk::before { left: 0; }
  .blk::after  { right: 0; }
  /* playhead */
  .playhead {
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 2px;
    background: var(--accent-primary);
    box-shadow: 0 0 10px var(--accent-primary), 0 0 4px rgba(99,102,241,0.6);
    pointer-events: none;
    z-index: 5;
    will-change: transform;
  }
  .playhead::before {
    content: '';
    position: absolute;
    top: -2px;
    left: -5px;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-top: 7px solid var(--accent-primary);
  }
</style>
