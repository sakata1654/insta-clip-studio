<script>
  import { studio } from '../state.svelte.js';

  let {
    label = '',
    type = 'range', // 'range' | 'check' | 'select' | 'color' | 'text'
    value,
    min = 0,
    max = 100,
    step = 1,
    options = [],
    unit = '',
    onchange = () => {},
  } = $props();

  const cid = $props.id();

  function openColor(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    studio.colorPicker = {
      open: true,
      x: Math.max(8, Math.min(rect.left, window.innerWidth - 260)),
      y: rect.bottom + 280 > window.innerHeight ? Math.max(8, rect.top - 270) : rect.bottom + 6,
      hex: String(value || '#ffffff'),
      onChange: (hx) => onchange(hx),
    };
  }
</script>

<div class="prop-row">
  <label for={cid}>{label}</label>
  {#if type === 'check'}
    <input
      id={cid}
      type="checkbox"
      checked={!!value}
      onchange={(e) => onchange(e.currentTarget.checked)}
    />
    <span></span>
  {:else if type === 'select'}
    <select
      id={cid}
      value={String(value ?? '')}
      onchange={(e) => onchange(e.currentTarget.value)}
    >
      {#each options as opt}
        {@const val = Array.isArray(opt) ? opt[0] : opt}
        {@const txt = Array.isArray(opt) ? opt[1] : opt}
        <option value={String(val)}>{txt}</option>
      {/each}
    </select>
    <span></span>
  {:else if type === 'color'}
    <button
      id={cid}
      type="button"
      class="sw"
      style="background:{value || '#ffffff'}"
      onclick={openColor}
      aria-label={label}
    ></button>
    <span class="val-pill mono">{value || ''}</span>
  {:else if type === 'text'}
    <input
      id={cid}
      type="text"
      value={value ?? ''}
      oninput={(e) => onchange(e.currentTarget.value)}
    />
    <span></span>
  {:else}
    <input
      id={cid}
      type="range"
      {min}
      {max}
      {step}
      value={Number(value ?? 0)}
      oninput={(e) => onchange(+e.currentTarget.value)}
    />
    <span class="val-pill mono">{value}{unit}</span>
  {/if}
</div>
