<script>
  import { FSEL } from '../../constants.js';
  import { studio } from '../../state.svelte.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import StyleFieldRow from '../StyleFieldRow.svelte';

  const bnStyles = [
    ['broadcast', 'Broadcast Desk'],
    ['glass', 'Frosted Glass'],
    ['minimal', 'Minimal Editorial'],
    ['alert', 'Full Alert Strip'],
  ];

  function applyQuickNewsTemplate(kind) {
    studio.bn.on = 1;
    if (kind === 'breaking') {
      studio.bn.style = 'broadcast';
      studio.bn.labelOn = 1;
      studio.bn.label = 'BREAKING';
      studio.bn.labelBg = '#dc2626';
      studio.bn.accentColor = '#2563eb';
      studio.bn.bgColor = '#0a1428';
      studio.bn.tickerBg = '#0f2347';
      if (!studio.bn.text) studio.bn.text = 'Major Policy Update Announced Today';
      if (!studio.bn.ticker) studio.bn.ticker = 'Official statement published  •  Watch the full briefing  •  Subscribe for updates';
    } else if (kind === 'org') {
      studio.bn.style = 'glass';
      studio.bn.labelOn = 1;
      studio.bn.label = 'BRIEFING';
      studio.bn.labelBg = '#0f766e';
      studio.bn.accentColor = '#14b8a6';
      studio.bn.bgColor = '#0b111e';
      studio.bn.tickerBg = '#101b2d';
      if (!studio.bn.text) studio.bn.text = 'Annual Organization Impact Summary';
    } else {
      studio.bn.style = 'minimal';
      studio.bn.labelOn = 1;
      studio.bn.label = 'LIVE';
      studio.bn.labelBg = '#4f46e5';
      studio.bn.accentColor = '#6366f1';
      if (!studio.bn.text) studio.bn.text = 'Key Takeaways & Commentary';
    }
    studio.inv();
    studio.snap();
  }
</script>

<CategoryBlock
  title="News Channel Banner & Ticker"
  icon="film"
  open={true}
  toggleChecked={!!studio.bn.on}
  onToggle={(v) => ((studio.bn.on = v ? 1 : 0), studio.inv(), studio.snap())}
