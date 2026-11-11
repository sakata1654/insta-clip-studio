<script>
  import Icon from './Icon.svelte';

  let { active = $bindable('captions') } = $props();

  const rails = [
    { id: 'media', label: 'Media', icon: 'media', tip: 'Upload, URL Download, Assets & B-Roll' },
    { id: 'captions', label: 'Captions', icon: 'subtitles', tip: 'Transcribe, Edit, AI Split & Translate' },
    { id: 'style', label: 'Style', icon: 'type', tip: 'Typography, Dual Subtitles & Quick Look' },
    { id: 'canvas', label: 'Canvas', icon: 'layout', tip: 'Format, Frame, News & Speaker Banners' },
    { id: 'presets', label: 'Presets', icon: 'palette', tip: 'Save & Transfer Full Studio JSON Presets' },
    { id: 'export', label: 'Export', icon: 'upload', tip: 'Trim Range, Audio Enhance & MP4 Export' },
  ];
</script>

<nav class="tool-rail" aria-label="Studio workflow tools">
  {#each rails as r}
    <button
      type="button"
      class="rail-btn"
      class:on={active === r.id}
      title={r.tip}
      onclick={() => (active = r.id)}
    >
      <span class="rail-ic"><Icon name={r.icon} size={17} /></span>
      <span class="rail-lbl">{r.label}</span>
    </button>
  {/each}
</nav>

<style>
  .tool-rail {
    grid-area: r;
    width: 64px;
    background: var(--bg-rail);
    border-right: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 10px 5px;
    gap: 4px;
  }

  .rail-btn {
    width: 54px;
    height: 52px;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-thirdly);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 4px 2px;
    position: relative;
  }

  .rail-btn:hover {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.045);
  }

  .rail-btn.on {
    color: #fff;
    background: var(--accent-primary-soft);
    border-color: color-mix(in srgb, var(--accent-primary) 42%, transparent);
  }

  .rail-btn.on::after {
    content: '';
    position: absolute;
    left: -5px;
    top: 12px;
    bottom: 12px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--accent-primary);
  }

  .rail-ic {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 20px;
  }

  .rail-lbl {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.01em;
  }
</style>
