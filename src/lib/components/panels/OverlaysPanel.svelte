<script>
  import { FSEL } from '../../constants.js';
  import { studio } from '../../state.svelte.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import StyleFieldRow from '../StyleFieldRow.svelte';

  let avatarIn = $state(null);

  const spkStyles = [
    ['glass', 'Frosted Glass'],
    ['card', 'Solid Broadcast'],
    ['minimalBar', 'Accent Left Bar'],
    ['outline', 'Outline Editorial'],
    ['solid', 'Gradient Pill'],
  ];

  const spkPositions = [
    ['underCard', 'Under Card'],
    ['bottomLeft', 'Bottom Left'],
    ['bottomCenter', 'Bottom Center'],
    ['topCenter', 'Top Center'],
    ['custom', 'Free Drag X/Y'],
  ];

  function onPickAvatar(e) {
    const f = e.currentTarget.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      studio.spk.avatarSrc = String(reader.result || '');
      studio.spk.on = 1;
      studio.inv();
      studio.snap();
    };
    reader.readAsDataURL(f);
    e.currentTarget.value = '';
  }
</script>

<input bind:this={avatarIn} type="file" accept="image/*" hidden onchange={onPickAvatar} />

<CategoryBlock
  title="Speaker Banner / Lower Third"
  icon="sparkles"
  open={true}
  toggleChecked={!!studio.spk.on}
  onToggle={(v) => ((studio.spk.on = v ? 1 : 0), studio.inv(), studio.snap())}
