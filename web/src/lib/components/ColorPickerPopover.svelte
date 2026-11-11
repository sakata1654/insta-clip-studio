<script>
  import { hsv2rgb, rgb2hsv } from '../renderer.js';
  import { hex2, rgb2hex, studio } from '../state.svelte.js';

  const PAL = ['#ffffff', '#000000', '#ffd400', '#ff3d81', '#ff5a36', '#00ffd0', '#3b82f6', '#8b5cf6', '#22c55e', '#f97316', '#ef4444', '#94a3b8'];

  let svCanvas = $state(null);
  let hu = $state(0);
  let sa = $state(1);
  let va = $state(1);
  let hexInput = $state('#ffffff');
  let dragging = $state(false);
  let recent = $state([]);

  try {
    recent = JSON.parse(localStorage.ics || '[]');
  } catch {}

  $effect(() => {
    if (studio.colorPicker.open && studio.colorPicker.hex) {
      setFromHex(studio.colorPicker.hex, false);
    }
  });

  $effect(() => {
    if (!svCanvas || !studio.colorPicker.open) return;
    const cx = svCanvas.getContext('2d');
    cx.fillStyle = `hsl(${hu}, 100%, 50%)`;
    cx.fillRect(0, 0, 220, 140);
    let g = cx.createLinearGradient(0, 0, 220, 0);
    g.addColorStop(0, '#fff');
    g.addColorStop(1, '#fff0');
    cx.fillStyle = g;
    cx.fillRect(0, 0, 220, 140);
    g = cx.createLinearGradient(0, 0, 0, 140);
    g.addColorStop(0, '#0000');
    g.addColorStop(1, '#000');
    cx.fillStyle = g;
    cx.fillRect(0, 0, 220, 140);
    const x = sa * 220;
    const y = (1 - va) * 140;
    cx.lineWidth = 2;
    cx.strokeStyle = '#fff';
    cx.beginPath();
    cx.arc(x, y, 6, 0, Math.PI * 2);
    cx.stroke();
    cx.lineWidth = 1;
    cx.strokeStyle = '#000';
    cx.beginPath();
    cx.arc(x, y, 7.5, 0, Math.PI * 2);
    cx.stroke();
  });

  function setFromHex(hx, notify = true) {
    const t = rgb2hsv(...hex2(hx));
    if (t[1] > 0) hu = t[0];
    sa = t[1];
    va = t[2];
    const normalized = rgb2hex(...hsv2rgb(hu, sa, va));
    hexInput = normalized;
    if (notify) commitColor(normalized);
  }

  function commitColor(hx) {
    studio.colorPicker.hex = hx;
    if (studio.colorPicker.onChange) studio.colorPicker.onChange(hx);
    studio.inv();
  }

  function updateSv(e) {
    if (!svCanvas) return;
    const r = svCanvas.getBoundingClientRect();
    sa = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    va = 1 - Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const hx = rgb2hex(...hsv2rgb(hu, sa, va));
    hexInput = hx;
    commitColor(hx);
  }

  function closePicker() {
    if (!studio.colorPicker.open) return;
    const hx = studio.colorPicker.hex;
    recent = [hx, ...recent.filter((c) => c !== hx && !PAL.includes(c))].slice(0, 8);
    try {
      localStorage.ics = JSON.stringify(recent);
    } catch {}
    studio.colorPicker.open = false;
  }

  async function pickEyeDropper() {
    if (!window.EyeDropper) return;
    try {
      const res = await new window.EyeDropper().open();
      setFromHex(res.sRGBHex, true);
    } catch {}
  }
</script>

<svelte:window
  onpointerdown={(e) => {
    if (studio.colorPicker.open && !e.target.closest('.pk-popover') && !e.target.closest('.sw')) closePicker();
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape' && studio.colorPicker.open) closePicker();
  }}
/>

{#if studio.colorPicker.open}
  <div
    class="pk-popover"
    style="left:{studio.colorPicker.x}px;top:{studio.colorPicker.y}px"
  >
    <canvas
      bind:this={svCanvas}
      width="220"
      height="140"
      style="width:220px;height:140px;border-radius:8px;cursor:crosshair;touch-action:none;display:block"
      onpointerdown={(e) => {
        dragging = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        updateSv(e);
      }}
      onpointermove={(e) => dragging && updateSv(e)}
      onpointerup={() => (dragging = false)}
    ></canvas>

    <input
      type="range"
      min="0"
      max="359"
      class="hue-slider"
      value={hu}
      oninput={(e) => {
        hu = +e.currentTarget.value;
        const hx = rgb2hex(...hsv2rgb(hu, sa, va));
        hexInput = hx;
        commitColor(hx);
      }}
    />

    <div class="rt">
      <div style="width:26px;height:26px;border-radius:6px;border:1px solid #fff4;background:{hexInput};flex:none"></div>
      <input
        class="mono"
        style="flex:1;min-width:0;padding:4px 7px"
        value={hexInput}
        oninput={(e) => {
          const v = e.currentTarget.value.trim();
          hexInput = v;
          if (/^#?[0-9a-f]{6}$/i.test(v)) setFromHex(v[0] === '#' ? v : '#' + v, true);
        }}
      />
      {#if typeof window !== 'undefined' && 'EyeDropper' in window}
        <button type="button" class="sm" onclick={pickEyeDropper} title="Eyedropper">Pipette</button>
      {/if}
    </div>

    <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:9px">
      {#each [...PAL, ...recent] as h}
        <button
          type="button"
          style="width:20px;height:20px;padding:0;border-radius:5px;border:1px solid #fff3;background:{h}"
          onclick={() => setFromHex(h, true)}
          aria-label={h}
        ></button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .pk-popover {
    position: fixed;
    z-index: 80;
    width: 246px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-strong);
    border-radius: 14px;
    padding: 12px;
    box-shadow: var(--shadow-lg);
  }
  .hue-slider {
    height: 11px;
    margin: 10px 0;
    background: linear-gradient(90deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
  }
</style>