>
  <div class="bar" style="margin-bottom:8px">
    <button type="button" class="xs" onclick={() => applyQuickNewsTemplate('breaking')}>Breaking News</button>
    <button type="button" class="xs" onclick={() => applyQuickNewsTemplate('org')}>Corp Briefing</button>
    <button type="button" class="xs" onclick={() => applyQuickNewsTemplate('minimal')}>Minimal Live</button>
  </div>

  <StyleFieldRow label="Headline" type="text" value={studio.bn.text} onchange={(v) => ((studio.bn.text = v), studio.inv())} />
  <StyleFieldRow label="Kicker / Topic" type="text" value={studio.bn.kicker || ''} onchange={(v) => ((studio.bn.kicker = v), studio.inv())} />
  <StyleFieldRow label="Scrolling Ticker" type="text" value={studio.bn.ticker || ''} onchange={(v) => ((studio.bn.ticker = v), studio.inv())} />

  <div class="style-control-group-heading">Style & Badge</div>
  <StyleFieldRow label="Banner Style" type="select" value={studio.bn.style} options={bnStyles} onchange={(v) => ((studio.bn.style = v), studio.inv())} />
  <StyleFieldRow label="Show Badge" type="check" value={studio.bn.labelOn} onchange={(v) => ((studio.bn.labelOn = v ? 1 : 0), studio.inv())} />
  {#if studio.bn.labelOn}
    <StyleFieldRow label="Badge Text" type="text" value={studio.bn.label} onchange={(v) => ((studio.bn.label = v), studio.inv())} />
    <StyleFieldRow label="Badge Bg" type="color" value={studio.bn.labelBg} onchange={(v) => ((studio.bn.labelBg = v), studio.inv())} />
    <StyleFieldRow label="Badge Size" value={studio.bn.labelSize} min={14} max={44} unit="px" onchange={(v) => ((studio.bn.labelSize = v), studio.inv())} />
  {/if}
  <StyleFieldRow label="Channel Tag" type="text" value={studio.bn.logoText || ''} onchange={(v) => ((studio.bn.logoText = v), studio.inv())} />

  <div class="style-control-group-heading">Colors & Typography</div>
  <StyleFieldRow label="Font" type="select" value={studio.bn.font} options={FSEL} onchange={(v) => ((studio.bn.font = v), studio.inv())} />
  <StyleFieldRow label="Headline Size" value={studio.bn.fontSize} min={18} max={72} unit="px" onchange={(v) => ((studio.bn.fontSize = v), studio.inv())} />
  <StyleFieldRow label="Text Color" type="color" value={studio.bn.textColor} onchange={(v) => ((studio.bn.textColor = v), studio.inv())} />
  <StyleFieldRow label="Banner Bg" type="color" value={studio.bn.bgColor} onchange={(v) => ((studio.bn.bgColor = v), studio.inv())} />
  <StyleFieldRow label="Bg Opacity" value={studio.bn.bgOpacity} min={10} max={100} unit="%" onchange={(v) => ((studio.bn.bgOpacity = v), studio.inv())} />
  <StyleFieldRow label="Accent Color" type="color" value={studio.bn.accentColor} onchange={(v) => ((studio.bn.accentColor = v), studio.inv())} />
  <StyleFieldRow label="Stripe Width" value={studio.bn.accentW} min={0} max={24} unit="px" onchange={(v) => ((studio.bn.accentW = v), studio.inv())} />

  {#if studio.bn.ticker?.trim()}
    <div class="style-control-group-heading">Ticker Bar</div>
    <StyleFieldRow label="Ticker Bg" type="color" value={studio.bn.tickerBg} onchange={(v) => ((studio.bn.tickerBg = v), studio.inv())} />
    <StyleFieldRow label="Ticker Color" type="color" value={studio.bn.tickerColor} onchange={(v) => ((studio.bn.tickerColor = v), studio.inv())} />
    <StyleFieldRow label="Ticker Size" value={studio.bn.tickerSize} min={14} max={44} unit="px" onchange={(v) => ((studio.bn.tickerSize = v), studio.inv())} />
    <StyleFieldRow label="Scroll Speed" value={studio.bn.tickerSpeed} min={20} max={240} unit="px/s" onchange={(v) => ((studio.bn.tickerSpeed = v), studio.inv())} />
  {/if}

  <div class="style-control-group-heading">Position, Size & Timing</div>
  <StyleFieldRow label="Position X" value={studio.bn.x} min={10} max={90} unit="%" onchange={(v) => ((studio.bn.x = v), studio.inv())} />
  <StyleFieldRow label="Position Y" value={studio.bn.y} min={5} max={96} unit="%" onchange={(v) => ((studio.bn.y = v), studio.inv())} />
  <StyleFieldRow label="Width" value={studio.bn.w} min={30} max={100} unit="%" onchange={(v) => ((studio.bn.w = v), studio.inv())} />
  <StyleFieldRow label="Height" value={studio.bn.h} min={5} max={28} unit="%" onchange={(v) => ((studio.bn.h = v), studio.inv())} />
  <StyleFieldRow label="Radius" value={studio.bn.radius} min={0} max={36} unit="px" onchange={(v) => ((studio.bn.radius = v), studio.inv())} />
  <StyleFieldRow label="Shadow Blur" value={studio.bn.shadow} min={0} max={50} unit="px" onchange={(v) => ((studio.bn.shadow = v), studio.inv())} />
  <StyleFieldRow label="Show From" value={studio.bn.startT || 0} min={0} max={Math.max(60, Math.round(studio.dur || 60))} unit="s" onchange={(v) => ((studio.bn.startT = v), studio.inv())} />
  <StyleFieldRow label="Hide At (0=all)" value={studio.bn.endT || 0} min={0} max={Math.max(60, Math.round(studio.dur || 60))} unit="s" onchange={(v) => ((studio.bn.endT = v), studio.inv())} />
</CategoryBlock>
