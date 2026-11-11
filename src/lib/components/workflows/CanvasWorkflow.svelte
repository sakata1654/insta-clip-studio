<script>
  import { generateVideoThemes } from '../../renderer.js';
  import { studio } from '../../state.svelte.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import CameraPanel from '../panels/CameraPanel.svelte';
  import EffectsPanel from '../panels/EffectsPanel.svelte';
  import NewsBannerPanel from '../panels/NewsBannerPanel.svelte';
  import OverlaysPanel from '../panels/OverlaysPanel.svelte';
  import TextsPanel from '../panels/TextsPanel.svelte';
  import StyleFieldRow from '../StyleFieldRow.svelte';

  let subTab = $state('layout'); // 'layout' | 'overlays' | 'camera'

  const ratios = [
    { id: '9:16', label: '9:16 Reels', w: 14, h: 24 },
    { id: '4:5', label: '4:5 Feed', w: 17, h: 21 },
    { id: '1:1', label: '1:1 Square', w: 19, h: 19 },
    { id: '16:9', label: '16:9 Wide', w: 26, h: 15 },
  ];
</script>

<div class="seg-pills tri">
  <button type="button" class:on={subTab === 'layout'} onclick={() => (subTab = 'layout')}>Format & Look</button>
  <button type="button" class:on={subTab === 'overlays'} onclick={() => (subTab = 'overlays')}>Overlays</button>
  <button type="button" class:on={subTab === 'camera'} onclick={() => (subTab = 'camera')}>Cam & FX</button>
</div>

