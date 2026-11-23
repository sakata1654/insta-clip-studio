<script>
  import { exportAll, saveBlob } from '../renderer.js';
  import { studio } from '../state.svelte.js';
  import Icon from './Icon.svelte';

  let { onOpenProjects = () => {}, onOpenSettings = () => {} } = $props();
  let jobsOpen = $state(false);
  const runningJobs = $derived(studio.exportJobs.filter((j) => !j.done));
  const latestJob = $derived(runningJobs[0] || studio.exportJobs[0] || null);

  const missingReq = $derived(
    studio.env
      ? [!studio.env.yt_dlp?.ok, !studio.env.ffmpeg?.ok].filter(Boolean).length
      : 0
  );

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.icsTheme = next;
    } catch {}
  }

  function saveToLibrary() {
    studio.saveProjectStore();
  }
</script>

<header class="top-bar">
  <!-- Left: Branding & Project Meta -->
  <div class="bar-left">
    <button
      type="button"
      class="sm ghost nav-home-btn"
      onclick={() => (studio.homeOpen = true)}
      title="Back to Projects Dashboard"
    >
      <Icon name="home" size={14} />
      <span class="btn-lbl">Dashboard</span>
    </button>

    <div class="brand">
      <div class="logo-mark">
        <img src="/app-icon.png" alt="Tibyan Studio" class="brand-pfp" />
      </div>
      <span class="app-title">Tibyan</span>
    </div>

    <span class="v-div"></span>

    <div class="proj-name-wrap">
      <input
        class="proj-pill"
        bind:value={studio.projectName}
        placeholder="Untitled Project"
        aria-label="Project name"
      />
      <span
        class="save-state"
        class:unsaved={studio.unsaved}
        title={studio.unsaved ? 'Unsaved changes (Ctrl+S)' : 'All changes saved to library'}
      >
        <i class="sdot"></i>
        <span>{studio.unsaved ? 'Unsaved' : 'Saved'}</span>
      </span>
    </div>

    <button
      type="button"
      class="sm ghost"
      onclick={onOpenProjects}
      title="Browse & Manage Saved Projects"
    >
      <Icon name="folder" size={13} />
      <span class="btn-lbl">Projects</span>
    </button>
  </div>

  <!-- Center: 5-Stage Production Workflow (Inspired by Minbar & Quran Caption) -->
  <nav class="workflow-nav" aria-label="Production stages">
    <button
      type="button"
      class="wf-step"
      class:active={studio.nav === 'ed' && (studio.leftTab === 'media' || studio.leftTab === 'banners' || studio.leftTab === 'audio')}
      onclick={() => { studio.nav = 'ed'; studio.leftTab = 'media'; }}
      title="Step 1: Video & Audio Media Assets"
    >
      <span class="wf-num">1</span>
      <span class="wf-lbl">Media</span>
    </button>

    <button
      type="button"
      class="wf-step"
      class:active={studio.nav === 'ed' && studio.leftTab === 'subtitles'}
      onclick={() => { studio.nav = 'ed'; studio.leftTab = 'subtitles'; }}
      title="Step 2: AI Speech Transcription & Qur'an Snapping"
    >
      <span class="wf-num">2</span>
      <span class="wf-lbl">Transcription</span>
      {#if studio.subs.length}
        <span class="wf-badge">{studio.subs.length}</span>
      {/if}
    </button>

    <button
      type="button"
      class="wf-step"
      class:active={studio.nav === 'tr'}
      onclick={() => (studio.nav = 'tr')}
      title="Step 3: Translation Desk & 21 House Rules Review"
    >
      <span class="wf-num">3</span>
      <span class="wf-lbl">Translations</span>
      {#if (studio.compareFlags && studio.compareFlags.length) || (studio.quranFlags && studio.quranFlags.length)}
        <span class="wf-flag-dot" title="Review items waiting"></span>
      {/if}
    </button>

    <button
      type="button"
      class="wf-step"
      class:active={studio.nav === 'ed' && studio.leftTab === 'look'}
      onclick={() => { studio.nav = 'ed'; studio.leftTab = 'look'; }}
      title="Step 4: Multi-Target Styling & Presets"
    >
      <span class="wf-num">4</span>
      <span class="wf-lbl">Style</span>
    </button>

    <button
      type="button"
      class="wf-step"
      class:active={studio.exportModalOpen}
      onclick={() => (studio.exportModalOpen = true)}
      title="Step 5: Render Video & Social Captions"
    >
      <span class="wf-num">5</span>
      <span class="wf-lbl">Export</span>
    </button>
  </nav>

  <!-- Right: Utilities, Undo/Redo, Settings & Primary Export -->
  <div class="bar-right">
    <div class="hist-group">
      <button
        type="button"
        class="sm ghost icon-btn"
        disabled={studio.histIdx <= 0}
        onclick={() => studio.goHist(-1)}
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
      >
        <Icon name="undo" size={13} />
      </button>
      <button
        type="button"
        class="sm ghost icon-btn"
        disabled={studio.histIdx >= studio.histLen - 1}
        onclick={() => studio.goHist(1)}
        title="Redo (Ctrl+Shift+Z)"
        aria-label="Redo"
      >
        <Icon name="redo" size={13} />
      </button>
    </div>

    <span class="v-div"></span>

    <button
      type="button"
      class="sm ghost icon-btn"
      onclick={toggleTheme}
      title="Toggle Light / Dark Theme"
      aria-label="Toggle Theme"
    >
      <Icon name="sun" size={14} />
    </button>

    <button
      type="button"
      class="sm ghost icon-btn"
      onclick={onOpenSettings}
      title="Settings, AI Keys & Shortcuts"
      aria-label="Studio Settings"
    >
      <Icon name="settings" size={14} />
      <span class="status-dot" style="background:{missingReq ? 'var(--accent-amber)' : 'var(--accent-green)'}"></span>
    </button>

    <button type="button" class="sm" onclick={saveToLibrary} title="Save Project (Ctrl+S)">
      <Icon name="save" size={13} />
      <span class="btn-lbl">Save</span>
    </button>

    {#if studio.exportJobs.length}
      <div class="jobs-wrap">
        <button
          type="button"
          class="sm jobs-pill"
          class:active={runningJobs.length > 0}
          onclick={() => (jobsOpen = !jobsOpen)}
          title="Background exports queue"
        >
          {#if runningJobs.length}
            <span class="pulse-dot"></span>
            <span>{latestJob?.pct ?? 0}%</span>
          {:else}
            <Icon name="check" size={12} />
            <span>Exports</span>
          {/if}
        </button>

        {#if jobsOpen}
          <div class="jobs-popover">
            <div class="rt" style="justify-content:space-between;margin-bottom:8px">
              <b style="font-size:12px">Background Exports</b>
              {#if studio.exportJobs.some((j) => j.done)}
                <button type="button" class="xs ghost" onclick={() => studio.clearFinishedJobs()}>Clear</button>
              {/if}
            </div>
            {#each studio.exportJobs as j (j.id)}
              <div class="sub-card" style="margin:6px 0;padding:8px">
                <div class="rt" style="justify-content:space-between;gap:6px">
                  <b style="font-size:11.8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{j.name}</b>
                  <span class="badge" class:ok={j.done && !j.error} class:err={j.error} class:pri={!j.done}>
                    {j.done ? (j.error ? 'Failed' : 'Completed') : `${j.pct ?? 0}%`}
                  </span>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <button
      type="button"
      class="sm pri export-action-btn"
      onclick={() => (studio.exportModalOpen = true)}
      title="Export Video (MP4 / WebM)"
    >
      <Icon name="upload" size={13} />
      <span>Export</span>
    </button>
  </div>
</header>

<style>
  .top-bar {
    grid-area: h;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 14px;
    background: var(--bg-titlebar);
    border-bottom: 1px solid var(--border-color);
    z-index: 25;
    min-width: 0;
  }

  .bar-left,
  .bar-right {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex-shrink: 0;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 7px;
    padding-left: 2px;
  }

  .logo-mark {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-sm);
    background: #1e3a2b;
    overflow: hidden;
    display: grid;
    place-items: center;
    color: #ffffff;
    flex-shrink: 0;
  }
  .brand-pfp {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .app-title {
    font-weight: 700;
    font-size: 13.5px;
    letter-spacing: -0.02em;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .v-div {
    width: 1px;
    height: 16px;
    background: var(--border-color);
    margin: 0 2px;
    flex-shrink: 0;
  }

  .proj-name-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    padding: 2px 6px;
  }

  .proj-pill {
    background: transparent;
    border: none;
    padding: 2px 4px;
    width: 130px;
    font-size: 12px;
    font-weight: 550;
    color: var(--text-primary);
  }
  .proj-pill:focus {
    box-shadow: none;
  }

  .save-state {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10.5px;
    color: var(--text-thirdly);
    padding: 1px 5px;
    border-radius: 99px;
  }
  .sdot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent-green);
  }
  .save-state.unsaved .sdot {
    background: var(--accent-amber);
  }

  /* ─── 5-Step Workflow Nav ────────────────────────────────────────── */
  .workflow-nav {
    display: flex;
    align-items: center;
    gap: 3px;
    background: var(--bg-input);
    padding: 3px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
  }

  .wf-step {
    border: 1px solid transparent;
    background: transparent;
    padding: 5px 12px;
    border-radius: var(--radius-sm);
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 550;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: all var(--dur-fast) ease;
  }

  .wf-step:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .wf-step.active {
    background: var(--bg-elevated);
    color: var(--text-primary);
    border-color: var(--border-mid);
    font-weight: 600;
    box-shadow: var(--shadow-sm);
  }

  .wf-num {
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--bg-hover);
    color: var(--text-thirdly);
    font-size: 10px;
    font-weight: 650;
  }
  .wf-step.active .wf-num {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .wf-badge {
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 10px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 99px;
  }

  .wf-flag-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-amber);
  }

  .hist-group {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .icon-btn {
    padding: 5px 7px;
  }

  .status-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .jobs-wrap {
    position: relative;
  }
  .jobs-pill {
    font-size: 11.5px;
    padding: 4px 9px;
  }
  .jobs-pill.active {
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .pulse-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }
  .jobs-popover {
    position: absolute;
    right: 0;
    top: calc(100% + 8px);
    width: 290px;
    max-height: 360px;
    overflow-y: auto;
    background: var(--bg-secondary);
    border: 1px solid var(--border-mid);
    border-radius: var(--radius-lg);
    padding: 12px;
    box-shadow: var(--shadow-lg);
    z-index: 60;
  }

  @media (max-width: 1024px) {
    .proj-pill { width: 90px; }
    .btn-lbl { display: none; }
    .wf-step { padding: 4px 8px; }
  }

  @media (max-width: 768px) {
    .brand, .proj-name-wrap, .hist-group { display: none; }
    .wf-lbl { display: none; }
    .wf-step { padding: 5px 8px; }
  }
</style>
