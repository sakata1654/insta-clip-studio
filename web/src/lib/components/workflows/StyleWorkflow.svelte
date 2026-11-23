<script>
  import { FONTS, FR0, GR0, ST0, SUBCFG0 } from '../../constants.js';
  import { BUILT_IN_PRESETS, loadCustomPresets, migrateLegacyDual, saveCustomPresets } from '../../presets.js';
  import { saveBlob } from '../../renderer.js';
  import { studio } from '../../state.svelte.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import StyleFieldRow from '../StyleFieldRow.svelte';

  let tab = $state('arabic'); // 'arabic' | 'trans' | 'card' | 'motion' | 'presets'
  let presetName = $state('');
  let presetFmt = $state('current');
  let customPresets = $state(loadCustomPresets());

  const fontOpts = FONTS.map(([n, v]) => [v, n]);
  const dualSrcFontOpts = [
    ['', 'Default Arabic (Amiri)'],
    ['Amiri', 'Amiri'],
    ['Noto Naskh Arabic', 'Noto Naskh Arabic'],
    ['Cairo', 'Cairo'],
    ['Georgia', 'Georgia'],
    ['system-ui', 'System'],
  ];
  const dualTrFontOpts = [
    ['system-ui', 'System'],
    ['Inter, Segoe UI, sans-serif', 'Inter / Segoe UI'],
    ['Georgia', 'Georgia'],
    ['serif', 'Serif'],
  ];

  function applyPreset(p) {
    if (!p) return;
    if (p.aspect) studio.aspect = p.aspect;
    if (p.mode) studio.mode = p.mode;
    if (p.st) studio.st = { ...ST0, ...p.st };
    if (p.fr) studio.fr = { ...FR0, ...p.fr };
    if (p.gr) studio.gr = { ...GR0, ...p.gr };
    if (p.du) studio.du = migrateLegacyDual(p.du);
    if (p.subCfg) studio.subCfg = { ...SUBCFG0, ...p.subCfg };
    studio.inv();
    studio.snap();
    studio.toast('Applied preset: ' + p.name);
  }

  function savePreset() {
    const name = presetName.trim();
    if (!name) return studio.toast('Name your preset first');
    const fmt = presetFmt === 'current' ? studio.aspect : presetFmt;
    const obj = {
      id: 'cp_' + Date.now(),
      name,
      format: fmt,
      aspect: fmt === 'any' ? studio.aspect : fmt,
      scope: 'all',
      mode: studio.mode,
      st: JSON.parse(JSON.stringify(studio.st)),
      fr: JSON.parse(JSON.stringify(studio.fr)),
      du: JSON.parse(JSON.stringify(studio.du)),
      subCfg: JSON.parse(JSON.stringify(studio.subCfg)),
    };
    customPresets = [obj, ...customPresets];
    saveCustomPresets(customPresets);
    presetName = '';
    studio.toast(`Saved ${fmt} preset: ${name}`);
  }
</script>

<div class="rt" style="justify-content:space-between;margin-bottom:8px">
  <span class="hint" style="margin:0">Live Preview Subtitle</span>
  <label class="chk-lbl">
    <input
      type="checkbox"
      checked={!!studio.sampleSub}
      onchange={(e) => {
        studio.sampleSub = e.currentTarget.checked ? 1 : 0;
        studio.inv();
      }}
    />
    <span>Sample Mode</span>
  </label>
</div>

<!-- 5-Target Production Styling Navigation (QuranCaption & Minbar Inspired) -->
<div class="seg-pills" style="margin-bottom:10px">
  <button type="button" class:on={tab === 'arabic'} onclick={() => (tab = 'arabic')}>Arabic / Text</button>
  <button type="button" class:on={tab === 'trans'} onclick={() => (tab = 'trans')}>Translation</button>
  <button type="button" class:on={tab === 'card'} onclick={() => (tab = 'card')}>Container</button>
  <button type="button" class:on={tab === 'motion'} onclick={() => (tab = 'motion')}>Effects</button>
  <button type="button" class:on={tab === 'presets'} onclick={() => (tab = 'presets')}>Presets</button>
</div>