>
  <StyleFieldRow label="Name | Subtitle" type="text" value={studio.spk.text} onchange={(v) => ((studio.spk.text = v), studio.inv())} />

  <div class="bar" style="margin-top:6px">
    <button type="button" class="xs pri" onclick={() => avatarIn?.click()}>
      {studio.spk.avatarSrc ? 'Change Portrait' : '＋ Speaker Photo'}
    </button>
    {#if studio.spk.avatarSrc}
      <button type="button" class="xs" onclick={() => ((studio.spk.avatarSrc = ''), studio.inv())}>Remove Photo</button>
    {/if}
  </div>

  <div class="style-control-group-heading">Style & Placement</div>
  <StyleFieldRow label="Banner style" type="select" value={studio.spk.style || 'glass'} options={spkStyles} onchange={(v) => ((studio.spk.style = v), studio.inv())} />
  <StyleFieldRow label="Position" type="select" value={studio.spk.pos || 'underCard'} options={spkPositions} onchange={(v) => ((studio.spk.pos = v), studio.inv())} />
  {#if studio.spk.pos === 'custom'}
    <StyleFieldRow label="Position X" value={studio.spk.x ?? 50} min={5} max={95} unit="%" onchange={(v) => ((studio.spk.x = v), studio.inv())} />
    <StyleFieldRow label="Position Y" value={studio.spk.y ?? 66} min={5} max={95} unit="%" onchange={(v) => ((studio.spk.y = v), studio.inv())} />
  {:else if studio.spk.pos === 'underCard'}
    <StyleFieldRow label="Gap under card" value={studio.spk.gap ?? 95} min={0} max={300} unit="px" onchange={(v) => ((studio.spk.gap = v), studio.inv())} />
  {/if}
  <StyleFieldRow label="Scale" value={studio.spk.scale ?? 100} min={50} max={180} unit="%" onchange={(v) => ((studio.spk.scale = v), studio.inv())} />
  <StyleFieldRow label="Pad X" value={studio.spk.padX ?? 40} min={12} max={100} unit="px" onchange={(v) => ((studio.spk.padX = v), studio.inv())} />
  <StyleFieldRow label="Pad Y" value={studio.spk.padY ?? 16} min={6} max={60} unit="px" onchange={(v) => ((studio.spk.padY = v), studio.inv())} />
  <StyleFieldRow label="Corner radius" value={studio.spk.radius ?? 99} min={0} max={99} unit="px" onchange={(v) => ((studio.spk.radius = v), studio.inv())} />

  <div class="style-control-group-heading">Colors & Typography</div>
  <StyleFieldRow label="Match video theme" type="check" value={studio.spk.useThemeColors !== false} onchange={(v) => ((studio.spk.useThemeColors = v), studio.inv())} />
  {#if studio.spk.useThemeColors === false}
    <StyleFieldRow label="Bg color" type="color" value={studio.spk.bgColor || '#0f1420'} onchange={(v) => ((studio.spk.bgColor = v), studio.inv())} />
    <StyleFieldRow label="Name color" type="color" value={studio.spk.nameColor || '#ffd700'} onchange={(v) => ((studio.spk.nameColor = v), studio.inv())} />
    <StyleFieldRow label="Role color" type="color" value={studio.spk.roleColor || '#e2e8f0'} onchange={(v) => ((studio.spk.roleColor = v), studio.inv())} />
    <StyleFieldRow label="Accent color" type="color" value={studio.spk.accentColor || '#6366f1'} onchange={(v) => ((studio.spk.accentColor = v), studio.inv())} />
  {/if}
  <StyleFieldRow label="Bg opacity" value={studio.spk.bgOpacity ?? 74} min={0} max={100} unit="%" onchange={(v) => ((studio.spk.bgOpacity = v), studio.inv())} />
  <StyleFieldRow label="Border width" value={studio.spk.borderW ?? 2} min={0} max={10} unit="px" onchange={(v) => ((studio.spk.borderW = v), studio.inv())} />
  <StyleFieldRow label="Border color" type="color" value={studio.spk.borderColor || '#ffffff'} onchange={(v) => ((studio.spk.borderColor = v), studio.inv())} />
  <StyleFieldRow label="Name size" value={studio.spk.s1} min={20} max={90} unit="px" onchange={(v) => ((studio.spk.s1 = v), studio.inv())} />
  <StyleFieldRow label="Line 2 size" value={studio.spk.s2} min={14} max={70} unit="px" onchange={(v) => ((studio.spk.s2 = v), studio.inv())} />
  <StyleFieldRow label="Font" type="select" value={studio.spk.font} options={FSEL} onchange={(v) => ((studio.spk.font = v), studio.inv())} />

  {#if studio.spk.avatarSrc}
    <StyleFieldRow label="Photo shape" type="select" value={studio.spk.avatarShape || 'circle'} options={[['circle', 'Circle'], ['rounded', 'Rounded']]} onchange={(v) => ((studio.spk.avatarShape = v), studio.inv())} />
    <StyleFieldRow label="Photo size" value={studio.spk.avatarSize ?? 72} min={36} max={140} unit="px" onchange={(v) => ((studio.spk.avatarSize = v), studio.inv())} />
  {/if}

  <div class="style-control-group-heading">Animation & Indicators</div>
  <StyleFieldRow label="Entrance" type="select" value={typeof studio.spk.intro === 'string' ? studio.spk.intro : studio.spk.intro ? 'slideLeft' : 'none'} options={[['slideLeft', 'Slide from left'], ['slideUp', 'Rise up'], ['fade', 'Fade in'], ['none', 'None']]} onchange={(v) => ((studio.spk.intro = v), studio.inv())} />
  <StyleFieldRow label="Voice wave" type="select" value={typeof studio.spk.wave === 'string' ? studio.spk.wave : studio.spk.wave ? 'bars' : 'none'} options={[['bars', 'Equalizer bars'], ['sine', 'Smooth wave'], ['none', 'Off']]} onchange={(v) => ((studio.spk.wave = v), studio.inv())} />
  <StyleFieldRow label="Progress bar" type="check" value={studio.spk.prog} onchange={(v) => ((studio.spk.prog = v ? 1 : 0), studio.inv())} />
  <StyleFieldRow label="Shadow blur" value={studio.spk.shadow ?? 20} min={0} max={50} unit="px" onchange={(v) => ((studio.spk.shadow = v), studio.inv())} />
</CategoryBlock>

<CategoryBlock
  title="Persistent Heading"
  icon="type"
  open={false}
  toggleChecked={!!studio.hd.on}
  onToggle={(v) => ((studio.hd.on = v ? 1 : 0), studio.inv(), studio.snap())}
>
  <StyleFieldRow label="Heading text" type="text" value={studio.hd.text} onchange={(v) => ((studio.hd.text = v), studio.inv())} />
  <StyleFieldRow label="Avoid face" type="check" value={studio.hd.auto} onchange={(v) => ((studio.hd.auto = v ? 1 : 0), studio.inv())} />
  <StyleFieldRow label="Position X" value={studio.hd.x ?? 50} min={10} max={90} unit="%" onchange={(v) => ((studio.hd.x = v), studio.inv())} />
  <StyleFieldRow label="Position Y" value={studio.hd.y} min={5} max={95} unit="%" onchange={(v) => ((studio.hd.y = v), studio.inv())} />
  <StyleFieldRow label="Main size" value={studio.hd.s1} min={30} max={160} unit="px" onchange={(v) => ((studio.hd.s1 = v), studio.inv())} />
  <StyleFieldRow label="2nd line size" value={studio.hd.s2} min={20} max={120} unit="px" onchange={(v) => ((studio.hd.s2 = v), studio.inv())} />
  <StyleFieldRow label="Font" type="select" value={studio.hd.font} options={FSEL} onchange={(v) => ((studio.hd.font = v), studio.inv())} />
  <StyleFieldRow label="Text color" type="color" value={studio.hd.color || '#ffffff'} onchange={(v) => ((studio.hd.color = v), studio.inv())} />
  <StyleFieldRow label="Outline" value={studio.hd.stroke ?? 4} min={0} max={16} unit="px" onchange={(v) => ((studio.hd.stroke = v), studio.inv())} />
  <StyleFieldRow label="Pill backdrop" type="check" value={!!studio.hd.bgOn} onchange={(v) => ((studio.hd.bgOn = v ? 1 : 0), studio.inv())} />
  {#if studio.hd.bgOn}
    <StyleFieldRow label="Pill color" type="color" value={studio.hd.bgColor || '#090c14'} onchange={(v) => ((studio.hd.bgColor = v), studio.inv())} />
    <StyleFieldRow label="Pill opacity" value={studio.hd.bgOpacity ?? 72} min={0} max={100} unit="%" onchange={(v) => ((studio.hd.bgOpacity = v), studio.inv())} />
  {/if}
  <StyleFieldRow label="Dark scrim" type="check" value={studio.hd.scrim} onchange={(v) => ((studio.hd.scrim = v ? 1 : 0), studio.inv())} />
</CategoryBlock>

<CategoryBlock
  title="Corner Watermark Stamp"
  icon="film"
  open={false}
  toggleChecked={!!studio.wm.on}
  onToggle={(v) => ((studio.wm.on = v ? 1 : 0), studio.inv(), studio.snap())}
>
  <StyleFieldRow label="Text / Handle" type="text" value={studio.wm.text} onchange={(v) => ((studio.wm.text = v), studio.inv())} />
  <StyleFieldRow
    label="Corner / Pos"
    type="select"
    value={studio.wm.pos || 'bottomCenter'}
    options={[
      ['bottomCenter', 'Bottom Center'],
      ['topLeft', 'Top Left'],
      ['topRight', 'Top Right'],
      ['bottomLeft', 'Bottom Left'],
      ['bottomRight', 'Bottom Right'],
      ['custom', 'Custom X / Y'],
    ]}
    onchange={(v) => ((studio.wm.pos = v), studio.inv())}
  />
  {#if studio.wm.pos === 'custom'}
    <StyleFieldRow label="Pos X" value={studio.wm.x ?? 50} min={5} max={95} unit="%" onchange={(v) => ((studio.wm.x = v), studio.inv())} />
    <StyleFieldRow label="Pos Y" value={studio.wm.y ?? 92} min={5} max={95} unit="%" onchange={(v) => ((studio.wm.y = v), studio.inv())} />
  {/if}
  <StyleFieldRow label="Style" type="select" value={studio.wm.style || 'outline'} options={[['outline', 'Outline'], ['pill', 'Solid Pill'], ['clean', 'Clean Text']]} onchange={(v) => ((studio.wm.style = v), studio.inv())} />
  <StyleFieldRow label="Size" value={studio.wm.size} min={18} max={80} unit="px" onchange={(v) => ((studio.wm.size = v), studio.inv())} />
  <StyleFieldRow label="Opacity" value={studio.wm.opacity ?? 92} min={10} max={100} unit="%" onchange={(v) => ((studio.wm.opacity = v), studio.inv())} />
  <StyleFieldRow label="Custom color" type="color" value={studio.wm.color || '#ffffff'} onchange={(v) => ((studio.wm.color = v), studio.inv())} />
  <StyleFieldRow label="Font" type="select" value={studio.wm.font} options={FSEL} onchange={(v) => ((studio.wm.font = v), studio.inv())} />
</CategoryBlock>
