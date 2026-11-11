<script>
  import { FX0 } from '../../constants.js';
  import { studio } from '../../state.svelte.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import StyleFieldRow from '../StyleFieldRow.svelte';
</script>

<CategoryBlock title="Color Grade & Volume" icon="sparkles" open={true}>
  <StyleFieldRow label="Brightness" value={studio.fx.b} min={0} max={200} unit="%" onchange={(v) => ((studio.fx.b = v), studio.inv())} />
  <StyleFieldRow label="Contrast" value={studio.fx.c} min={0} max={200} unit="%" onchange={(v) => ((studio.fx.c = v), studio.inv())} />
  <StyleFieldRow label="Saturation" value={studio.fx.s} min={0} max={300} unit="%" onchange={(v) => ((studio.fx.s = v), studio.inv())} />
  <StyleFieldRow label="Blur" value={studio.fx.blur} min={0} max={20} unit="px" onchange={(v) => ((studio.fx.blur = v), studio.inv())} />
  <StyleFieldRow label="Vignette" value={studio.fx.vignette ?? 0} min={0} max={100} unit="%" onchange={(v) => ((studio.fx.vignette = v), studio.inv())} />
  <StyleFieldRow
    label="Video volume"
    value={studio.vol}
    min={0}
    max={100}
    unit="%"
    onchange={(v) => {
      studio.vol = v;
      if (studio.V) studio.V.volume = v / 100;
    }}
  />
  <button type="button" class="sm" onclick={() => (Object.assign(studio.fx, FX0), studio.inv(), studio.snap())}>Reset effects</button>
</CategoryBlock>
