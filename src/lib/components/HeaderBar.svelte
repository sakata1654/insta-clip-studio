<script>
  import { openVideoFile } from '../mediaHelpers.js';
  import { exportAll, saveBlob } from '../renderer.js';
  import { studio } from '../state.svelte.js';
  import { isDevPreviewBridge } from '../tauriBridge.js';
  import Icon from './Icon.svelte';

  let { onOpenProjects = () => {}, onOpenSettings = () => {} } = $props();
  const isDev = isDevPreviewBridge();
  let vidInput = $state(null);

  const missingReq = $derived(
    studio.env
      ? [!studio.env.yt_dlp?.ok, !studio.env.ffmpeg?.ok].filter(Boolean).length
      : 0
  );

  function saveToLibrary() {
    studio.saveProjectStore();
  }

  function exportProjectJsonFile() {
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
    studio.toast('Exported project file (.icproj.json)');
  }
</script>

<input
  bind:this={vidInput}
  type="file"
  accept="video/*,audio/*"
  hidden
  onchange={(e) => {
    const f = e.currentTarget.files?.[0];
    if (f) openVideoFile(f);
    e.currentTarget.value = '';
  }}
/>

<header class="top-bar">
  <div class="bar-left">
    <div class="logo-mark">
      <Icon name="film" size={14} />
    </div>
    <span class="app-title">InstaClip Studio</span>
    {#if isDev}
      <span class="live-pill">PREVIEW</span>
    {/if}
    <span class="v-div"></span>
    <input
      class="proj-pill"
      bind:value={studio.projectName}
      placeholder="Untitled Project"
      aria-label="Project name"
    />
    <span class="save-state" class:unsaved={studio.unsaved} title={studio.unsaved ? 'Unsaved edits' : 'Saved locally'}>
      <i class="sdot"></i>{studio.unsaved ? 'Unsaved' : 'Saved'}
    </span>
    <button type="button" class="sm ghost" onclick={onOpenProjects} title="Open Projects Library">
      <Icon name="folder" size={13} /> Projects
    </button>
  </div>

  <div class="bar-center">
    <div class="mode-toggle">
      <button type="button" class:on={studio.nav !== 'tr'} onclick={() => (studio.nav = 'ed')}>
        Workspace
      </button>
      <button type="button" class:on={studio.nav === 'tr'} onclick={() => (studio.nav = 'tr')}>
        Translate
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
    >
      <Icon name="undo" size={14} />
    </button>
    <button
      type="button"
      class="sm ghost icon-btn"
      disabled={studio.histIdx >= studio.histLen - 1}
      onclick={() => studio.goHist(1)}
      title="Redo (Ctrl+Shift+Z)"
    >
      <Icon name="redo" size={14} />
    </button>
    <div class="v-div"></div>
    <button
      type="button"
      class="sm ghost icon-btn"
      onclick={() => studio.applyUiTheme(studio.uiTheme === 'minbar' ? 'studio' : 'minbar')}
      title="Switch color palette"
    >
      <Icon name="palette" size={14} />
    </button>
    <button type="button" class="sm ghost icon-btn" onclick={onOpenSettings} title="Tools, API Keys & Setup">
      <Icon name="settings" size={14} />
      <span class="status-dot" style="background:{missingReq ? '#f59e0b' : '#22c55e'}"></span>
    </button>
    <div class="v-div"></div>
    <button type="button" class="sm ghost" onclick={saveToLibrary} title="Save to Projects Library (Ctrl+S)">
      Save
    </button>
    <button type="button" class="sm ghost" onclick={exportProjectJsonFile} title="Export portable .icproj.json">
      .JSON
    </button>
    <button type="button" class="sm pri" disabled={studio.exporting} onclick={() => exportAll()}>
      <Icon name="upload" size={13} /> Export MP4
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
    gap: 10px;
    padding: 0 14px;
    background: var(--bg-titlebar);
    border-bottom: 1px solid var(--border-color);
    z-index: 20;
  }

  .bar-left,
  .bar-right {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }

  .logo-mark {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: var(--grad-accent);
    display: grid;
    place-items: center;
    color: #fff;
    flex-shrink: 0;
  }

  .app-title {
    font-weight: 700;
    font-size: 13.5px;
    letter-spacing: -0.025em;
    white-space: nowrap;
  }

  .live-pill {
    font-size: 9.5px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 99px;
    background: rgba(34, 197, 94, 0.12);
    color: #4ade80;
    border: 1px solid rgba(34, 197, 94, 0.3);
    letter-spacing: 0.04em;
  }

  .v-div {
    width: 1px;
    height: 18px;
    background: var(--border-mid);
    margin: 0 3px;
    flex-shrink: 0;
  }

  .proj-pill {
    background: transparent;
    border-color: transparent;
    padding: 4px 9px;
    width: 150px;
    font-size: 12.2px;
    font-weight: 600;
    border-radius: var(--radius-sm);
  }
  .proj-pill:hover,
  .proj-pill:focus {
    border-color: var(--border-mid);
    background: var(--bg-elevated);
  }

  .save-state {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--text-thirdly);
    padding: 2px 7px;
    border-radius: 99px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border-color);
  }
  .sdot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #22c55e;
  }
  .save-state.unsaved .sdot {
    background: #f59e0b;
  }

  .mode-toggle {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
    background: var(--bg-primary);
    padding: 3px;
    border-radius: var(--radius-md);
    border: 1px solid var(--border-color);
  }
  .mode-toggle button {
    border: 0;
    background: transparent;
    padding: 4px 14px;
    border-radius: 6px;
    color: var(--text-thirdly);
    font-size: 11.4px;
    font-weight: 600;
  }
  .mode-toggle button:hover {
    color: var(--text-primary);
    background: rgba(255, 255, 255, 0.05);
  }
  .mode-toggle button.on {
    background: var(--accent-primary-soft);
    color: #fff;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-primary) 50%, transparent);
  }

  .icon-btn {
    padding: 5px 8px;
  }

  .status-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
  }
</style>
