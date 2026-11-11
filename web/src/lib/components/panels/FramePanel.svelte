<script>
  import { FX0 } from '../../constants.js';
  import { BUILT_IN_PRESETS, loadCustomPresets, migrateLegacyDual } from '../../presets.js';
  import { studio } from '../../state.svelte.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import StyleFieldRow from '../StyleFieldRow.svelte';

  let fgFileInput = $state(null);

  const quickPresets = $derived(
    [...loadCustomPresets(), ...BUILT_IN_PRESETS]
      .filter((p) => p.scope === 'all' && (p.format === studio.aspect || p.format === 'any'))
      .slice(0, 6)
  );

  function applyQuickPreset(p) {
    if (p.aspect) studio.aspect = p.aspect;
    if (p.mode) studio.mode = p.mode;
    if (p.st) studio.st = { ...studio.st, ...p.st };
    if (p.fr) studio.fr = { ...studio.fr, ...p.fr };
    if (p.du) studio.du = migrateLegacyDual(p.du);
    studio.inv();
    studio.snap();
    studio.toast('Applied preset: ' + p.name);
  }

  function applyShape(shape) {
    if (shape === 'classic') Object.assign(studio.fr, { w: 87.04, ar: '47:51', r: 40, y: 31.77, on: 1 });
    else if (shape === 'circle') Object.assign(studio.fr, { w: 70.37, ar: '1:1', r: 400, y: 30.21, on: 1 });
    else studio.fr.on = 1;
    studio.inv();
    studio.snap();
  }
</script>

<input
  bind:this={fgFileInput}
  type="file"
  accept="image/*"
  hidden
  onchange={(e) => {
    const f = e.currentTarget.files?.[0];
    if (!f) return;
    const im = new Image();
    im.onload = () => {
      studio.fgImg = im;
      studio.fg.mode = 'image';
      studio.inv();
      studio.snap();
    };
    im.src = URL.createObjectURL(f);
    e.currentTarget.value = '';
  }}
/>

