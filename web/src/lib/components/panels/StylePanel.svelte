<script>
  import { AUD0, DU0, FONTS, FR0, GR0, HD0, SPK0, ST0, SUBCFG0, WM0 } from '../../constants.js';
  import { BUILT_IN_PRESETS, loadCustomPresets, migrateLegacyDual, saveCustomPresets } from '../../presets.js';
  import { saveBlob } from '../../renderer.js';
  import { studio } from '../../state.svelte.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import Icon from '../Icon.svelte';
  import StyleFieldRow from '../StyleFieldRow.svelte';

  let presetName = $state('');
  let presetFmt = $state('current');
  let presetScope = $state('all');
  let presetFilter = $state('all');
  let customPresets = $state(loadCustomPresets());
  let importInput = $state(null);

  const fontOpts = FONTS.map(([n, v]) => [v, n]);
  const dualSrcFontOpts = [
    ['', 'Default Arabic (Amiri)'],
    ['Amiri', 'Amiri'],
    ['Noto Naskh Arabic', 'Noto Naskh Arabic'],
    ['Cairo', 'Cairo'],
    ['Georgia', 'Georgia'],
    ['serif', 'Serif'],
    ['system-ui', 'System'],
  ];
  const dualTrFontOpts = [
    ['system-ui', 'System'],
    ['Inter, Segoe UI, sans-serif', 'Inter / Segoe UI'],
    ['Georgia', 'Georgia'],
    ['serif', 'Serif'],
    ['sans-serif', 'Sans serif'],
  ];

  const q = $derived(studio.styleSearch.trim().toLowerCase());
  const matches = (keywords) => !q || keywords.toLowerCase().includes(q);

  const filteredBuiltIn = $derived(
    BUILT_IN_PRESETS.filter((p) => presetFilter === 'all' || p.format === presetFilter || p.format === 'any')
  );
  const filteredCustom = $derived(
    customPresets.filter((p) => presetFilter === 'all' || p.format === presetFilter)
  );

  function applyPreset(p) {
    if (!p) return;
    const full = p.scope !== 'subtitle';
    if (full && p.aspect) studio.aspect = p.aspect;
    if (full && p.mode) studio.mode = p.mode;
    if (p.st) {
      studio.st = { ...ST0, ...p.st };
      if (!full && studio.mode === 'simple' && p.st.acc === undefined) {
        studio.st.acc = 0;
        studio.st.color = '#ffffff';
      }
    }
    if (full && p.fr) studio.fr = { ...FR0, ...p.fr };
    if (full && p.gr) studio.gr = { ...GR0, ...p.gr };
    if (full) {
      for (const k of ['spk', 'wm', 'hd']) {
        if (p[k]) studio[k] = { ...studio[k], ...p[k], text: studio[k].text };
      }
    }
    if (p.du) studio.du = migrateLegacyDual(p.du);
    if (full && p.grain !== undefined) studio.grain = p.grain;
    if (full && p.cam) studio.cam = p.cam;
    if (p.subCfg) studio.subCfg = { ...SUBCFG0, ...p.subCfg };
    studio.inv();
    studio.snap();
    studio.toast(`Applied preset: ${p.name}${p.aspect && full ? ` (${p.aspect})` : ''}`);
  }

  function capturePreset(name, format, scope) {
    const base = {
      id: 'cp_' + Date.now(),
      name,
      format,
      scope,
      updatedAt: Date.now(),
      aspect: format === 'any' ? studio.aspect : format,
    };
    const plain = (x) => JSON.parse(JSON.stringify(x));
    if (scope === 'subtitle') {
      return { ...base, st: plain(studio.st), du: plain(studio.du), subCfg: plain(studio.subCfg) };
    }
    return {
      ...base,
      mode: studio.mode,
      st: plain(studio.st),
      fr: plain(studio.fr),
      gr: plain(studio.gr),
      spk: { ...studio.spk, text: '' },
      wm: { ...studio.wm, text: '' },
      hd: { ...studio.hd, text: '' },
      du: plain(studio.du),
      grain: studio.grain,
      cam: studio.cam,
      subCfg: plain(studio.subCfg),
    };
  }

  function savePreset() {
    const name = presetName.trim();
    if (!name) return studio.toast('Enter a preset name first');
    const format = presetFmt === 'current' ? studio.aspect : presetFmt;
    const next = [...customPresets];
    const obj = capturePreset(name, format, presetScope);
    const ix = next.findIndex((x) => x.name.toLowerCase() === name.toLowerCase() && x.format === format);
    if (ix >= 0) {
      obj.id = next[ix].id;
      next[ix] = obj;
    } else next.unshift(obj);
    customPresets = next;
    saveCustomPresets(next);
    presetName = '';
    studio.toast(`Saved ${format} preset: ${name}`);
  }

  function deletePreset(id) {
    const target = customPresets.find((x) => x.id === id);
    if (!target || !confirm(`Delete preset “${target.name}”?`)) return;
    customPresets = customPresets.filter((x) => x.id !== id);
    saveCustomPresets(customPresets);
  }
