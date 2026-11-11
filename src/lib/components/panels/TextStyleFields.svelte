<script>
  import { FSEL } from '../../constants.js';
  import { studio } from '../../state.svelte.js';
  import StyleFieldRow from '../StyleFieldRow.svelte';

  let { item = $bindable() } = $props();
</script>

<textarea
  rows="2"
  style="width:100%;margin-bottom:8px"
  placeholder="Enter overlay text…"
  bind:value={item.t}
  oninput={() => studio.inv()}
></textarea>

<div class="sg" style="margin-bottom:6px">
  <label>Start (s)<input type="number" step="0.1" min="0" bind:value={item.s} oninput={() => studio.inv()} /></label>
  <label>End (s)<input type="number" step="0.1" min="0.1" bind:value={item.e} oninput={() => studio.inv()} /></label>
</div>

<div class="style-control-group-heading">Typography &amp; Colors</div>
<StyleFieldRow label="Font" type="select" value={item.font || ''} options={FSEL} onchange={(v) => ((item.font = v), studio.inv())} />
<StyleFieldRow label="Size" value={item.size ?? 76} min={14} max={320} unit="px" onchange={(v) => ((item.size = v), studio.inv())} />
<StyleFieldRow label="Text color" type="color" value={item.color || '#ffffff'} onchange={(v) => ((item.color = v), studio.inv())} />
<StyleFieldRow label="Outline color" type="color" value={item.stroke || '#000000'} onchange={(v) => ((item.stroke = v), studio.inv())} />
<StyleFieldRow label="Outline width" value={item.sw ?? 6} min={0} max={30} unit="px" onchange={(v) => ((item.sw = v), studio.inv())} />
<StyleFieldRow
  label="Align"
  type="select"
  value={item.align || 'center'}
  options={[
    ['center', 'Center'],
    ['left', 'Left'],
    ['right', 'Right'],
  ]}
  onchange={(v) => ((item.align = v), studio.inv())}
/>
<StyleFieldRow label="Bold" type="check" value={item.bold !== false} onchange={(v) => ((item.bold = v), studio.inv())} />
<StyleFieldRow label="UPPERCASE" type="check" value={!!item.upper} onchange={(v) => ((item.upper = v), studio.inv())} />

<div class="style-control-group-heading">Backdrop Box &amp; Shadow</div>
<StyleFieldRow label="Box opacity" value={item.bga ?? 0} min={0} max={100} unit="%" onchange={(v) => ((item.bga = v), studio.inv())} />
{#if (item.bga ?? 0) > 0}
  <StyleFieldRow label="Box color" type="color" value={item.bg || '#000000'} onchange={(v) => ((item.bg = v), studio.inv())} />
  <StyleFieldRow label="Box radius" value={item.boxR ?? 14} min={0} max={60} unit="px" onchange={(v) => ((item.boxR = v), studio.inv())} />
  <StyleFieldRow label="Pad X" value={item.padX ?? 24} min={0} max={80} unit="px" onchange={(v) => ((item.padX = v), studio.inv())} />
  <StyleFieldRow label="Pad Y" value={item.padY ?? 14} min={0} max={60} unit="px" onchange={(v) => ((item.padY = v), studio.inv())} />
{/if}
<StyleFieldRow label="Drop shadow" type="check" value={item.shadow !== false} onchange={(v) => ((item.shadow = v), studio.inv())} />
{#if item.shadow !== false}
  <StyleFieldRow label="Shadow color" type="color" value={item.shc || '#000000'} onchange={(v) => ((item.shc = v), studio.inv())} />
  <StyleFieldRow label="Shadow blur" value={item.shb ?? 10} min={0} max={40} unit="px" onchange={(v) => ((item.shb = v), studio.inv())} />
{/if}

<div class="style-control-group-heading">Position &amp; Width</div>
<StyleFieldRow label="Position X" value={item.x ?? 50} min={5} max={95} unit="%" onchange={(v) => ((item.x = v), studio.inv())} />
<StyleFieldRow label="Position Y" value={item.y ?? 30} min={5} max={95} unit="%" onchange={(v) => ((item.y = v), studio.inv())} />
<StyleFieldRow label="Max width" value={item.w ?? 88} min={20} max={96} unit="%" onchange={(v) => ((item.w = v), studio.inv())} />
<StyleFieldRow
  label="Animation"
  type="select"
  value={item.anim || 'fade'}
  options={[
    ['fade', 'Fade'],
    ['slide', 'Slide up'],
    ['pop', 'Pop scale'],
    ['none', 'None'],
  ]}
  onchange={(v) => ((item.anim = v), studio.inv())}
/>