<CategoryBlock title="Quick Format & Look Presets" icon="sparkles" open={true}>
  <div class="rt" style="justify-content:space-between;margin-bottom:6px">
    <span class="hint" style="margin:0">Format: <b>{studio.aspect}</b></span>
    <button
      type="button"
      class="xs"
      onclick={() => {
        studio.setView('su');
        studio.sideTab = 'sty';
        studio.styleSubTab = 'presets';
      }}
    >
      Manage Presets
    </button>
  </div>
  <div class="bar" style="margin-bottom:4px">
    {#each quickPresets as p (p.id)}
      <button type="button" class="xs" onclick={() => applyQuickPreset(p)}>
        {p.name}
      </button>
    {/each}
  </div>
</CategoryBlock>

<CategoryBlock title="Output Mode & Card Frame" icon="film" open={true}>
  <StyleFieldRow
    label="Output mode"
    type="select"
    value={studio.mode}
    options={[
      ['studio', 'Studio card'],
      ['simple', 'Simple crop (full-bleed)'],
    ]}
    onchange={(v) => studio.setMode(v)}
  />
  <div class="prop-row">
    <label for="fr-shape-sel">Shape preset</label>
    <select id="fr-shape-sel" onchange={(e) => applyShape(e.currentTarget.value)}>
      <option value="classic">Classic square</option>
      <option value="circle">Circle frame</option>
      <option value="free">Free custom</option>
    </select>
    <span></span>
  </div>
  <StyleFieldRow label="Rounded card" type="check" value={studio.fr.on} onchange={(v) => ((studio.fr.on = v ? 1 : 0), studio.inv())} />
  {#if studio.fr.on}
    <StyleFieldRow label="Card width" value={studio.fr.w} min={30} max={100} unit="%" onchange={(v) => ((studio.fr.w = v), studio.inv())} />
    <StyleFieldRow
      label="Card ratio"
      type="select"
      value={studio.fr.ar}
      options={[
        ['47:51', 'Classic'],
        ['orig', 'Original'],
        ['1:1', '1:1'],
        ['4:5', '4:5'],
        ['16:9', '16:9'],
        ['9:16', '9:16'],
      ]}
      onchange={(v) => ((studio.fr.ar = v), studio.inv())}
    />
    <StyleFieldRow label="Corner radius" value={studio.fr.r} min={0} max={600} unit="px" onchange={(v) => ((studio.fr.r = v), studio.inv())} />
    <StyleFieldRow label="Position X" value={studio.fr.x} min={0} max={100} unit="%" onchange={(v) => ((studio.fr.x = v), studio.inv())} />
    <StyleFieldRow label="Position Y" value={studio.fr.y} min={0} max={100} unit="%" onchange={(v) => ((studio.fr.y = v), studio.inv())} />
    <StyleFieldRow label="Border width" value={studio.fr.bw} min={0} max={30} unit="px" onchange={(v) => ((studio.fr.bw = v), studio.inv())} />
    <StyleFieldRow label="Border color" type="color" value={studio.fr.bc} onchange={(v) => ((studio.fr.bc = v), studio.inv())} />
  {/if}
</CategoryBlock>

<CategoryBlock title="Foreground Picture & Pan" icon="scissors" open={false}>
  <StyleFieldRow
    label="Source"
    type="select"
    value={studio.fg.mode}
    options={[
      ['video', 'Video frame'],
      ['image', 'Static image'],
    ]}
    onchange={(v) => ((studio.fg.mode = v), studio.inv())}
  />
  <div class="prop-row">
    <label for="fg-img-btn">Image source</label>
    <button id="fg-img-btn" type="button" class="sm" onclick={() => fgFileInput?.click()}>Choose image…</button>
    <span></span>
  </div>
  <StyleFieldRow label="Ken Burns" type="check" value={studio.fg.kb} onchange={(v) => ((studio.fg.kb = v ? 1 : 0), studio.inv())} />
  <StyleFieldRow label="KB zoom" value={studio.fg.kbz} min={0} max={30} unit="%" onchange={(v) => ((studio.fg.kbz = v), studio.inv())} />
  <div class="style-control-group-heading">Inside Card Zoom & Pan</div>
  <StyleFieldRow label="Zoom" value={studio.fx.zoom} min={100} max={300} unit="%" onchange={(v) => ((studio.fx.zoom = v), studio.saveShot(), studio.inv())} />
  <StyleFieldRow label="Pan X" value={studio.fx.px} min={-100} max={100} onchange={(v) => ((studio.fx.px = v), studio.saveShot(), studio.inv())} />
  <StyleFieldRow label="Pan Y" value={studio.fx.py} min={-100} max={100} onchange={(v) => ((studio.fx.py = v), studio.saveShot(), studio.inv())} />
  <button type="button" class="xs" onclick={() => (Object.assign(studio.fx, FX0), studio.inv())}>Reset pan & zoom</button>
</CategoryBlock>

<CategoryBlock title="Background & Card Shadow" icon="palette" open={false}>
  <StyleFieldRow
    label="Background"
    type="select"
    value={studio.fr.bgm}
    options={[
      ['blur', 'Blurred video'],
      ['solid', 'Solid color'],
    ]}
    onchange={(v) => ((studio.fr.bgm = v), studio.inv())}
  />
  <StyleFieldRow label="Blur amount" value={studio.fr.bgb} min={0} max={80} unit="px" onchange={(v) => ((studio.fr.bgb = v), studio.inv())} />
  <StyleFieldRow label="Darken" value={studio.fr.dim} min={0} max={90} unit="%" onchange={(v) => ((studio.fr.dim = v), studio.inv())} />
  <StyleFieldRow label="Solid color" type="color" value={studio.fr.bgc} onchange={(v) => ((studio.fr.bgc = v), studio.inv())} />
  <StyleFieldRow label="Light leak" type="check" value={studio.fr.leak} onchange={(v) => ((studio.fr.leak = v ? 1 : 0), studio.inv())} />
  <div class="style-control-group-heading">Drop Shadow</div>
  <StyleFieldRow label="Shadow" type="check" value={studio.fr.sh} onchange={(v) => ((studio.fr.sh = v ? 1 : 0), studio.inv())} />
  <StyleFieldRow
    label="Shadow style"
    type="select"
    value={studio.fr.shm}
    options={[
      ['card', 'Soft black'],
      ['glow', 'Theme glow'],
      ['plate', 'Theme plate'],
    ]}
    onchange={(v) => ((studio.fr.shm = v), studio.inv())}
  />
  <StyleFieldRow label="Strength" value={studio.fr.sha} min={0} max={100} unit="%" onchange={(v) => ((studio.fr.sha = v), studio.inv())} />
  <StyleFieldRow label="Blur" value={studio.fr.shb} min={0} max={200} onchange={(v) => ((studio.fr.shb = v), studio.inv())} />
  <StyleFieldRow label="Offset Y" value={studio.fr.shy} min={-100} max={200} onchange={(v) => ((studio.fr.shy = v), studio.inv())} />
</CategoryBlock>
