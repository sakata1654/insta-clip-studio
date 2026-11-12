/**
 * Universal Color Dropper & Pixel Sampling Engine
 *
 * Provides accurate, cross-platform pixel color sampling from:
 * 1. The active Video Preview Canvas (accounting for devicePixelRatio, scaling, letterboxing, zoom)
 * 2. Visual HTML elements (<img>, <canvas>, <video>, DOM computed styles)
 * 3. Native browser EyeDropper API fallback where supported
 */

import { studio } from './state.svelte.js';

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function rgbToHex(r, g, b) {
  const h = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToRgb(hex) {
  const clean = String(hex || '').replace(/^#/, '');
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16) || 0;
    const g = parseInt(clean[1] + clean[1], 16) || 0;
    const b = parseInt(clean[2] + clean[2], 16) || 0;
    return [r, g, b, 255];
  }
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  const a = clean.length >= 8 ? parseInt(clean.slice(6, 8), 16) || 255 : 255;
  return [r, g, b, a];
}

export function rgbToHsl(r, g, b) {
  const rN = clamp(r, 0, 255) / 255;
  const gN = clamp(g, 0, 255) / 255;
  const bN = clamp(b, 0, 255) / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rN: h = (gN - bN) / d + (gN < bN ? 6 : 0); break;
      case gN: h = (bN - rN) / d + 2; break;
      case bN: h = (rN - gN) / d + 4; break;
    }
    h /= 6;
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

export function parseCssColor(cssStr) {
  if (!cssStr || cssStr === 'transparent' || cssStr === 'rgba(0, 0, 0, 0)') {
    return null;
  }
  const matchRgba = cssStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i);
  if (matchRgba) {
    const r = parseInt(matchRgba[1], 10);
    const g = parseInt(matchRgba[2], 10);
    const b = parseInt(matchRgba[3], 10);
    const a = matchRgba[4] !== undefined ? Math.round(parseFloat(matchRgba[4]) * 255) : 255;
    return [r, g, b, a];
  }
  if (cssStr.startsWith('#')) {
    return hexToRgb(cssStr);
  }
  return null;
}

/**
 * Samples a color and an 11x11 pixel patch at screen coordinates (clientX, clientY).
 * Prioritizes the main preview canvas `studio.C`, then inspects underlying DOM elements.
 */
