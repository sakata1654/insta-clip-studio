<script>
  import Icon from './Icon.svelte';

  let { active = $bindable('media') } = $props();

  const rails = [
    { id: 'media', label: 'Media', icon: 'media', tip: 'Media files, video transform, canvas & overlays' },
    { id: 'subtitles', label: 'Captions', icon: 'subtitles', tip: 'AI Speech transcription, Qur’an snapping & subtitle slicer' },
    { id: 'look', label: 'Style', icon: 'sparkles', tip: 'Multi-target styling, Quran typography & preset library' },
    { id: 'banners', label: 'Titles', icon: 'type', tip: 'Speaker cards, lower thirds, watermarks & floating text' },
    { id: 'audio', label: 'Audio', icon: 'music', tip: 'Audio enhancement, vocal isolation & background mix' },
    { id: 'ai', label: 'AI Tools', icon: 'sparkles', tip: 'Lecture-to-Reels clip generation & viral hook detector' },
  ];
</script>

<nav class="tool-rail" aria-label="Workspace tool rail">
  <div class="rail-items">
    {#each rails as r}
      <button
        type="button"
        class="rail-btn"
        class:on={active === r.id}
        title={r.tip}
        aria-label={r.label}
        onclick={() => (active = r.id)}
      >
        <span class="rail-ic"><Icon name={r.icon} size={16} /></span>
        <span class="rail-lbl">{r.label}</span>
      </button>
    {/each}
  </div>
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
    padding: 8px 4px;
    user-select: none;
    z-index: 10;
  }

  .rail-items {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
  }

  .rail-btn {
    width: 100%;
    height: 48px;
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-secondary);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    padding: 4px 2px;
    font-size: 10px;
    font-weight: 550;
    transition: all var(--dur-fast) ease;
  }

  .rail-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .rail-btn.on {
    color: var(--accent);
    background: var(--accent-soft);
    border-color: color-mix(in srgb, var(--accent) 30%, transparent);
    font-weight: 600;
  }

  .rail-ic {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .rail-lbl {
    font-size: 9.5px;
    letter-spacing: -0.01em;
    line-height: 1.1;
  }

  @media (max-width: 768px) {
    .tool-rail {
      display: none;
    }
  }
</style>
