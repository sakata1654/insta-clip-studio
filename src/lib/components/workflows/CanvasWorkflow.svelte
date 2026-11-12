<script>
  import { studio } from '../../state.svelte.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import Icon from '../Icon.svelte';
  import StyleFieldRow from '../StyleFieldRow.svelte';

  let showAdvFraming = $state(false);

  const ratios = [
    { id: '9:16', label: '9:16 Reels', w: 14, h: 24 },
    { id: '4:5', label: '4:5 Feed', w: 17, h: 21 },
    { id: '1:1', label: '1:1 Square', w: 19, h: 19 },
    { id: '16:9', label: '16:9 Wide', w: 26, h: 15 },
  ];
</script>

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
    <StyleFieldRow label="Blur backdrop" value={studio.fr.bgb} min={0} max={80} unit="px" onchange={(v) => ((studio.fr.bgb = v), studio.inv())} />
    <StyleFieldRow label="Darken backdrop" value={studio.fr.dim} min={0} max={90} unit="%" onchange={(v) => ((studio.fr.dim = v), studio.inv())} />

    <button type="button" class="adv-toggle" aria-expanded={showAdvFraming} onclick={() => (showAdvFraming = !showAdvFraming)}>
      <span>Advanced Framing (Tilt, Border, Shadow)</span>
      <Icon name={showAdvFraming ? 'chev-up' : 'chev-down'} size={13} />
    </button>
    {#if showAdvFraming}
      <div class="adv-box">
        <StyleFieldRow label="Tilt / rotation" value={studio.fr.rot ?? 0} min={-12} max={12} unit="°" onchange={(v) => ((studio.fr.rot = v), studio.inv())} />
        <StyleFieldRow label="Border width" value={studio.fr.bw} min={0} max={30} unit="px" onchange={(v) => ((studio.fr.bw = v), studio.inv())} />
        {#if studio.fr.bw > 0}
          <StyleFieldRow label="Border color" type="color" value={studio.fr.bc} onchange={(v) => ((studio.fr.bc = v), studio.inv())} />
        {/if}
        <StyleFieldRow label="Shadow style" type="select" value={studio.fr.shm} options={[['card', 'Soft Black'], ['glow', 'Theme Glow'], ['plate', 'Theme Plate'], ['none', 'None']]} onchange={(v) => ((studio.fr.shm = v), studio.inv())} />
      </div>
    {/if}
  {/if}
</CategoryBlock>

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
</style>
