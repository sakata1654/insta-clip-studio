<script>
  import Icon from './Icon.svelte';

  let { active = $bindable('media') } = $props();

  const rails = [
    { id: 'media', label: 'Media', icon: 'media', tip: 'Import video, download URL, project assets & overlays' },
    { id: 'subtitles', label: 'Subtitles', icon: 'subtitles', tip: 'Generate, edit, style & translate subtitles' },
    { id: 'banners', label: 'Titles', icon: 'type', tip: 'Floating text, speaker badge, watermark & news ticker' },
    { id: 'look', label: 'Canvas', icon: 'layout', tip: 'Aspect ratio, studio framing, color grade & camera cuts' },
    { id: 'audio', label: 'Audio', icon: 'music', tip: 'Audio mastering, vocal separation & background music mix' },
    { id: 'ai', label: 'AI Tools', icon: 'sparkles', tip: 'AI Lecture-to-Reels, smart segmentation & editorial coach' },
  ];
</script>

<nav class="tool-rail" aria-label="Workspace sections">
  <div class="rail-caption">TOOLS</div>
  {#each rails as r}
    <button
      type="button"
      class="rail-btn"
      class:on={active === r.id}
      title={r.tip}
      onclick={() => (active = r.id)}
    >
      <span class="rail-ic"><Icon name={r.icon} size={15} /></span>
      <span class="rail-lbl">{r.label}</span>
    </button>
  {/each}
</nav>

<style>
  .tool-rail {
    grid-area: r;
    width: 136px;
    background: var(--bg-rail);
    border-right: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    padding: 10px 8px;
    gap: 4px;
    overflow-y: auto;
  }

  .rail-caption {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    padding: 2px 8px 6px;
  }

  .rail-btn {
    width: 100%;
    height: 38px;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 9px;
    padding: 0 9px;
    position: relative;
    font-size: 12px;
    font-weight: 550;
  }

  .rail-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .rail-btn.on {
    color: var(--accent);
    background: var(--accent-soft);
    border-color: color-mix(in srgb, var(--accent) 26%, transparent);
    font-weight: 620;
  }

  .rail-btn.on::before {
    content: '';
    position: absolute;
    left: -8px;
    top: 8px;
    bottom: 8px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--accent);
  }

  .rail-ic {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .rail-lbl {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
