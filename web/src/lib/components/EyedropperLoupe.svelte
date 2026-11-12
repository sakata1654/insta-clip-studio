<script>
  import { onDestroy, onMount } from 'svelte';
  import { samplePixelAt } from '../colorDropper.js';
  import { studio } from '../state.svelte.js';

  let loupeCanvas = $state(null);
  let curSample = $state(null);

  function handlePointerMove(e) {
    if (!studio.eyeDropper.active) return;
    const sample = samplePixelAt(e.clientX, e.clientY);
    curSample = sample;
    studio.eyeDropper.x = e.clientX;
    studio.eyeDropper.y = e.clientY;
    studio.eyeDropper.hex = sample.hex;
    studio.eyeDropper.rgb = sample.rgba;
    studio.eyeDropper.rgbStr = sample.rgbStr;
    studio.eyeDropper.hsl = sample.hsl;
    studio.eyeDropper.sourceLabel = sample.sourceLabel;
  }

  function handlePointerDown(e) {
    if (!studio.eyeDropper.active) return;
    e.preventDefault();
    e.stopPropagation();
    const sample = samplePixelAt(e.clientX, e.clientY);
    studio.commitEyeDropper(sample);
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape' && studio.eyeDropper.active) {
      e.preventDefault();
      studio.cancelEyeDropper();
    }
  }

  // Draw magnified 11x11 pixel grid on the loupe canvas
  $effect(() => {
    if (!studio.eyeDropper.active || !loupeCanvas) return;
    const ctx = loupeCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, 110, 110);
    ctx.imageSmoothingEnabled = false;

    const patch = curSample?.patch;
    const pW = curSample?.patchWidth || 11;
    const pH = curSample?.patchHeight || 11;

    if (patch) {
      // Draw 11x11 grid where each pixel is 10x10 px
      const offCanvas = document.createElement('canvas');
      offCanvas.width = pW;
      offCanvas.height = pH;
      const offCtx = offCanvas.getContext('2d');
      offCtx.putImageData(patch, 0, 0);

      ctx.drawImage(offCanvas, 0, 0, pW, pH, 0, 0, 110, 110);

      // Draw subtle grid lines
      ctx.lineWidth = 0.5;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      for (let i = 0; i <= 110; i += 10) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 110);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(110, i);
        ctx.stroke();
      }
    } else {
      // If no image patch is available, fill with the sampled solid color
      ctx.fillStyle = curSample?.hex || studio.eyeDropper.hex || '#ffffff';
      ctx.fillRect(0, 0, 110, 110);
    }

    // Draw central target crosshair box around the exact center pixel (index 5, 5 => 50px, 50px)
    const centerX = 50;
    const centerY = 50;
    const size = 10;

    // Outer black stroke
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000000';
    ctx.strokeRect(centerX - 0.5, centerY - 0.5, size + 1, size + 1);

    // Inner bright white stroke
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(centerX + 0.5, centerY + 0.5, size - 1, size - 1);
  });

  const loupePos = $derived.by(() => {
    const x = studio.eyeDropper.x;
    const y = studio.eyeDropper.y;
    const loupeW = 160;
    const loupeH = 210;

    let left = x + 24;
    let top = y - 80;

    if (typeof window !== 'undefined') {
      if (left + loupeW > window.innerWidth - 10) {
        left = x - loupeW - 24;
      }
      if (top < 10) {
        top = y + 24;
      }
      if (top + loupeH > window.innerHeight - 10) {
        top = window.innerHeight - loupeH - 10;
      }
    }

    return { left: Math.max(8, left), top: Math.max(8, top) };
  });
</script>

<svelte:window
  onkeydown={handleKeyDown}
  onpointermove={handlePointerMove}
/>

{#if studio.eyeDropper.active}
  <!-- Full-screen capture overlay with crosshair cursor -->
  <div
    class="eyedropper-overlay"
    onpointerdown={handlePointerDown}
    oncontextmenu={(e) => {
      e.preventDefault();
      studio.cancelEyeDropper();
    }}
    role="dialog"
    aria-label="Color Eyedropper Magnifier"
    tabindex="-1"
  >
    <!-- Floating Magnifier Loupe -->
    <div
      class="loupe-floating"
      style="left: {loupePos.left}px; top: {loupePos.top}px; --active-color: {studio.eyeDropper.hex};"
    >
      <!-- Circular Magnifier Lens -->
      <div class="lens-ring">
        <canvas
          bind:this={loupeCanvas}
          width="110"
          height="110"
          class="lens-canvas"
        ></canvas>
        <div class="lens-crosshair" aria-hidden="true"></div>
      </div>

      <!-- Color Specs Card -->
      <div class="loupe-card">
        <div class="color-preview-row">
          <div
            class="color-chip"
            style="background: {studio.eyeDropper.hex};"
          ></div>
          <div class="color-hex mono">{studio.eyeDropper.hex.toUpperCase()}</div>
        </div>

        <div class="spec-row">
          <span class="spec-label">RGB</span>
          <span class="spec-val mono">
            {studio.eyeDropper.rgb[0]}, {studio.eyeDropper.rgb[1]}, {studio.eyeDropper.rgb[2]}
          </span>
        </div>

        <div class="spec-row">
          <span class="spec-label">HSL</span>
          <span class="spec-val mono">
            {studio.eyeDropper.hsl[0]}°, {studio.eyeDropper.hsl[1]}%, {studio.eyeDropper.hsl[2]}%
          </span>
        </div>

        <div class="source-tag">
          <span class="badge mono">{studio.eyeDropper.sourceLabel || 'Screen'}</span>
        </div>

        <div class="loupe-hint">
          Click to pick · Esc to cancel
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .eyedropper-overlay {
    position: fixed;
    inset: 0;
    z-index: 99999;
    cursor: crosshair;
    user-select: none;
    -webkit-user-select: none;
    background: transparent;
  }

  .loupe-floating {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    pointer-events: none;
    filter: drop-shadow(0 14px 30px rgba(0, 0, 0, 0.65));
    transition: transform 0.04s ease-out;
  }

  .lens-ring {
    width: 116px;
    height: 116px;
    border-radius: 50%;
    border: 3.5px solid var(--active-color, #ffffff);
    box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.8), inset 0 0 10px rgba(0, 0, 0, 0.5);
    background: #000000;
    overflow: hidden;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .lens-canvas {
    width: 110px;
    height: 110px;
    border-radius: 50%;
    display: block;
    image-rendering: pixelated;
  }

  .lens-crosshair {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      radial-gradient(circle at center, transparent 4px, rgba(0, 0, 0, 0.1) 5px, transparent 6px);
  }

  .loupe-card {
    background: rgba(15, 23, 42, 0.94);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 12px;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 154px;
  }

  .color-preview-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  }

  .color-chip {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.35);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
    flex-shrink: 0;
  }

  .color-hex {
    font-size: 13px;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: 0.5px;
  }

  .spec-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    gap: 6px;
  }

  .spec-label {
    color: rgba(255, 255, 255, 0.55);
    font-weight: 600;
    font-size: 10px;
  }

  .spec-val {
    color: rgba(255, 255, 255, 0.9);
    font-size: 10.5px;
  }

  .source-tag {
    display: flex;
    justify-content: center;
    margin-top: 2px;
  }

  .source-tag .badge {
    font-size: 9.5px;
    padding: 1px 6px;
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.8);
    border-radius: 4px;
  }

  .loupe-hint {
    font-size: 9.5px;
    color: rgba(255, 255, 255, 0.5);
    text-align: center;
    margin-top: 2px;
  }
</style>