export function samplePixelAt(clientX, clientY) {
  // 1. Check if hovering over the main video preview canvas
  if (studio.C && studio.C.isConnected) {
    const r = studio.C.getBoundingClientRect();
    if (
      clientX >= r.left &&
      clientX <= r.right &&
      clientY >= r.top &&
      clientY <= r.bottom &&
      r.width > 0 &&
      r.height > 0
    ) {
      const scaleX = studio.C.width / r.width;
      const scaleY = studio.C.height / r.height;
      const px = Math.floor((clientX - r.left) * scaleX);
      const py = Math.floor((clientY - r.top) * scaleY);
      const cx = clamp(px, 0, studio.C.width - 1);
      const cy = clamp(py, 0, studio.C.height - 1);

      try {
        const ctx = studio.C.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          const centerData = ctx.getImageData(cx, cy, 1, 1).data;
          const [red, green, blue, alpha] = centerData;

          // Extract an 11x11 patch around the sampled pixel for magnification
          const half = 5;
          const sx = clamp(cx - half, 0, studio.C.width - 1);
          const sy = clamp(cy - half, 0, studio.C.height - 1);
          const sw = Math.min(11, studio.C.width - sx);
          const sh = Math.min(11, studio.C.height - sy);
          const patchData = ctx.getImageData(sx, sy, sw, sh);

          return {
            source: 'video_preview',
            sourceLabel: 'Video Preview',
            x: clientX,
            y: clientY,
            canvasX: cx,
            canvasY: cy,
            rgba: [red, green, blue, alpha],
            hex: rgbToHex(red, green, blue),
            rgbStr: `rgb(${red}, ${green}, ${blue})`,
            hsl: rgbToHsl(red, green, blue),
            patch: patchData,
            patchWidth: sw,
            patchHeight: sh,
            patchOffsetX: cx - sx,
            patchOffsetY: cy - sy,
          };
        }
      } catch (e) {
        console.warn('Canvas pixel read failed:', e);
      }
    }
  }

  // 2. Check underlying DOM elements (images, other canvases, colored UI elements)
  try {
    const elements = document.elementsFromPoint(clientX, clientY) || [];
    // Ignore eyedropper UI overlays
    const targetEl = elements.find((el) => !el.closest('.eyedropper-overlay') && !el.closest('.pk-popover'));

    if (targetEl) {
      // 2a. Target is another canvas
      if (targetEl instanceof HTMLCanvasElement && targetEl.width > 0 && targetEl.height > 0) {
        const r = targetEl.getBoundingClientRect();
        const px = clamp(Math.floor(((clientX - r.left) / r.width) * targetEl.width), 0, targetEl.width - 1);
        const py = clamp(Math.floor(((clientY - r.top) / r.height) * targetEl.height), 0, targetEl.height - 1);
        const ctx = targetEl.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          const [red, green, blue, alpha] = ctx.getImageData(px, py, 1, 1).data;
          return {
            source: 'canvas',
            sourceLabel: 'Canvas Layer',
            x: clientX,
            y: clientY,
            rgba: [red, green, blue, alpha],
            hex: rgbToHex(red, green, blue),
            rgbStr: `rgb(${red}, ${green}, ${blue})`,
            hsl: rgbToHsl(red, green, blue),
            patch: null,
          };
        }
      }

      // 2b. Target is an image
      if (targetEl instanceof HTMLImageElement && targetEl.naturalWidth > 0 && targetEl.naturalHeight > 0) {
        const r = targetEl.getBoundingClientRect();
        const relX = clamp((clientX - r.left) / r.width, 0, 1);
        const relY = clamp((clientY - r.top) / r.height, 0, 1);
        const natX = Math.floor(relX * targetEl.naturalWidth);
        const natY = Math.floor(relY * targetEl.naturalHeight);

        const off = document.createElement('canvas');
        off.width = 1;
        off.height = 1;
        const octx = off.getContext('2d');
        if (octx) {
          octx.drawImage(targetEl, -natX, -natY);
          const [red, green, blue, alpha] = octx.getImageData(0, 0, 1, 1).data;
          return {
            source: 'image',
            sourceLabel: 'Image Graphic',
            x: clientX,
            y: clientY,
            rgba: [red, green, blue, alpha],
            hex: rgbToHex(red, green, blue),
            rgbStr: `rgb(${red}, ${green}, ${blue})`,
            hsl: rgbToHsl(red, green, blue),
            patch: null,
          };
        }
      }

      // 2c. Target has a computed background or text color
      const cs = window.getComputedStyle(targetEl);
      const bgRgba = parseCssColor(cs.backgroundColor);
      const fgRgba = parseCssColor(cs.color);
      const chosenRgba = bgRgba && bgRgba[3] > 10 ? bgRgba : fgRgba || [255, 255, 255, 255];
      const [red, green, blue, alpha] = chosenRgba;

      return {
        source: 'element',
        sourceLabel: targetEl.tagName.toLowerCase(),
        x: clientX,
        y: clientY,
        rgba: [red, green, blue, alpha],
        hex: rgbToHex(red, green, blue),
        rgbStr: `rgb(${red}, ${green}, ${blue})`,
        hsl: rgbToHsl(red, green, blue),
        patch: null,
      };
    }
  } catch (err) {
    console.warn('DOM element color sample error:', err);
  }

  // Fallback default
  return {
    source: 'unknown',
    sourceLabel: 'Screen',
    x: clientX,
    y: clientY,
    rgba: [255, 255, 255, 255],
    hex: '#ffffff',
    rgbStr: 'rgb(255, 255, 255)',
    hsl: [0, 0, 100],
    patch: null,
  };
}

/**
 * Checks whether the browser's native EyeDropper API is available and functional.
 */
export function isNativeEyeDropperSupported() {
  return typeof window !== 'undefined' && 'EyeDropper' in window;
}

/**
 * Attempts to sample using native browser EyeDropper API.
 * Gracefully returns null if unsupported, rejected, or cancelled.
 */
export async function tryNativeEyeDropper() {
  if (!isNativeEyeDropperSupported()) return null;
  try {
    const dropper = new window.EyeDropper();
    const result = await dropper.open();
    if (result && result.sRGBHex) {
      const hex = result.sRGBHex.toLowerCase();
      const [r, g, b] = hexToRgb(hex);
      return {
        hex,
        rgbStr: `rgb(${r}, ${g}, ${b})`,
        hsl: rgbToHsl(r, g, b),
      };
    }
  } catch (err) {
    // AbortError or NotAllowedError when user cancels or permissions are restricted
    console.info('Native EyeDropper closed or unavailable:', err?.message || err);
  }
  return null;
}
