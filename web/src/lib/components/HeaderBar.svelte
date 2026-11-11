<script>
  import { pickAndOpenVideo } from '../mediaHelpers.js';
  import { exportAll, saveBlob, shareBlob } from '../renderer.js';
  import { studio } from '../state.svelte.js';
  import { viewport } from '../webPlatform/viewport.svelte.js';
  import Icon from './Icon.svelte';

  let { onOpenProjects = () => {}, onOpenSettings = () => {} } = $props();
  let jobsOpen = $state(false);
  let mobileMenuOpen = $state(false);
  const runningJobs = $derived(studio.exportJobs.filter((j) => !j.done));
  const latestJob = $derived(runningJobs[0] || studio.exportJobs[0] || null);
  const missingReq = $derived(studio.mediaStatus === 'missing' ? 1 : 0);

  function saveToLibrary() {
    studio.saveProjectStore();
  }

  function exportProjectJson() {
    studio.saveProjectStore({ quiet: true });
    saveBlob(
      new Blob(
        [
          JSON.stringify(
            {
              schema: 'insta-clip-studio-project',
              version: 2,
              projectName: studio.projectName || 'Untitled Project',
              savedAt: new Date().toISOString(),
              state: studio.projJson(),
            },
            null,
            2
          ),
        ],
        { type: 'application/json' }
      ),
      ((studio.projectName || 'project').replace(/[^a-z0-9-_]+/gi, '_')) + '.icproj.json'
    );
    studio.toast('Exported portable project (.icproj.json)');
  }
</script>

