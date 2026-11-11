<script>
  import { autoCenter, initFD } from '../../renderer.js';
  import { fmt, studio } from '../../state.svelte.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import StyleFieldRow from '../StyleFieldRow.svelte';

  let scanStatus = $state('');
  let scanning = $state(false);

  async function detectCuts() {
    if (!studio.file || !studio.V?.src) return studio.toast('Open a video first');
    scanning = true;
    try {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.src = studio.V.src;
      await new Promise((r) => (v.onloadeddata = r));
      const cv = document.createElement('canvas');
      cv.width = 64;
      cv.height = 36;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      let prev = null;
      let last = -9;
      const cuts = [0];
      v.currentTime = studio.trimS;
      await new Promise((r) => (v.onseeked = r));
      v.playbackRate = 4;
      await v.play();
      await new Promise((res) => {
        v.addEventListener('ended', res, { once: true });
        const step = (_, m) => {
          const t = m.mediaTime;
          if (v.ended || t >= studio.trimE) return res();
          cx.drawImage(v, 0, 0, 64, 36);
          const d = cx.getImageData(0, 0, 64, 36).data;
          const g = new Uint8Array(2304);
          let s = 0;
          for (let i = 0, j = 0; i < d.length; i += 4, j++) {
            g[j] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
            if (prev) s += Math.abs(g[j] - prev[j]);
          }
          if (prev && s / 2304 > 25 && t - last > 0.6) {
            cuts.push(t);
            last = t;
          }
          prev = g;
          scanStatus = `Scanning… ${Math.round(((t - studio.trimS) / Math.max(1, studio.trimE - studio.trimS)) * 100)}%`;
          v.requestVideoFrameCallback(step);
        };
        v.requestVideoFrameCallback(step);
      });
      v.pause();
      const base = studio.shots[0] || { px: 0, py: 0, zoom: 100 };
      studio.shots = cuts.map((t, i) => ({ t, px: base.px, py: base.py, zoom: base.zoom, set: i === 0 && !!base.set }));
      studio.shotIdx = -1;
      scanStatus = `${cuts.length} shot(s) detected`;
      studio.inv();
    } catch (e) {
      scanStatus = 'Scan failed: ' + e;
    } finally {
      scanning = false;
    }
  }
</script>

<CategoryBlock title="Camera & Face Tracking" icon="scissors" open={true}>
  <StyleFieldRow
    label="Camera mode"
    type="select"
    value={studio.cam}
    options={[
      ['auto', 'Auto-center each shot'],
      ['track', 'Active face tracking'],
      ['manual', 'Manual per-shot'],
    ]}
    onchange={(v) => ((studio.cam = v), studio.inv())}
  />
  <div class="bar" style="margin-top:8px">
    <button type="button" class="xs" disabled={scanning} onclick={detectCuts}>Detect cuts</button>
    <button
      type="button"
      class="xs"
      onclick={() => {
        studio.shots.push({ t: studio.currentPlayhead(), px: studio.fx.px, py: studio.fx.py, zoom: studio.fx.zoom, set: true });
        studio.shots.sort((a, b) => a.t - b.t);
        studio.shotIdx = -1;
        studio.inv();
      }}
    >
      + Cut here
    </button>
    <button
      type="button"
      class="xs"
      onclick={async () => {
        await initFD();
        autoCenter(true);
      }}
    >
      Center on face
    </button>
  </div>
  {#if scanStatus}
    <div class="hint">{scanStatus}</div>
  {/if}
  {#each studio.shots as s, i}
    <div class="sub-card" style="display:flex;align-items:center;gap:8px;padding:6px 8px">
      <b style="width:18px">{i + 1}</b>
      <span class="mono" style="flex:1;font-size:11.5px">{fmt(s.t)} · {Math.round(s.zoom)}%</span>
      <button type="button" class="xs" onclick={() => studio.seek(s.t)}>⏵</button>
      {#if studio.shots.length > 1 && i > 0}
        <button type="button" class="xs" onclick={() => ((studio.shots.splice(i, 1), (studio.shotIdx = -1), studio.inv()))}>✕</button>
      {/if}
    </div>
  {/each}
</CategoryBlock>