{#if tab === 'arabic'}
  <CategoryBlock title="Arabic / Primary Line Typography" icon="type" open={true}>
    {#if studio.du.on}
      <StyleFieldRow label="Show Primary Line" type="check" value={studio.du.showSource} onchange={(v) => ((studio.du.showSource = v), studio.inv())} />
      <StyleFieldRow label="Font" type="select" value={studio.du.sourceFont} options={dualSrcFontOpts} onchange={(v) => ((studio.du.sourceFont = v), studio.inv())} />
      <StyleFieldRow label="Weight" type="select" value={studio.du.weight} options={[[400, 'Regular'], [500, 'Medium'], [600, 'SemiBold'], [700, 'Bold'], [800, 'ExtraBold']]} onchange={(v) => ((studio.du.weight = +v), studio.inv())} />
      <StyleFieldRow label="Font Size" value={studio.du.size} min={14} max={120} unit="px" onchange={(v) => ((studio.du.size = v), studio.inv())} />
      <StyleFieldRow label="Line Height" value={Math.round((studio.du.sourceLh || 1.28) * 100)} min={90} max={220} unit="%" onchange={(v) => ((studio.du.sourceLh = v / 100), studio.inv())} />
      <StyleFieldRow label="Align" type="select" value={studio.du.sourceAlign} options={[['center', 'Center'], ['left', 'Left'], ['right', 'Right']]} onchange={(v) => ((studio.du.sourceAlign = v), studio.inv())} />
      <StyleFieldRow label="Text Color" type="color" value={studio.du.sourceColor} onchange={(v) => ((studio.du.sourceColor = v), studio.inv())} />
      <StyleFieldRow label="Outline Color" type="color" value={studio.du.sourceStrokeColor} onchange={(v) => ((studio.du.sourceStrokeColor = v), studio.inv())} />
      <StyleFieldRow label="Outline Width" value={studio.du.sourceStroke} min={0} max={14} unit="px" onchange={(v) => ((studio.du.sourceStroke = v), studio.inv())} />
      <StyleFieldRow label="Drop Shadow" value={studio.du.sourceShadow} min={0} max={24} unit="px" onchange={(v) => ((studio.du.sourceShadow = v), studio.inv())} />
      <StyleFieldRow label="Max Width" value={studio.du.sourceMaxW} min={30} max={96} unit="%" onchange={(v) => ((studio.du.sourceMaxW = v), studio.inv())} />
      <StyleFieldRow label="Max Lines" type="select" value={studio.du.sourceMaxLines} options={[[1, '1 line'], [2, '2 lines'], [3, '3 lines'], [0, 'Unlimited']]} onchange={(v) => ((studio.du.sourceMaxLines = +v), studio.inv())} />
      <StyleFieldRow label="Position X" value={studio.du.sourceX} min={5} max={95} unit="%" onchange={(v) => ((studio.du.sourceX = v), studio.inv())} />
      <StyleFieldRow label="Position Y" value={studio.du.sourceY} min={5} max={95} unit="%" onchange={(v) => ((studio.du.sourceY = v), studio.inv())} />
    {:else}
      <StyleFieldRow label="Font" type="select" value={studio.st.font} options={fontOpts} onchange={(v) => ((studio.st.font = v), studio.inv())} />
      <StyleFieldRow label="Font Size" value={studio.st.size} min={20} max={200} unit="px" onchange={(v) => ((studio.st.size = v), studio.inv())} />
      <StyleFieldRow label="Bold Weight" type="check" value={studio.st.bold} onchange={(v) => ((studio.st.bold = v ? 1 : 0), studio.inv())} />
      <StyleFieldRow label="UPPERCASE" type="check" value={studio.st.upper} onchange={(v) => ((studio.st.upper = v ? 1 : 0), studio.inv())} />
      <StyleFieldRow label="Line Height" value={Math.round((studio.st.lh || 1.3) * 100)} min={90} max={220} unit="%" onchange={(v) => ((studio.st.lh = v / 100), studio.inv())} />
      <StyleFieldRow label="Letter Spacing" value={studio.st.ls} min={-4} max={16} unit="px" onchange={(v) => ((studio.st.ls = v), studio.inv())} />
      <StyleFieldRow label="Align" type="select" value={studio.st.align} options={[['center', 'Center'], ['left', 'Left'], ['right', 'Right']]} onchange={(v) => ((studio.st.align = v), studio.inv())} />
      <StyleFieldRow label="Text Color" type="color" value={studio.st.color} onchange={(v) => ((studio.st.color = v), (studio.st.acc = 0), studio.inv())} />
      <StyleFieldRow label="Outline Color" type="color" value={studio.st.stroke} onchange={(v) => ((studio.st.stroke = v), studio.inv())} />
      <StyleFieldRow label="Outline Width" value={studio.st.sw} min={0} max={30} unit="px" onchange={(v) => ((studio.st.sw = v), studio.inv())} />
      <StyleFieldRow label="Max Width" value={studio.st.w} min={25} max={96} unit="%" onchange={(v) => ((studio.st.w = v), studio.inv())} />
      <StyleFieldRow label="Max Lines" type="select" value={studio.st.maxLines} options={[[1, '1 line'], [2, '2 lines'], [3, '3 lines'], [4, '4 lines'], [0, 'Unlimited']]} onchange={(v) => ((studio.st.maxLines = +v), studio.inv())} />
      <StyleFieldRow label="Horizontal X" value={studio.st.x ?? 50} min={10} max={90} unit="%" onchange={(v) => ((studio.st.x = v), studio.inv())} />
      <StyleFieldRow label="Vertical Y" value={studio.st.y} min={5} max={95} unit="%" onchange={(v) => ((studio.st.y = v), (studio.st.auto = 0), studio.inv())} />
    {/if}
  </CategoryBlock>

{:else if tab === 'trans'}
  <CategoryBlock
    title="Dual Subtitles (Secondary Translation Line)"
    icon="languages"
    open={true}
    toggleChecked={!!studio.du.on}
    onToggle={(v) => ((studio.du.on = v ? 1 : 0), studio.inv(), studio.snap())}
  >
    {#if studio.du.on}
      <StyleFieldRow label="Show Translation" type="check" value={studio.du.showTranslation} onchange={(v) => ((studio.du.showTranslation = v), studio.inv())} />
      <StyleFieldRow label="Font" type="select" value={studio.du.translationFont} options={dualTrFontOpts} onchange={(v) => ((studio.du.translationFont = v), studio.inv())} />
      <StyleFieldRow label="Weight" type="select" value={studio.du.transWeight} options={[[400, 'Regular'], [500, 'Medium'], [600, 'SemiBold'], [700, 'Bold']]} onchange={(v) => ((studio.du.transWeight = +v), studio.inv())} />
      <StyleFieldRow label="Font Size" value={studio.du.transSize} min={14} max={100} unit="px" onchange={(v) => ((studio.du.transSize = v), studio.inv())} />
      <StyleFieldRow label="Line Height" value={Math.round((studio.du.transLh || 1.24) * 100)} min={90} max={220} unit="%" onchange={(v) => ((studio.du.transLh = v / 100), studio.inv())} />
      <StyleFieldRow label="Align" type="select" value={studio.du.transAlign} options={[['center', 'Center'], ['left', 'Left'], ['right', 'Right']]} onchange={(v) => ((studio.du.transAlign = v), studio.inv())} />
      <StyleFieldRow label="Text Color" type="color" value={studio.du.transColor} onchange={(v) => ((studio.du.transColor = v), studio.inv())} />
      <StyleFieldRow label="Outline Color" type="color" value={studio.du.transStrokeColor} onchange={(v) => ((studio.du.transStrokeColor = v), studio.inv())} />
      <StyleFieldRow label="Outline Width" value={studio.du.transStroke} min={0} max={14} unit="px" onchange={(v) => ((studio.du.transStroke = v), studio.inv())} />
      <StyleFieldRow label="Drop Shadow" value={studio.du.transShadow} min={0} max={24} unit="px" onchange={(v) => ((studio.du.transShadow = v), studio.inv())} />
      <StyleFieldRow label="Max Width" value={studio.du.transMaxW} min={30} max={96} unit="%" onchange={(v) => ((studio.du.transMaxW = v), studio.inv())} />
      <StyleFieldRow label="Max Lines" type="select" value={studio.du.transMaxLines} options={[[1, '1 line'], [2, '2 lines'], [3, '3 lines'], [0, 'Unlimited']]} onchange={(v) => ((studio.du.transMaxLines = +v), studio.inv())} />
      <StyleFieldRow label="Position X" value={studio.du.transX} min={5} max={95} unit="%" onchange={(v) => ((studio.du.transX = v), studio.inv())} />
      <StyleFieldRow label="Position Y" value={studio.du.transY} min={5} max={95} unit="%" onchange={(v) => ((studio.du.transY = v), studio.inv())} />
    {:else}
      <div class="sub-card" style="text-align:center;padding:16px 12px">
        <b style="font-size:12.5px;display:block;margin-bottom:4px">Dual Subtitles is Inactive</b>
        <p class="hint" style="margin:0 0 10px">
          Enable Dual Subtitles to render an Arabic or speech line alongside English, Urdu, or another translation simultaneously.
        </p>
        <button
          type="button"
          class="sm pri"
          onclick={() => {
            studio.du.on = 1;
            studio.inv();
            studio.snap();
          }}
        >
          Enable Dual Subtitles
        </button>
      </div>
    {/if}
  </CategoryBlock>

{:else if tab === 'card'}
  <CategoryBlock title="Container Card & Pill Styling" icon="subtitles" open={true}>
    {#if studio.du.on}
      <StyleFieldRow
        label="Layout Mode"
        type="select"
        value={studio.du.dualMode}
        options={[
          ['paired', 'Paired card'],
          ['independent', 'Free independent layers'],
          ['split', 'Split (Top + Bottom)'],
        ]}
        onchange={(v) => ((studio.du.dualMode = v), studio.inv())}
      />
      <StyleFieldRow
        label="Card Style"
        type="select"
        value={studio.du.style}
        options={[
          ['classic', 'Classic · blur panel'],
          ['glass', 'Frosted glass'],
          ['parchment', 'Poem · parchment'],
          ['pill', 'Soft pills'],
          ['clean', 'Clean (no box)'],
        ]}
        onchange={(v) => ((studio.du.style = v), studio.inv())}
      />
      <StyleFieldRow label="Card Pad X" value={studio.du.padX} min={0} max={70} unit="px" onchange={(v) => ((studio.du.padX = v), studio.inv())} />
      <StyleFieldRow label="Card Pad Y" value={studio.du.padY} min={0} max={50} unit="px" onchange={(v) => ((studio.du.padY = v), studio.inv())} />
      <StyleFieldRow label="Line Gap" value={studio.du.gap} min={0} max={48} unit="px" onchange={(v) => ((studio.du.gap = v), studio.inv())} />
      <StyleFieldRow label="Corner Radius" value={studio.du.radius} min={0} max={44} unit="px" onchange={(v) => ((studio.du.radius = v), studio.inv())} />
      <StyleFieldRow label="Border Style" type="select" value={studio.du.border} options={[['none', 'None'], ['subtle', 'Subtle hairline'], ['gold', 'Warm gold accent']]} onchange={(v) => ((studio.du.border = v), studio.inv())} />
      <StyleFieldRow label="Card Color" type="color" value={studio.du.bgColor} onchange={(v) => ((studio.du.bgColor = v), studio.inv())} />
      <StyleFieldRow label="Opacity" value={studio.du.bgOpacity} min={0} max={100} unit="%" onchange={(v) => ((studio.du.bgOpacity = v), studio.inv())} />
      <div class="bar" style="margin-top:10px;margin-bottom:0">
        <button type="button" class="xs" onclick={() => ((studio.du.sourceX = 50), (studio.du.transX = 50), studio.inv())}>Center X</button>
        <button type="button" class="xs" onclick={() => ((studio.du.sourceX = 50), (studio.du.transX = 50), (studio.du.sourceY = 72), (studio.du.transY = 82), studio.inv())}>Stack Clean</button>
        <button type="button" class="xs" onclick={() => (([studio.du.sourceY, studio.du.transY] = [studio.du.transY, studio.du.sourceY]), studio.inv())}>⇅ Swap Y</button>
      </div>
    {:else}
      <StyleFieldRow label="Box Mode" type="select" value={studio.st.boxMode} options={[['block', 'Unified box'], ['line', 'Per-line pills']]} onchange={(v) => ((studio.st.boxMode = v), studio.inv())} />
      <StyleFieldRow label="Box Color" type="color" value={studio.st.bg} onchange={(v) => ((studio.st.bg = v), studio.inv())} />
      <StyleFieldRow label="Box Opacity" value={studio.st.bga} min={0} max={100} unit="%" onchange={(v) => ((studio.st.bga = v), studio.inv())} />
      <StyleFieldRow label="Pad X" value={studio.st.padX} min={0} max={80} unit="px" onchange={(v) => ((studio.st.padX = v), studio.inv())} />
      <StyleFieldRow label="Pad Y" value={studio.st.padY} min={0} max={60} unit="px" onchange={(v) => ((studio.st.padY = v), studio.inv())} />
      <StyleFieldRow label="Corner Radius" value={studio.st.boxR} min={0} max={50} unit="px" onchange={(v) => ((studio.st.boxR = v), studio.inv())} />
    {/if}
  </CategoryBlock>

{:else if tab === 'motion'}
  <CategoryBlock title="Word Highlights & Motion" icon="sparkles" open={true}>
    <StyleFieldRow label="Word Highlight" type="check" value={studio.st.hl} onchange={(v) => ((studio.st.hl = v ? 1 : 0), studio.inv())} />
    {#if studio.st.hl}
      <StyleFieldRow label="Highlight Style" type="select" value={studio.st.hlStyle} options={[['color', 'Active word color'], ['pill', 'Animated pill']]} onchange={(v) => ((studio.st.hlStyle = v), studio.inv())} />
      <StyleFieldRow label="Highlight Color" type="color" value={studio.st.hlc} onchange={(v) => ((studio.st.hlc = v), studio.inv())} />
    {/if}
    <StyleFieldRow label="Entrance Anim" type="select" value={studio.st.anim} options={[['fade', 'Smooth fade'], ['slide', 'Slide up'], ['pop', 'Scale pop'], ['none', 'None']]} onchange={(v) => ((studio.st.anim = v), studio.inv())} />
    <StyleFieldRow label="Drop Shadow" type="check" value={studio.st.shadow} onchange={(v) => ((studio.st.shadow = v ? 1 : 0), studio.inv())} />
    {#if studio.st.shadow}
      <StyleFieldRow label="Shadow Color" type="color" value={studio.st.shc} onchange={(v) => ((studio.st.shc = v), studio.inv())} />
      <StyleFieldRow label="Shadow Opacity" value={studio.st.sha} min={0} max={100} unit="%" onchange={(v) => ((studio.st.sha = v), studio.inv())} />
      <StyleFieldRow label="Shadow Blur" value={studio.st.shb} min={0} max={40} unit="px" onchange={(v) => ((studio.st.shb = v), studio.inv())} />
      <StyleFieldRow label="Offset X" value={studio.st.shx} min={-20} max={20} unit="px" onchange={(v) => ((studio.st.shx = v), studio.inv())} />
      <StyleFieldRow label="Offset Y" value={studio.st.shy} min={-20} max={20} unit="px" onchange={(v) => ((studio.st.shy = v), studio.inv())} />
    {/if}
  </CategoryBlock>

{:else}
  <CategoryBlock title="Presets Library" icon="palette" open={true}>
    <div class="preset-grid">
      {#each [...customPresets, ...BUILT_IN_PRESETS] as p (p.id)}
        <button type="button" class="preset-tile" onclick={() => applyPreset(p)}>
          <span class="badge">{p.format || '9:16'}</span>
          <span class="pt-name">{p.name}</span>
        </button>
      {/each}
    </div>
    <div class="sub-card" style="margin-top:10px">
      <div class="rt" style="margin-bottom:6px">
        <input bind:value={presetName} placeholder="Save current style as preset…" style="flex:1;min-width:0" />
        <select bind:value={presetFmt} style="width:74px">
          <option value="current">Auto</option>
          <option value="9:16">9:16</option>
          <option value="4:5">4:5</option>
          <option value="1:1">1:1</option>
          <option value="16:9">16:9</option>
        </select>
      </div>
      <div class="rt">
        <button type="button" class="pri sm" style="flex:1" onclick={savePreset}>Save Preset</button>
        <button
          type="button"
          class="sm"
          onclick={() => saveBlob(new Blob([JSON.stringify(customPresets, null, 2)], { type: 'application/json' }), 'presets.json')}
        >
          Export
        </button>
      </div>
    </div>
  </CategoryBlock>
{/if}

<style>
  .preset-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .preset-tile {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 9px;
    text-align: left;
    white-space: normal;
  }
  .preset-tile:hover {
    border-color: var(--accent-primary);
    background: var(--accent-primary-soft);
  }
  .pt-name {
    font-size: 11.5px;
    font-weight: 600;
  }
</style>