<header class="top-bar" class:compact={viewport.isCompact}>
  <div class="bar-left">
    <button
      type="button"
      class="sm ghost"
      onclick={() => (studio.homeOpen = true)}
      title="Back to Project Homepage"
      aria-label="Home"
    >
      <Icon name="home" size={14} />
      {#if !viewport.isMobile}<span>Home</span>{/if}
    </button>

    {#if !viewport.isMobile}
      <div class="brand">
        <div class="logo-mark">
          <Icon name="film" size={13} />
        </div>
        <span class="app-title">InstaClip Studio</span>
        <span class="env-pill">Web</span>
      </div>
      <span class="v-div"></span>
    {/if}

    {#if studio.mediaStatus === 'missing' || studio.mediaStatus === 'permission-needed'}
      <button type="button" class="sm pri" onclick={() => pickAndOpenVideo()} title="Relink missing local video file for this project">
        <Icon name="upload" size={12} />
        <span>Relink</span>
      </button>
    {/if}

    <input
      class="proj-pill"
      bind:value={studio.projectName}
      placeholder="Untitled"
      aria-label="Project name"
    />

    {#if !viewport.isMobile}
      <span class="save-state" class:unsaved={studio.unsaved} title={studio.unsaved ? 'Unsaved changes (Ctrl+S)' : 'Saved to library'}>
        <i class="sdot"></i>
        <span>{studio.unsaved ? 'Unsaved' : 'Saved'}</span>
      </span>
      <button type="button" class="sm ghost" onclick={onOpenProjects} title="Browse & Manage Projects">
        <Icon name="folder" size={14} />
        <span>Projects</span>
      </button>
    {/if}
  </div>

  {#if !viewport.isMobile}
    <div class="bar-center">
      <div class="mode-toggle" role="tablist" aria-label="Workspace view">
        <button type="button" class:on={studio.nav !== 'tr' && studio.nav !== 'ai'} onclick={() => (studio.nav = 'ed')}>
          <Icon name="sliders" size={12} />
          <span>{viewport.isTablet ? 'Editor' : 'Timeline Editor'}</span>
        </button>
        <button type="button" class:on={studio.nav === 'tr'} onclick={() => (studio.nav = 'tr')}>
          <Icon name="languages" size={12} />
          <span>{viewport.isTablet ? 'Translate' : 'Translation Desk'}</span>
        </button>
        <button type="button" class:on={studio.nav === 'ai'} onclick={() => (studio.nav = 'ai')}>
          <Icon name="sparkles" size={12} />
          <span>AI Clips</span>
        </button>
      </div>
    </div>
  {/if}

  <div class="bar-right">
    {#if viewport.isTablet && studio.nav === 'ed'}
      <button
        type="button"
        class="sm"
        class:pri={studio.tabletToolsOpen}
        onclick={() => {
          studio.tabletToolsOpen = !studio.tabletToolsOpen;
          if (viewport.tier === 'tablet-portrait' && studio.tabletToolsOpen) studio.tabletInspectorOpen = false;
        }}
        title="Toggle editing tools panel"
      >
        <Icon name="layers" size={13} />
        <span>Tools</span>
      </button>
      <button
        type="button"
        class="sm"
        class:pri={studio.tabletInspectorOpen}
        onclick={() => {
          studio.tabletInspectorOpen = !studio.tabletInspectorOpen;
          if (viewport.tier === 'tablet-portrait' && studio.tabletInspectorOpen) studio.tabletToolsOpen = false;
        }}
        title="Toggle properties inspector"
      >
        <Icon name="sliders" size={13} />
        <span>Inspect</span>
      </button>
    {/if}

    <button
      type="button"
      class="sm ghost icon-btn"
      disabled={studio.histIdx <= 0}
      onclick={() => studio.goHist(-1)}
      title="Undo (Ctrl+Z)"
      aria-label="Undo"
    >
      <Icon name="undo" size={14} />
    </button>
    <button
      type="button"
      class="sm ghost icon-btn"
      disabled={studio.histIdx >= studio.histLen - 1}
      onclick={() => studio.goHist(1)}
      title="Redo (Ctrl+Shift+Z)"
      aria-label="Redo"
    >
      <Icon name="redo" size={14} />
    </button>

    {#if !viewport.isMobile}
      <span class="v-div"></span>
      <button
        type="button"
        class="sm ghost icon-btn"
        onclick={() => studio.applyUiTheme(studio.uiTheme === 'light' ? 'dark' : 'light')}
        title={studio.uiTheme === 'light' ? 'Switch to Dark Graphite theme' : 'Switch to Clean Light theme'}
        aria-label="Toggle color theme"
      >
        <Icon name={studio.uiTheme === 'light' ? 'moon' : 'sun'} size={14} />
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

      <span class="v-div"></span>

      <button type="button" class="sm" onclick={saveToLibrary} title="Save Project (Ctrl+S)">
        <Icon name="save" size={13} />
        <span>Save</span>
      </button>

      {#if !viewport.isTablet}
        <button type="button" class="sm ghost" onclick={exportProjectJson} title="Export portable .icproj.json">
          <span>.JSON</span>
        </button>
      {/if}
    {/if}

    {#if studio.exportJobs.length}
      <div class="jobs-wrap">
        <button
          type="button"
          class="sm jobs-pill"
          class:active={runningJobs.length > 0}
          onclick={() => (jobsOpen = !jobsOpen)}
          title="Background exports"
        >
          {#if runningJobs.length}
            <span class="pulse-dot"></span>
            <span>{latestJob?.pct ?? 0}%</span>
          {:else}
            <Icon name="check" size={12} />
            <span>{studio.exportJobs.length}</span>
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
                    {j.done ? (j.error ? 'Failed' : 'Saved') : `${j.pct}%`}
                  </span>
                </div>
                <div class="pbar" style="margin:5px 0"><i style="width:{j.pct}%"></i></div>
                <div class="rt" style="justify-content:space-between;gap:6px">
                  <span class="hint" style="margin:0;font-size:10.5px">{j.label}</span>
                  {#if !j.done && j.cancel}
                    <button type="button" class="xs danger" onclick={() => j.cancel()}>Cancel</button>
                  {:else if j.done && !j.error && j.downloadUrl}
                    <div class="rt" style="gap:4px">
                      {#if j.shareable && j.blob}
                        <button type="button" class="xs" onclick={() => shareBlob(j.blob, j.filename || 'export.mp4')}>Share</button>
                      {/if}
                      <a class="btn xs pri" href={j.downloadUrl} download={j.filename || 'export.mp4'}>Save</a>
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if viewport.isMobile}
      <div class="jobs-wrap">
        <button
          type="button"
          class="sm ghost icon-btn"
          onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
          aria-label="Workspace menu"
        >
          <Icon name="menu" size={15} />
        </button>
        {#if mobileMenuOpen}
          <div class="jobs-popover mobile-menu" role="menu">
            <button type="button" class="sm" style="width:100%;justify-content:flex-start" onclick={() => { studio.nav = 'ed'; mobileMenuOpen = false; }}>
              <Icon name="sliders" size={14} /> Timeline Editor
            </button>
            <button type="button" class="sm" style="width:100%;justify-content:flex-start" onclick={() => { studio.nav = 'tr'; mobileMenuOpen = false; }}>
              <Icon name="languages" size={14} /> Translation Desk
            </button>
            <button type="button" class="sm" style="width:100%;justify-content:flex-start" onclick={() => { studio.nav = 'ai'; mobileMenuOpen = false; }}>
              <Icon name="sparkles" size={14} /> AI Smart Clips
            </button>
            <hr style="border:0;border-top:1px solid var(--border-color);width:100%;margin:4px 0" />
            <button type="button" class="sm" style="width:100%;justify-content:flex-start" onclick={() => { saveToLibrary(); mobileMenuOpen = false; }}>
              <Icon name="save" size={14} /> Save Project
            </button>
            <button type="button" class="sm" style="width:100%;justify-content:flex-start" onclick={() => { exportProjectJson(); mobileMenuOpen = false; }}>
              <Icon name="download" size={14} /> Export .JSON
            </button>
            <button type="button" class="sm" style="width:100%;justify-content:flex-start" onclick={() => { onOpenProjects(); mobileMenuOpen = false; }}>
              <Icon name="folder" size={14} /> Projects Library
            </button>
            <button type="button" class="sm" style="width:100%;justify-content:flex-start" onclick={() => { studio.applyUiTheme(studio.uiTheme === 'light' ? 'dark' : 'light'); mobileMenuOpen = false; }}>
              <Icon name={studio.uiTheme === 'light' ? 'moon' : 'sun'} size={14} /> Theme: {studio.uiTheme === 'light' ? 'Dark' : 'Light'}
            </button>
            <button type="button" class="sm" style="width:100%;justify-content:flex-start" onclick={() => { onOpenSettings(); mobileMenuOpen = false; }}>
              <Icon name="settings" size={14} /> Settings &amp; Capabilities
            </button>
          </div>
        {/if}
      </div>
    {/if}

    <button type="button" class="sm pri" onclick={() => exportAll()} title="Start background MP4 export">
      <Icon name="upload" size={13} />
      <span>{viewport.isMobile ? 'Export' : 'Export MP4'}</span>
    </button>
  </div>
</header>

<style>
  .top-bar {
    grid-area: h;
    height: calc(46px + var(--sat));
    padding: var(--sat) calc(12px + var(--sar)) 0 calc(12px + var(--sal));
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    background: var(--bg-titlebar);
    border-bottom: 1px solid var(--border-color);
    z-index: 30;
    min-width: 0;
  }
  .top-bar.compact {
    padding: var(--sat) calc(8px + var(--sar)) 0 calc(8px + var(--sal));
    gap: 4px;
  }

  .bar-left,
  .bar-right {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
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
    background: var(--accent);
    display: grid;
    place-items: center;
    color: #ffffff;
    flex-shrink: 0;
  }

  .app-title {
    font-weight: 650;
    font-size: 13px;
    letter-spacing: -0.02em;
    white-space: nowrap;
  }

  .env-pill {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 99px;
    background: var(--accent-soft);
    color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
  }

  .v-div {
    width: 1px;
    height: 16px;
    background: var(--border-color);
    margin: 0 3px;
    flex-shrink: 0;
  }

  .proj-pill {
    background: transparent;
    border-color: transparent;
    padding: 4px 8px;
    width: 145px;
    min-width: 72px;
    font-size: 12.2px;
    font-weight: 600;
    border-radius: var(--radius-sm);
  }
  .top-bar.compact .proj-pill {
    width: auto;
    max-width: 120px;
    flex: 1;
    padding: 4px 6px;
  }
  .proj-pill:hover,
  .proj-pill:focus {
    border-color: var(--border-mid);
    background: var(--bg-input);
  }

  .save-state {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--text-thirdly);
    padding: 2px 8px;
    border-radius: 99px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
  }
  .sdot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-green);
  }
  .save-state.unsaved .sdot {
    background: var(--accent-amber);
  }

  .mode-toggle {
    display: grid;
    grid-template-columns: repeat(3, auto);
    gap: 2px;
    background: var(--bg-input);
    padding: 2px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
  }
  .mode-toggle button {
    border: 0;
    background: transparent;
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    color: var(--text-thirdly);
    font-size: 11.5px;
    font-weight: 560;
  }
  .mode-toggle button:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .mode-toggle button.on {
    background: var(--bg-elevated);
    color: var(--text-primary);
    box-shadow: var(--shadow-sm);
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
    width: 7px;
    height: 7px;
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
    width: min(310px, calc(100vw - 24px));
    max-height: 380px;
    overflow-y: auto;
    background: var(--bg-secondary);
    border: 1px solid var(--border-mid);
    border-radius: var(--radius-lg);
    padding: 12px;
    box-shadow: var(--shadow-lg);
    z-index: 60;
  }
  .mobile-menu {
    width: 220px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
  }

  @media (max-width: 1180px) {
    .proj-pill {
      width: 104px;
    }
    .save-state {
      display: none;
    }
  }
</style>
