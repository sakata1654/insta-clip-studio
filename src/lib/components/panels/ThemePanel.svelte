<script>
  import { generateVideoThemes } from '../../renderer.js';
  import { studio } from '../../state.svelte.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import StyleFieldRow from '../StyleFieldRow.svelte';

  let ovlIn = $state(null);
  const curTheme = $derived(studio.themes[Math.min(studio.theme, studio.themes.length - 1)] || null);
</script>

<input
  bind:this={ovlIn}
  type="file"
  accept="image/png,image/*"
  hidden
  onchange={(e) => {
    const f = e.currentTarget.files?.[0];
    if (!f) return;
    const im = new Image();
    im.onload = () => {
      studio.ovlImg = im;
      const c = document.createElement('canvas');
      c.width = studio.LW;
      c.height = studio.LH;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(im, 0, 0, c.width, c.height);
      const d = cx.getImageData(0, 0, c.width, c.height);
      const p = d.data;
      for (let i = 0; i < p.length; i += 4) {
        const l = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
        p[i] = p[i + 1] = p[i + 2] = 0;
        p[i + 3] = 255 - l;
      }
      cx.putImageData(d, 0, 0);
      studio.ovlC = c;
      studio.inv();
    };
    im.src = URL.createObjectURL(f);
    e.currentTarget.value = '';
  }}
/>

<CategoryBlock title="Video Color Themes" icon="palette" open={true}>
  <button type="button" class="pri sm" style="width:100%;margin-bottom:8px" onclick={generateVideoThemes}>
    ⟳ Pick 5 colors from video
  </button>

  {#each studio.themes as th, i}
    <div
      class="th-row"
      class:sel={i === studio.theme}
      role="button"
      tabindex="0"
      onclick={() => ((studio.theme = i), studio.inv())}
      onkeydown={(e) => e.key === 'Enter' && ((studio.theme = i), studio.inv())}
    >
      <b style="width:18px">{i + 1}</b>
      <i style="flex:1;background:{th.bg}"></i>
      <i style="width:42px;background:{th.accent}"></i>
      <i style="width:42px;background:{th.banner}"></i>
    </div>
  {:else}
    <div class="hint">Open a video to automatically extract 5 matching theme palettes.</div>
  {/each}

  {#if curTheme}
    <StyleFieldRow label="Background" type="color" value={curTheme.bg} onchange={(v) => ((curTheme.bg = v), studio.inv())} />
    <StyleFieldRow label="Accent / sub" type="color" value={curTheme.accent} onchange={(v) => ((curTheme.accent = v), studio.inv())} />
    <StyleFieldRow label="Banner" type="color" value={curTheme.banner} onchange={(v) => ((curTheme.banner = v), studio.inv())} />
  {/if}
  <StyleFieldRow label="Gradient shift" type="check" value={studio.shift} onchange={(v) => ((studio.shift = v ? 1 : 0), studio.inv())} />
</CategoryBlock>

<CategoryBlock title="Bottom Fade & Film Grain" icon="sparkles" open={true}>
  <StyleFieldRow label="Bottom fade" type="check" value={studio.gr.on} onchange={(v) => ((studio.gr.on = v ? 1 : 0), studio.inv())} />
  {#if studio.gr.on}
    <StyleFieldRow label="Fade color" type="select" value={studio.gr.mode} options={[['theme', 'Theme color'], ['black', 'Black']]} onchange={(v) => ((studio.gr.mode = v), studio.inv())} />
    <StyleFieldRow label="Starts at" value={studio.gr.start} min={0} max={100} unit="%" onchange={(v) => ((studio.gr.start = v), studio.inv())} />
    <StyleFieldRow label="Full at" value={studio.gr.end} min={0} max={100} unit="%" onchange={(v) => ((studio.gr.end = v), studio.inv())} />
    <StyleFieldRow label="Strength" value={studio.gr.max} min={0} max={100} unit="%" onchange={(v) => ((studio.gr.max = v), studio.inv())} />
  {/if}
  <StyleFieldRow label="Film grain" value={studio.grain} min={0} max={12} onchange={(v) => ((studio.grain = v), studio.inv())} />
  <div class="bar" style="margin-top:6px;margin-bottom:0">
    <button type="button" class="xs" onclick={() => ovlIn?.click()}>Overlay PNG…</button>
    <button type="button" class="xs" onclick={() => ((studio.ovlImg = null), (studio.ovlC = null), studio.inv())}>Clear</button>
  </div>
</CategoryBlock>

<style>
  .th-row {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 6px 8px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    margin-bottom: 6px;
    cursor: pointer;
  }
  .th-row.sel {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 1px var(--accent-primary-soft);
  }
  .th-row i {
    height: 22px;
    border-radius: 5px;
    display: block;
  }
</style>
