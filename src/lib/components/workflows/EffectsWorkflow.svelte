<script>
  import { generateVideoThemes } from '../../renderer.js';
  import { studio } from '../../state.svelte.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import StyleFieldRow from '../StyleFieldRow.svelte';
  import EffectsPanel from '../panels/EffectsPanel.svelte';
</script>

<EffectsPanel />

<CategoryBlock title="Film Grain & Backdrop Theme" icon="palette" open={true}>
  <StyleFieldRow label="Film grain" value={studio.grain ?? 0} min={0} max={18} onchange={(v) => ((studio.grain = v), studio.inv())} />
  <button type="button" class="sm" style="width:100%;margin:8px 0" onclick={generateVideoThemes}>
    Auto-Sample Colors from Video
  </button>
  {#if studio.themes.length}
    <div class="bar" style="margin-bottom:6px">
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
</CategoryBlock>

<CategoryBlock
  title="Bottom Fade & Edge Glow"
  icon="sparkles"
  open={true}
  toggleChecked={!!studio.gr.on}
  onToggle={(v) => ((studio.gr.on = v ? 1 : 0), studio.inv())}
>
  {#if studio.gr.on}
    <StyleFieldRow
      label="Fade mode"
      type="select"
      value={studio.gr.mode}
      options={[
        ['theme', 'Theme color'],
        ['black', 'Pure black'],
        ['custom', 'Custom color'],
      ]}
      onchange={(v) => ((studio.gr.mode = v), studio.inv())}
    />
    {#if studio.gr.mode === 'custom'}
      <StyleFieldRow label="Fade color" type="color" value={studio.gr.color} onchange={(v) => ((studio.gr.color = v), studio.inv())} />
    {/if}
    <StyleFieldRow label="Fade start" value={studio.gr.start} min={0} max={100} unit="%" onchange={(v) => ((studio.gr.start = v), studio.inv())} />
    <StyleFieldRow label="Fade end" value={studio.gr.end} min={0} max={100} unit="%" onchange={(v) => ((studio.gr.end = v), studio.inv())} />
    <StyleFieldRow label="Fade intensity" value={studio.gr.max} min={0} max={100} unit="%" onchange={(v) => ((studio.gr.max = v), studio.inv())} />

    <div class="style-control-group-heading">Edge Glow</div>
    <StyleFieldRow label="Glow height" value={studio.gr.glowH ?? 0} min={0} max={45} unit="%" onchange={(v) => ((studio.gr.glowH = v), studio.inv())} />
    {#if (studio.gr.glowH ?? 0) > 0}
      <StyleFieldRow label="Glow width" value={studio.gr.glowW ?? 100} min={15} max={100} unit="%" onchange={(v) => ((studio.gr.glowW = v), studio.inv())} />
      <StyleFieldRow label="Glow intensity" value={studio.gr.glowOpacity ?? 65} min={0} max={100} unit="%" onchange={(v) => ((studio.gr.glowOpacity = v), studio.inv())} />
      <StyleFieldRow label="Glow color" type="color" value={studio.gr.glowColor || studio.gr.color || '#4f8cff'} onchange={(v) => ((studio.gr.glowColor = v), studio.inv())} />
    {/if}
  {:else}
    <div class="hint" style="margin:0">Enable Bottom Fade to blend lower-third shadows and subtitles cleanly.</div>
  {/if}
</CategoryBlock>

<style>
  .theme-chip {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    padding: 0;
    border: 2px solid var(--border-mid);
  }
  .theme-chip.on {
    border-color: var(--accent);
    transform: scale(1.1);
  }
</style>