{#if subTab === 'layout'}
  <CategoryBlock title="Aspect Ratio" icon="layout" open={true}>
    <div class="ratio-grid">
      {#each ratios as r}
        <button
          type="button"
          class="ratio-card"
          class:on={studio.aspect === r.id}
          onclick={() => {
            studio.aspect = r.id;
            studio.inv();
          }}
        >
          <span class="ratio-box" style="width:{r.w}px;height:{r.h}px"></span>
          <span>{r.label}</span>
        </button>
      {/each}
    </div>
  </CategoryBlock>

  <CategoryBlock title="Card Framing & Backdrop" icon="film" open={true}>
    <div class="seg-pills">
      <button type="button" class:on={studio.mode === 'studio'} onclick={() => studio.setMode('studio')}>Studio Card</button>
      <button type="button" class:on={studio.mode === 'simple'} onclick={() => studio.setMode('simple')}>Full-Bleed Crop</button>
    </div>
    {#if studio.mode === 'studio'}
      <StyleFieldRow label="Card width" value={studio.fr.w} min={30} max={100} unit="%" onchange={(v) => ((studio.fr.w = v), studio.inv())} />
      <StyleFieldRow label="Card ratio" type="select" value={studio.fr.ar} options={[['47:51', 'Classic'], ['orig', 'Original'], ['1:1', '1:1'], ['4:5', '4:5'], ['16:9', '16:9'], ['9:16', '9:16']]} onchange={(v) => ((studio.fr.ar = v), studio.inv())} />
      <StyleFieldRow label="Corner radius" value={studio.fr.r} min={0} max={600} unit="px" onchange={(v) => ((studio.fr.r = v), studio.inv())} />
      <StyleFieldRow label="Tilt / rotation" value={studio.fr.rot ?? 0} min={-12} max={12} unit="°" onchange={(v) => ((studio.fr.rot = v), studio.inv())} />
      <StyleFieldRow label="Border width" value={studio.fr.bw} min={0} max={30} unit="px" onchange={(v) => ((studio.fr.bw = v), studio.inv())} />
      {#if studio.fr.bw > 0}
        <StyleFieldRow label="Border color" type="color" value={studio.fr.bc} onchange={(v) => ((studio.fr.bc = v), studio.inv())} />
      {/if}
      <StyleFieldRow label="Blur amount" value={studio.fr.bgb} min={0} max={80} unit="px" onchange={(v) => ((studio.fr.bgb = v), studio.inv())} />
      <StyleFieldRow label="Darken backdrop" value={studio.fr.dim} min={0} max={90} unit="%" onchange={(v) => ((studio.fr.dim = v), studio.inv())} />
      <StyleFieldRow label="Shadow style" type="select" value={studio.fr.shm} options={[['card', 'Soft Black'], ['glow', 'Theme Glow'], ['plate', 'Theme Plate'], ['none', 'None']]} onchange={(v) => ((studio.fr.shm = v), studio.inv())} />
    {/if}
  </CategoryBlock>

  <CategoryBlock title="Video Color Theme" icon="palette" open={true}>
    <button type="button" class="sm pri" style="width:100%;margin-bottom:8px" onclick={generateVideoThemes}>
      ⟳ Auto-Pick Colors from Video
    </button>
    {#if studio.themes.length}
      <div class="bar" style="margin-bottom:4px">
        {#each studio.themes as th, i}
          <button
            type="button"
            class="theme-chip"
            class:on={i === studio.theme}
            style="background:linear-gradient(135deg,{th.bg} 60%,{th.accent} 40%)"
            onclick={() => ((studio.theme = i), studio.inv())}
            aria-label={'Theme ' + (i + 1)}
          ></button>
        {/each}
      </div>
    {/if}
    <StyleFieldRow label="Bottom fade" type="check" value={studio.gr.on} onchange={(v) => ((studio.gr.on = v ? 1 : 0), studio.inv())} />
    {#if studio.gr.on}
      <StyleFieldRow label="Fade mode" type="select" value={studio.gr.mode} options={[['theme', 'Theme color'], ['black', 'Pure black'], ['custom', 'Custom color']]} onchange={(v) => ((studio.gr.mode = v), studio.inv())} />
      {#if studio.gr.mode === 'custom'}
        <StyleFieldRow label="Fade color" type="color" value={studio.gr.color} onchange={(v) => ((studio.gr.color = v), studio.inv())} />
      {/if}
      <StyleFieldRow label="Fade start" value={studio.gr.start} min={0} max={100} unit="%" onchange={(v) => ((studio.gr.start = v), studio.inv())} />
      <StyleFieldRow label="Fade end" value={studio.gr.end} min={0} max={100} unit="%" onchange={(v) => ((studio.gr.end = v), studio.inv())} />
      <StyleFieldRow label="Fade intensity" value={studio.gr.max} min={0} max={100} unit="%" onchange={(v) => ((studio.gr.max = v), studio.inv())} />
      <div class="style-control-group-heading">Bottom Edge Glow</div>
      <StyleFieldRow label="Glow height" value={studio.gr.glowH ?? 0} min={0} max={45} unit="%" onchange={(v) => ((studio.gr.glowH = v), studio.inv())} />
      {#if (studio.gr.glowH ?? 0) > 0}
        <StyleFieldRow label="Glow width" value={studio.gr.glowW ?? 100} min={15} max={100} unit="%" onchange={(v) => ((studio.gr.glowW = v), studio.inv())} />
        <StyleFieldRow label="Glow intensity" value={studio.gr.glowOpacity ?? 65} min={0} max={100} unit="%" onchange={(v) => ((studio.gr.glowOpacity = v), studio.inv())} />
        <StyleFieldRow label="Glow color" type="color" value={studio.gr.glowColor || studio.gr.color || '#6366f1'} onchange={(v) => ((studio.gr.glowColor = v), studio.inv())} />
      {/if}
    {/if}
  </CategoryBlock>
{:else if subTab === 'overlays'}
  <NewsBannerPanel />
  <OverlaysPanel />
  <TextsPanel />
{:else}
  <CameraPanel />
  <EffectsPanel />
{/if}

<style>
  .ratio-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .ratio-card {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px;
    border-radius: 9px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    font-size: 11.5px;
    justify-content: flex-start;
  }
  .ratio-card.on {
    border-color: var(--accent-primary);
    background: var(--accent-primary-soft);
    color: #fff;
  }
  .ratio-box {
    border: 1.5px solid currentColor;
    border-radius: 3px;
    display: inline-block;
  }
  .theme-chip {
    width: 34px;
    height: 26px;
    padding: 0;
    border-radius: 7px;
    border: 2px solid transparent;
  }
  .theme-chip.on {
    border-color: #fff;
    transform: scale(1.08);
  }
</style>