</script>

<input
  bind:this={importInput}
  type="file"
  accept=".json"
  hidden
  onchange={async (e) => {
    const f = e.currentTarget.files?.[0];
    if (!f) return;
    try {
      const imp = JSON.parse(await f.text());
      if (!Array.isArray(imp)) throw new Error('Invalid presets JSON');
      const next = [...customPresets];
      for (const item of imp) {
        if (item?.name) next.unshift({ ...item, id: 'cp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) });
      }
      customPresets = next;
      saveCustomPresets(next);
      studio.toast(`Imported ${imp.length} preset(s)`);
    } catch (err) {
      studio.toast('Import failed: ' + (err?.message || err));
    }
    e.currentTarget.value = '';
  }}
/>

<!-- Minbar-style search & sub-tab navigator -->
<div class="search-bar">
  <Icon name="search" size={13} />
  <input placeholder="Filter styles (font, padding, glow, translation…)" bind:value={studio.styleSearch} />
  {#if studio.styleSearch}
    <button type="button" class="xs" onclick={() => (studio.styleSearch = '')}>✕</button>
  {/if}
</div>

<div class="seg-pills tri">
  <button type="button" class:on={studio.styleSubTab === 'main'} onclick={() => (studio.styleSubTab = 'main')}>Main Subs</button>
  <button type="button" class:on={studio.styleSubTab === 'dual'} onclick={() => (studio.styleSubTab = 'dual')}>Dual Independent</button>
  <button type="button" class:on={studio.styleSubTab === 'presets'} onclick={() => (studio.styleSubTab = 'presets')}>Presets</button>
</div>

{#if studio.styleSubTab === 'main' || q}
  {#if matches('typography font size spacing align bold uppercase')}
    <CategoryBlock title="Typography & Color" icon="type" open={true}>
      <StyleFieldRow label="Font family" type="select" value={studio.st.font} options={fontOpts} onchange={(v) => ((studio.st.font = v), studio.inv())} />
      <StyleFieldRow label="Font size" value={studio.st.size} min={20} max={200} unit="px" onchange={(v) => ((studio.st.size = v), studio.inv())} />
      <StyleFieldRow label="Line height" value={studio.st.lh} min={0.8} max={2.0} step={0.05} onchange={(v) => ((studio.st.lh = v), studio.inv())} />
      <StyleFieldRow label="Letter spacing" value={studio.st.ls} min={-2} max={20} step={0.5} unit="px" onchange={(v) => ((studio.st.ls = v), studio.inv())} />
      <StyleFieldRow
        label="Alignment"
        type="select"
        value={studio.st.align}
        options={[
          ['center', 'Center'],
          ['left', 'Left'],
          ['right', 'Right'],
        ]}
        onchange={(v) => ((studio.st.align = v), studio.inv())}
      />
      <StyleFieldRow label="Bold" type="check" value={studio.st.bold} onchange={(v) => ((studio.st.bold = v ? 1 : 0), studio.inv())} />
      <StyleFieldRow label="UPPERCASE" type="check" value={studio.st.upper} onchange={(v) => ((studio.st.upper = v ? 1 : 0), studio.inv())} />
      <div class="style-control-group-heading">Colors & Outline</div>
      <StyleFieldRow label="Theme accent" type="check" value={studio.st.acc} onchange={(v) => ((studio.st.acc = v ? 1 : 0), studio.inv())} />
      <StyleFieldRow label="Text color" type="color" value={studio.st.color} onchange={(v) => ((studio.st.color = v), (studio.st.acc = 0), studio.inv())} />
      <StyleFieldRow label="Outline color" type="color" value={studio.st.stroke} onchange={(v) => ((studio.st.stroke = v), studio.inv())} />
      <StyleFieldRow label="Outline width" value={studio.st.sw} min={0} max={30} unit="px" onchange={(v) => ((studio.st.sw = v), studio.inv())} />
    </CategoryBlock>
  {/if}

  {#if matches('padding max lines box pill width margin shrink')}
    <CategoryBlock title="Padding, Box & Max Lines" icon="subtitles" open={true}>
      <StyleFieldRow label="Box pad X" value={studio.st.padX} min={0} max={80} unit="px" onchange={(v) => ((studio.st.padX = v), studio.inv())} />
      <StyleFieldRow label="Box pad Y" value={studio.st.padY} min={0} max={60} unit="px" onchange={(v) => ((studio.st.padY = v), studio.inv())} />
      <StyleFieldRow label="Corner radius" value={studio.st.boxR} min={0} max={50} unit="px" onchange={(v) => ((studio.st.boxR = v), studio.inv())} />
      <StyleFieldRow
        label="Box mode"
        type="select"
        value={studio.st.boxMode}
        options={[
          ['block', 'Unified box'],
          ['line', 'Per-line pills'],
        ]}
        onchange={(v) => ((studio.st.boxMode = v), studio.inv())}
      />
      <StyleFieldRow label="Box color" type="color" value={studio.st.bg} onchange={(v) => ((studio.st.bg = v), studio.inv())} />
      <StyleFieldRow label="Box opacity" value={studio.st.bga} min={0} max={100} unit="%" onchange={(v) => ((studio.st.bga = v), studio.inv())} />
      <div class="style-control-group-heading">Max Limits & Safe Area</div>
      <StyleFieldRow label="Max width" value={studio.st.w} min={30} max={96} unit="%" onchange={(v) => ((studio.st.w = v), studio.inv())} />
      <StyleFieldRow
        label="Max lines"
        type="select"
        value={studio.st.maxLines}
        options={[
          [1, '1 line'],
          [2, '2 lines'],
          [3, '3 lines'],
          [4, '4 lines'],
          [0, 'Unlimited'],
        ]}
        onchange={(v) => ((studio.st.maxLines = +v), studio.inv())}
      />
      <StyleFieldRow label="Screen pad X" value={studio.st.marginX} min={2} max={22} unit="%" onchange={(v) => ((studio.st.marginX = v), studio.inv())} />
      <StyleFieldRow label="Safe pad Y" value={studio.st.marginY} min={8} max={80} unit="px" onchange={(v) => ((studio.st.marginY = v), studio.inv())} />
      <StyleFieldRow label="Auto-shrink fit" type="check" value={studio.st.fit} onchange={(v) => ((studio.st.fit = v ? 1 : 0), studio.inv())} />
      <StyleFieldRow label="Min shrink size" value={studio.st.minSize} min={20} max={80} unit="px" onchange={(v) => ((studio.st.minSize = v), studio.inv())} />
    </CategoryBlock>
  {/if}

  {#if matches('highlight word pill animation position shadow shade')}
    <CategoryBlock title="Word Highlight, Position & Shadow" icon="sparkles" open={false}>
      <StyleFieldRow label="Word highlight" type="check" value={studio.st.hl} onchange={(v) => ((studio.st.hl = v ? 1 : 0), studio.inv())} />
      {#if studio.st.hl}
        <StyleFieldRow
          label="Highlight style"
          type="select"
          value={studio.st.hlStyle}
          options={[
            ['color', 'Text color'],
            ['pill', 'Word pill'],
          ]}
          onchange={(v) => ((studio.st.hlStyle = v), studio.inv())}
        />
        <StyleFieldRow label="Highlight color" type="color" value={studio.st.hlc} onchange={(v) => ((studio.st.hlc = v), studio.inv())} />
      {/if}
      <StyleFieldRow label="Auto position" type="check" value={studio.st.auto} onchange={(v) => ((studio.st.auto = v ? 1 : 0), studio.inv())} />
      <StyleFieldRow label="Vertical Y" value={studio.st.y} min={5} max={95} unit="%" onchange={(v) => ((studio.st.y = v), (studio.st.auto = 0), studio.inv())} />
      <StyleFieldRow
        label="Entrance"
        type="select"
        value={studio.st.anim}
        options={[
          ['fade', 'Fade + rise'],
          ['slide', 'Slide up'],
          ['pop', 'Pop'],
          ['none', 'None'],
        ]}
        onchange={(v) => ((studio.st.anim = v), studio.inv())}
      />
      <div class="style-control-group-heading">Drop Shadow</div>
      <StyleFieldRow label="Enable shadow" type="check" value={studio.st.shadow} onchange={(v) => ((studio.st.shadow = v ? 1 : 0), studio.inv())} />
      {#if studio.st.shadow}
        <StyleFieldRow label="Shadow color" type="color" value={studio.st.shc} onchange={(v) => ((studio.st.shc = v), studio.inv())} />
        <StyleFieldRow label="Opacity" value={studio.st.sha} min={0} max={100} unit="%" onchange={(v) => ((studio.st.sha = v), studio.inv())} />
        <StyleFieldRow label="Blur" value={studio.st.shb} min={0} max={60} unit="px" onchange={(v) => ((studio.st.shb = v), studio.inv())} />
        <StyleFieldRow label="Offset X" value={studio.st.shx} min={-50} max={50} onchange={(v) => ((studio.st.shx = v), studio.inv())} />
        <StyleFieldRow label="Offset Y" value={studio.st.shy} min={-50} max={50} onchange={(v) => ((studio.st.shy = v), studio.inv())} />
      {/if}
    </CategoryBlock>
  {/if}
{/if}

{#if studio.styleSubTab === 'dual' || q}
  <CategoryBlock
    title="Dual Subtitles (Independent Layers)"
    icon="languages"
    open={true}
    toggleChecked={!!studio.du.on}
    onToggle={(v) => ((studio.du.on = v ? 1 : 0), studio.inv(), studio.snap())}
  >
    <div class="seg-pills tri" style="margin-top:2px">
      <button type="button" class:on={studio.dualSubTab === 'layout'} onclick={() => (studio.dualSubTab = 'layout')}>Layout & Drag</button>
      <button type="button" class:on={studio.dualSubTab === 'source'} onclick={() => (studio.dualSubTab = 'source')}>Source Line</button>
      <button type="button" class:on={studio.dualSubTab === 'trans'} onclick={() => (studio.dualSubTab = 'trans')}>Translation</button>
    </div>

    {#if studio.dualSubTab === 'layout'}
      <StyleFieldRow
        label="Placement mode"
        type="select"
        value={studio.du.dualMode}
        options={[
          ['paired', 'Paired card (together)'],
          ['independent', 'Free / independent boxes'],
          ['split', 'Split (Source + Bottom sub)'],
        ]}
        onchange={(v) => ((studio.du.dualMode = v), studio.inv())}
      />
      <StyleFieldRow
        label="Card theme"
        type="select"
        value={studio.du.style}
        options={[
          ['classic', 'Classic · blurred panel'],
          ['glass', 'Frosted glass card'],
          ['parchment', 'Poem / qasida · parchment'],
          ['pill', 'Separate soft pills'],
          ['clean', 'Clean text (no panel)'],
        ]}
        onchange={(v) => ((studio.du.style = v), studio.inv())}
      />
      <StyleFieldRow label="Card pad X" value={studio.du.padX} min={0} max={70} unit="px" onchange={(v) => ((studio.du.padX = v), studio.inv())} />
      <StyleFieldRow label="Card pad Y" value={studio.du.padY} min={0} max={50} unit="px" onchange={(v) => ((studio.du.padY = v), studio.inv())} />
      <StyleFieldRow label="Card radius" value={studio.du.radius} min={0} max={44} unit="px" onchange={(v) => ((studio.du.radius = v), studio.inv())} />
      <StyleFieldRow label="Card color" type="color" value={studio.du.bgColor} onchange={(v) => ((studio.du.bgColor = v), studio.inv())} />
      <StyleFieldRow label="Card opacity" value={studio.du.bgOpacity} min={0} max={100} unit="%" onchange={(v) => ((studio.du.bgOpacity = v), studio.inv())} />

      <div class="style-control-group-heading">Canvas Drag Target (Wheel = Font Size)</div>
      <div class="seg-pills tri">
        <button type="button" class:on={studio.du.dragTarget === 'auto'} onclick={() => (studio.du.dragTarget = 'auto')}>Auto</button>
        <button type="button" class:on={studio.du.dragTarget === 'source'} onclick={() => (studio.du.dragTarget = 'source')}>Source Only</button>
        <button type="button" class:on={studio.du.dragTarget === 'translation'} onclick={() => (studio.du.dragTarget = 'translation')}>Translation Only</button>
      </div>
      <div class="bar" style="margin-top:6px;margin-bottom:2px">
        <button
          type="button"
          class="xs"
          onclick={() => {
            studio.du.sourceX = 50;
            studio.du.transX = 50;
            studio.inv();
            studio.snap();
          }}
        >
          Center X = 50%
        </button>
        <button
          type="button"
          class="xs"
          onclick={() => {
            studio.du.sourceX = 50;
            studio.du.transX = 50;
            studio.du.sourceY = 72;
            studio.du.transY = 82;
            studio.inv();
            studio.snap();
          }}
        >
          Stack Cleanly
        </button>
        <button
          type="button"
          class="xs"
          onclick={() => {
            [studio.du.sourceX, studio.du.transX] = [studio.du.transX, studio.du.sourceX];
            [studio.du.sourceY, studio.du.transY] = [studio.du.transY, studio.du.sourceY];
            studio.inv();
            studio.snap();
          }}
        >
          ⇅ Swap X/Y
        </button>
      </div>
    {:else if studio.dualSubTab === 'source'}
      <StyleFieldRow label="Show source line" type="check" value={studio.du.showSource} onchange={(v) => ((studio.du.showSource = v), studio.inv())} />
      <StyleFieldRow label="Font" type="select" value={studio.du.sourceFont} options={dualSrcFontOpts} onchange={(v) => ((studio.du.sourceFont = v), studio.inv())} />
      <StyleFieldRow
        label="Weight"
        type="select"
        value={studio.du.weight}
        options={[
          [700, 'Bold'],
          [600, 'Semi-bold'],
          [500, 'Medium'],
          [400, 'Regular'],
        ]}
        onchange={(v) => ((studio.du.weight = +v), studio.inv())}
      />
      <StyleFieldRow label="Size" value={studio.du.size} min={14} max={120} unit="px" onchange={(v) => ((studio.du.size = v), studio.inv())} />
      <StyleFieldRow label="Line height" value={studio.du.sourceLh} min={0.9} max={1.8} step={0.02} onchange={(v) => ((studio.du.sourceLh = v), studio.inv())} />
      <StyleFieldRow label="Color" type="color" value={studio.du.sourceColor} onchange={(v) => ((studio.du.sourceColor = v), studio.inv())} />
      <StyleFieldRow
        label="Align"
        type="select"
        value={studio.du.sourceAlign}
        options={[
          ['center', 'Center'],
          ['left', 'Left'],
          ['right', 'Right'],
        ]}
        onchange={(v) => ((studio.du.sourceAlign = v), studio.inv())}
      />
      <StyleFieldRow label="Max width" value={studio.du.sourceMaxW} min={25} max={96} unit="%" onchange={(v) => ((studio.du.sourceMaxW = v), studio.inv())} />
      <StyleFieldRow label="Max lines" type="select" value={studio.du.sourceMaxLines} options={[[1, '1 line'], [2, '2 lines'], [3, '3 lines'], [4, '4 lines'], [0, 'Unlimited']]} onchange={(v) => ((studio.du.sourceMaxLines = +v), studio.inv())} />
      <StyleFieldRow label="Outline width" value={studio.du.sourceStroke} min={0} max={14} unit="px" onchange={(v) => ((studio.du.sourceStroke = v), studio.inv())} />
      <StyleFieldRow label="Outline color" type="color" value={studio.du.sourceStrokeColor} onchange={(v) => ((studio.du.sourceStrokeColor = v), studio.inv())} />
      <StyleFieldRow label="Shadow blur" value={studio.du.sourceShadow} min={0} max={24} unit="px" onchange={(v) => ((studio.du.sourceShadow = v), studio.inv())} />
      <div class="style-control-group-heading">Independent Box & Position</div>
      <StyleFieldRow label="Own pill / box" type="check" value={studio.du.sourceBgOn} onchange={(v) => ((studio.du.sourceBgOn = v), studio.inv())} />
      {#if studio.du.sourceBgOn}
        <StyleFieldRow label="Box color" type="color" value={studio.du.sourceBgColor} onchange={(v) => ((studio.du.sourceBgColor = v), studio.inv())} />
        <StyleFieldRow label="Box opacity" value={studio.du.sourceBgOpacity} min={0} max={100} unit="%" onchange={(v) => ((studio.du.sourceBgOpacity = v), studio.inv())} />
        <StyleFieldRow label="Pad X" value={studio.du.sourcePadX} min={0} max={60} unit="px" onchange={(v) => ((studio.du.sourcePadX = v), studio.inv())} />
        <StyleFieldRow label="Pad Y" value={studio.du.sourcePadY} min={0} max={40} unit="px" onchange={(v) => ((studio.du.sourcePadY = v), studio.inv())} />
        <StyleFieldRow label="Radius" value={studio.du.sourceRadius} min={0} max={40} unit="px" onchange={(v) => ((studio.du.sourceRadius = v), studio.inv())} />
      {/if}
      <StyleFieldRow label="Position X" value={studio.du.sourceX} min={5} max={95} unit="%" onchange={(v) => ((studio.du.sourceX = v), studio.inv())} />
      <StyleFieldRow label="Position Y" value={studio.du.sourceY} min={5} max={95} unit="%" onchange={(v) => ((studio.du.sourceY = v), studio.inv())} />
    {:else}
      <StyleFieldRow label="Show translation" type="check" value={studio.du.showTranslation} onchange={(v) => ((studio.du.showTranslation = v), studio.inv())} />
      <StyleFieldRow label="Font" type="select" value={studio.du.translationFont} options={dualTrFontOpts} onchange={(v) => ((studio.du.translationFont = v), studio.inv())} />
      <StyleFieldRow
        label="Weight"
        type="select"
        value={studio.du.transWeight}
        options={[
          [700, 'Bold'],
          [600, 'Semi-bold'],
          [500, 'Medium'],
          [400, 'Regular'],
        ]}
        onchange={(v) => ((studio.du.transWeight = +v), studio.inv())}
      />
      <StyleFieldRow label="Size" value={studio.du.transSize} min={14} max={100} unit="px" onchange={(v) => ((studio.du.transSize = v), studio.inv())} />
      <StyleFieldRow label="Line height" value={studio.du.transLh} min={0.9} max={1.8} step={0.02} onchange={(v) => ((studio.du.transLh = v), studio.inv())} />
      <StyleFieldRow label="Color" type="color" value={studio.du.transColor} onchange={(v) => ((studio.du.transColor = v), studio.inv())} />
      <StyleFieldRow
        label="Align"
        type="select"
        value={studio.du.transAlign}
        options={[
          ['center', 'Center'],
          ['left', 'Left'],
          ['right', 'Right'],
        ]}
        onchange={(v) => ((studio.du.transAlign = v), studio.inv())}
      />
      <StyleFieldRow label="Max width" value={studio.du.transMaxW} min={25} max={96} unit="%" onchange={(v) => ((studio.du.transMaxW = v), studio.inv())} />
      <StyleFieldRow label="Max lines" type="select" value={studio.du.transMaxLines} options={[[1, '1 line'], [2, '2 lines'], [3, '3 lines'], [4, '4 lines'], [0, 'Unlimited']]} onchange={(v) => ((studio.du.transMaxLines = +v), studio.inv())} />
      <StyleFieldRow label="Outline width" value={studio.du.transStroke} min={0} max={14} unit="px" onchange={(v) => ((studio.du.transStroke = v), studio.inv())} />
      <StyleFieldRow label="Outline color" type="color" value={studio.du.transStrokeColor} onchange={(v) => ((studio.du.transStrokeColor = v), studio.inv())} />
      <StyleFieldRow label="Shadow blur" value={studio.du.transShadow} min={0} max={24} unit="px" onchange={(v) => ((studio.du.transShadow = v), studio.inv())} />
      <div class="style-control-group-heading">Independent Box & Position</div>
      <StyleFieldRow label="Own pill / box" type="check" value={studio.du.transBgOn} onchange={(v) => ((studio.du.transBgOn = v), studio.inv())} />
      {#if studio.du.transBgOn}
        <StyleFieldRow label="Box color" type="color" value={studio.du.transBgColor} onchange={(v) => ((studio.du.transBgColor = v), studio.inv())} />
        <StyleFieldRow label="Box opacity" value={studio.du.transBgOpacity} min={0} max={100} unit="%" onchange={(v) => ((studio.du.transBgOpacity = v), studio.inv())} />
        <StyleFieldRow label="Pad X" value={studio.du.transPadX} min={0} max={60} unit="px" onchange={(v) => ((studio.du.transPadX = v), studio.inv())} />
        <StyleFieldRow label="Pad Y" value={studio.du.transPadY} min={0} max={40} unit="px" onchange={(v) => ((studio.du.transPadY = v), studio.inv())} />
        <StyleFieldRow label="Radius" value={studio.du.transRadius} min={0} max={40} unit="px" onchange={(v) => ((studio.du.transRadius = v), studio.inv())} />
      {/if}
      <StyleFieldRow label="Position X" value={studio.du.transX} min={5} max={95} unit="%" onchange={(v) => ((studio.du.transX = v), studio.inv())} />
      <StyleFieldRow label="Position Y" value={studio.du.transY} min={5} max={95} unit="%" onchange={(v) => ((studio.du.transY = v), studio.inv())} />
    {/if}
  </CategoryBlock>
{/if}

{#if studio.styleSubTab === 'presets' || q}
  <CategoryBlock title="Multi-Format Presets ({studio.aspect})" icon="palette" open={true}>
    <div class="bar">
      {#each ['all', '9:16', '4:5', '1:1', '16:9'] as fmtOpt}
        <button type="button" class="xs" class:pri={presetFilter === fmtOpt} onclick={() => (presetFilter = fmtOpt)}>
          {fmtOpt === 'all' ? 'All' : fmtOpt}
        </button>
      {/each}
    </div>

    <div class="bar">
      {#each filteredBuiltIn as p (p.id)}
        <button type="button" class="xs" onclick={() => applyPreset(p)}>
          {p.name}
          {#if p.format !== 'any'}
            <span style="opacity:.6;font-size:10px">{p.format}</span>
          {/if}
        </button>
      {/each}
    </div>

    <div class="sub-card">
      <div class="rt" style="margin-bottom:6px">
        <input bind:value={presetName} placeholder="Preset name (e.g. Qasida 9:16)" style="flex:1;min-width:0" />
        <select bind:value={presetFmt} style="width:74px">
          <option value="current">Auto</option>
          <option value="9:16">9:16</option>
          <option value="4:5">4:5</option>
          <option value="1:1">1:1</option>
          <option value="16:9">16:9</option>
          <option value="any">Any</option>
        </select>
      </div>
      <div class="rt">
        <select bind:value={presetScope} style="flex:1">
          <option value="all">Full format + frame + subtitles + dual</option>
          <option value="subtitle">Subtitle & dual style only</option>
        </select>
        <button type="button" class="sm pri" onclick={savePreset}>Save</button>
      </div>
      <div class="bar" style="margin-top:6px;margin-bottom:0">
        <button
          type="button"
          class="xs"
          onclick={() => saveBlob(new Blob([JSON.stringify(customPresets, null, 2)], { type: 'application/json' }), 'instaclip-presets.json')}
        >
          Export JSON
        </button>
        <button type="button" class="xs" onclick={() => importInput?.click()}>Import JSON</button>
      </div>
    </div>

    {#if filteredCustom.length}
      {#each filteredCustom as p (p.id)}
        <div class="preset-row">
          <span class="badge">{p.format}</span>
          <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{p.name}</span>
          <button type="button" class="xs pri" onclick={() => applyPreset(p)}>Apply</button>
          <button type="button" class="xs" onclick={() => deletePreset(p.id)}>✕</button>
        </div>
      {/each}
    {:else}
      <div class="hint" style="margin-bottom:2px">No custom presets saved for this format yet.</div>
    {/if}
  </CategoryBlock>
{/if}

<style>
  .search-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 9px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 9px;
    margin-bottom: 8px;
    color: var(--text-thirdly);
  }
  .search-bar input {
    border: 0;
    background: transparent;
    padding: 2px;
    flex: 1;
    min-width: 0;
  }
  .search-bar input:focus {
    box-shadow: none;
  }
  .preset-row {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 6px 8px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-primary);
    margin-top: 6px;
  }
</style>
