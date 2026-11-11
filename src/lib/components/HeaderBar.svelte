<script>
  import { exportAll, saveBlob } from '../renderer.js';
  import { studio } from '../state.svelte.js';
  import { isDevPreviewBridge } from '../tauriBridge.js';
  import Icon from './Icon.svelte';

  let { onOpenProjects = () => {}, onOpenSettings = () => {} } = $props();
  const isDev = isDevPreviewBridge();
  let jobsOpen = $state(false);
  const runningJobs = $derived(studio.exportJobs.filter((j) => !j.done));
  const latestJob = $derived(runningJobs[0] || studio.exportJobs[0] || null);

  const missingReq = $derived(
    studio.env
      ? [!studio.env.yt_dlp?.ok, !studio.env.ffmpeg?.ok].filter(Boolean).length
      : 0
  );

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

<header class="top-bar">
  <div class="bar-left">
    <button
      type="button"
      class="sm ghost"
      onclick={() => (studio.homeOpen = true)}
      title="Back to Project Homepage"
    >
      <Icon name="home" size={14} />
      <span>Home</span>
    </button>

    <div class="brand">
      <div class="logo-mark">
        <img src="/app-icon.png" alt="Tibyan Studio" class="brand-pfp" />
      </div>
      <span class="app-title">Tibyan Studio</span>
      {#if isDev}
        <span class="env-pill">Preview</span>
      {/if}
    </div>

    <span class="v-div"></span>

    <input
      class="proj-pill"
      bind:value={studio.projectName}
      placeholder="Untitled Project"
      aria-label="Project name"
    />
    <span class="save-state" class:unsaved={studio.unsaved} title={studio.unsaved ? 'Unsaved changes (Ctrl+S)' : 'Saved to library'}>
      <i class="sdot"></i>
      <span>{studio.unsaved ? 'Unsaved' : 'Saved'}</span>
    </span>
    <button type="button" class="sm ghost" onclick={onOpenProjects} title="Browse & Manage Projects">
      <Icon name="folder" size={14} />
      <span>Projects</span>
    </button>
  </div>

  <div class="bar-center">
    <div class="mode-toggle" role="tablist" aria-label="Workspace view">
      <button type="button" class:on={studio.nav !== 'tr'} onclick={() => (studio.nav = 'ed')}>
        <Icon name="sliders" size={12} />
        <span>Timeline Editor</span>
      </button>
      <button type="button" class:on={studio.nav === 'tr'} onclick={() => (studio.nav = 'tr')}>
        <Icon name="languages" size={12} />
        <span>Translation Desk</span>
      </button>
    </div>
  </div>

  <div class="bar-right">
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

    <button type="button" class="sm ghost" onclick={exportProjectJson} title="Export portable .icproj.json">
      <span>.JSON</span>
    </button>

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
            <span>Rendering {latestJob?.pct ?? 0}%</span>
          {:else}
            <Icon name="check" size={12} />
            <span>Exports ({studio.exportJobs.length})</span>
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
                <div class="rt" style="justify-content:space-between">
                  <span class="hint" style="margin:0;font-size:10.5px">{j.label}</span>
                  {#if !j.done && j.cancel}
                    <button type="button" class="xs danger" onclick={() => j.cancel()}>Cancel</button>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <button type="button" class="sm pri" onclick={() => exportAll()} title="Start background MP4 export">
      <Icon name="upload" size={13} />
      <span>Export MP4</span>
    </button>
  </div>
</header>

<style>
  .top-bar {
    grid-area: h;
    height: 46px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 0 12px;
    background: var(--bg-titlebar);
    border-bottom: 1px solid var(--border-color);
    z-index: 20;
    min-width: 0;
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
    background: #474b33;
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
    width: 150px;
    font-size: 12.2px;
    font-weight: 600;
    border-radius: var(--radius-sm);
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
    grid-template-columns: 1fr 1fr;
    gap: 2px;
    background: var(--bg-input);
    padding: 2px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
  }
  .mode-toggle button {
    border: 0;
    background: transparent;
    padding: 4px 11px;
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
    width: 310px;
    max-height: 380px;
    overflow-y: auto;
    background: var(--bg-secondary);
    border: 1px solid var(--border-mid);
    border-radius: var(--radius-lg);
    padding: 12px;
    box-shadow: var(--shadow-lg);
    z-index: 60;
  }

  @media (max-width: 1080px) {
    .proj-pill {
      width: 110px;
    }
    .env-pill {
      display: none;
    }
  }
</style>
