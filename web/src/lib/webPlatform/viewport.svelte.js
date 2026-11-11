/**
 * Adaptive Viewport, Orientation, Input Modality & Mobile Share Controller
 * Uses live dimensions + media queries (never brittle user-agent device blacklists).
 * Separates device capabilities cleanly so future Capacitor/native wrappers can swap adapters.
 */

class ViewportState {
  width = $state(typeof window !== 'undefined' ? window.innerWidth : 1280);
  height = $state(typeof window !== 'undefined' ? window.innerHeight : 800);
  visualHeight = $state(typeof window !== 'undefined' ? (window.visualViewport?.height || window.innerHeight) : 800);
  isCoarse = $state(false);
  hasHover = $state(true);
  reducedMotion = $state(false);
  deviceMemory = $state(8);

  orientation = $derived(this.width >= this.height ? 'landscape' : 'portrait');
  keyboardOpen = $derived(this.height - this.visualHeight > 140);

  /**
   * 6 logical size/capability classes mapped to optimized layout shells:
   * - 'desktop'          >= 1180px (or non-coarse >= 1024px)
   * - 'small-desktop'    1024px..1179px
   * - 'tablet-landscape' 768px..1023px landscape
   * - 'tablet-portrait'  600px..1023px portrait
   * - 'large-mobile'     400px..599px (or coarse < 768px portrait)
   * - 'small-mobile'     < 400px
   */
  tier = $derived.by(() => {
    const w = this.width;
    if (w >= 1180) return 'desktop';
    if (w >= 1024) return 'small-desktop';
    if (w >= 768 && this.orientation === 'landscape') return 'tablet-landscape';
    if (w >= 600) return 'tablet-portrait';
    if (w >= 400) return 'large-mobile';
    return 'small-mobile';
  });

  isMobile = $derived(this.tier === 'large-mobile' || this.tier === 'small-mobile');
  isTablet = $derived(this.tier === 'tablet-portrait' || this.tier === 'tablet-landscape');
  isDesktop = $derived(this.tier === 'desktop' || this.tier === 'small-desktop');
  isCompact = $derived(this.isMobile || this.tier === 'tablet-portrait');

  constructor() {
    if (typeof window === 'undefined') return;
    const coarseMq = window.matchMedia?.('(pointer: coarse)');
    const hoverMq = window.matchMedia?.('(hover: hover)');
    const motionMq = window.matchMedia?.('(prefers-reduced-motion: reduce)');

    const sync = () => {
      this.width = window.innerWidth;
      this.height = window.innerHeight;
      this.visualHeight = window.visualViewport?.height || window.innerHeight;
      this.isCoarse = !!coarseMq?.matches;
      this.hasHover = hoverMq ? hoverMq.matches : true;
      this.reducedMotion = !!motionMq?.matches;
      this.deviceMemory = Number(navigator?.deviceMemory) || 8;
    };
    sync();

    window.addEventListener('resize', sync, { passive: true });
    window.addEventListener('orientationchange', sync, { passive: true });
    window.visualViewport?.addEventListener('resize', sync, { passive: true });
    coarseMq?.addEventListener?.('change', sync);
    hoverMq?.addEventListener?.('change', sync);
    motionMq?.addEventListener?.('change', sync);
  }
}

export const viewport = new ViewportState();

export function canShareMediaFile(blob, filename = 'export.mp4') {
  try {
    if (typeof navigator === 'undefined' || !navigator.share || !navigator.canShare || !blob) return false;
    const f = new File([blob], filename, { type: blob.type || 'video/mp4' });
    return navigator.canShare({ files: [f] });
  } catch {
    return false;
  }
}
