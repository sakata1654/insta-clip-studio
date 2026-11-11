<script>
  import { onMount } from 'svelte';
  import { openVideoFile } from './lib/mediaHelpers.js';
  import { studio } from './lib/state.svelte.js';

  import ColorPickerPopover from './lib/components/ColorPickerPopover.svelte';
  import HeaderBar from './lib/components/HeaderBar.svelte';
  import PreviewStage from './lib/components/PreviewStage.svelte';
  import TimelineDock from './lib/components/TimelineDock.svelte';
  import ToolRail from './lib/components/ToolRail.svelte';

  import ProjectsDrawerModal from './lib/components/modals/ProjectsDrawerModal.svelte';
  import SettingsModal from './lib/components/modals/SettingsModal.svelte';
  import TranslateView from './lib/components/views/TranslateView.svelte';

  import CanvasWorkflow from './lib/components/workflows/CanvasWorkflow.svelte';
  import CaptionsWorkflow from './lib/components/workflows/CaptionsWorkflow.svelte';
  import ExportWorkflow from './lib/components/workflows/ExportWorkflow.svelte';
  import MediaWorkflow from './lib/components/workflows/MediaWorkflow.svelte';
  import StyleWorkflow from './lib/components/workflows/StyleWorkflow.svelte';
  import StudioPresetsPanel from './lib/components/panels/StudioPresetsPanel.svelte';

  let videoEl = $state(null);
  let audioEl = $state(null);
  let stageRef = $state(null);
  let dragHover = $state(false);

  let workflow = $state('captions'); // 'media' | 'captions' | 'style' | 'canvas' | 'export'
  let projectsOpen = $state(false);
  let settingsOpen = $state(false);

  $effect(() => {
    if (studio.nav === 'su') {
      workflow = studio.sideTab === 'sty' ? 'style' : 'captions';
      studio.nav = 'ed';
    }
  });

  const workflowTitles = {
    media: 'Media & Assets',
    captions: 'Subtitles & AI',
    style: 'Typography & Dual Style',
    canvas: 'Format & Banners',
    presets: 'Studio Presets (.JSON)',
    export: 'Export & Audio',
  };

  onMount(() => {
    studio.homeOpen = false;
    studio.nav = 'ed';
    studio.V = videoEl;
    studio.A = audioEl;
    studio.snap();

    const saveIv = setInterval(() => {
      if (studio.activeProjectId) studio.saveProjectStore({ quiet: true, bundle: false });
    }, 5000);
    return () => clearInterval(saveIv);
  });

  function onWindowKeydown(e) {
    if (/INPUT|TEXTAREA|SELECT/.test(e.target?.tagName) || e.target?.isContentEditable) return;
    if (studio.shortcutMatch(e, 'undo')) {
      e.preventDefault();
      studio.goHist(-1);
    } else if (studio.shortcutMatch(e, 'redo')) {
      e.preventDefault();
      studio.goHist(1);
    } else if (studio.shortcutMatch(e, 'play')) {
      e.preventDefault();
      stageRef?.togglePlay();
    } else if (studio.shortcutMatch(e, 'save')) {
      e.preventDefault();
      studio.saveProjectStore();
    } else if (studio.shortcutMatch(e, 'previous')) {
      e.preventDefault();
      studio.seek(studio.currentPlayhead() - (e.shiftKey ? 1 : 0.1));
    } else if (studio.shortcutMatch(e, 'next')) {
      e.preventDefault();
      studio.seek(studio.currentPlayhead() + (e.shiftKey ? 1 : 0.1));
    }
  }
</script>

<svelte:window
  onkeydown={onWindowKeydown}
  ondragover={(e) => {
    e.preventDefault();
    dragHover = true;
  }}
  ondragleave={(e) => {
    if (!e.relatedTarget) dragHover = false;
  }}
  ondrop={(e) => {
    e.preventDefault();
    dragHover = false;
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type.startsWith('video')) openVideoFile(f);
  }}
/>

<div class="nle-shell">
  <HeaderBar
    onOpenProjects={() => (projectsOpen = true)}
    onOpenSettings={() => (settingsOpen = true)}
  />

  {#if studio.nav === 'tr'}
    <TranslateView />
  {:else}
    <ToolRail bind:active={workflow} />

    <aside class="inspector-drawer">
      <div class="drawer-hdr">
        <h3>{workflowTitles[workflow]}</h3>
        {#if workflow === 'style'}
          <span class="badge pri">{studio.aspect}</span>
        {:else if workflow === 'captions' && studio.subs.length}
          <span class="badge mono">{studio.subs.length} cues</span>
        {/if}
      </div>

      <div class="drawer-body">
        {#if workflow === 'media'}
          <MediaWorkflow />
        {:else if workflow === 'captions'}
          <CaptionsWorkflow />
        {:else if workflow === 'style'}
          <StyleWorkflow />
        {:else if workflow === 'canvas'}
          <CanvasWorkflow />
        {:else if workflow === 'presets'}
          <StudioPresetsPanel />
        {:else}
          <ExportWorkflow />
        {/if}
      </div>
    </aside>

    <PreviewStage
      bind:this={stageRef}
      onOpenProjects={() => (projectsOpen = true)}
      onSelectWorkflow={(w) => (workflow = w)}
    />

    <TimelineDock />
  {/if}
</div>

<video bind:this={videoEl} playsinline crossorigin="anonymous" hidden onseeked={() => studio.inv()}></video>
<audio bind:this={audioEl} preload="auto" crossorigin="anonymous" hidden ontimeupdate={() => studio.inv()}></audio>

<ProjectsDrawerModal bind:open={projectsOpen} />
<SettingsModal bind:open={settingsOpen} />
<ColorPickerPopover />

{#if dragHover}
  <div class="drop-overlay">Drop video file to open in Studio</div>
{/if}

{#if studio.toastMsg}
  <div class="toast-pill">{studio.toastMsg}</div>
{/if}

<style>
  .nle-shell {
    display: grid;
    grid-template-columns: 64px 352px 1fr;
    grid-template-rows: 48px 1fr 220px;
    grid-template-areas:
      'h h h'
      'r s m'
      'r s t';
    height: 100vh;
    width: 100vw;
    overflow: hidden;
  }

  /* ── Inspector Drawer ── */
  .inspector-drawer {
    grid-area: s;
    background: var(--bg-rail);
    border-right: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .drawer-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 11px 14px 10px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
    flex-shrink: 0;
  }
  .drawer-hdr h3 {
    margin: 0;
    font-size: 12.5px;
    font-weight: 750;
    letter-spacing: -0.015em;
    color: var(--text-primary);
  }

  .drawer-body {
    flex: 1;
    overflow-y: auto;
    padding: 11px 11px;
    scrollbar-width: thin;
  }

  /* ── Drop overlay ── */
  .drop-overlay {
    position: fixed;
    inset: 14px;
    display: grid;
    place-items: center;
    background: rgba(7, 9, 13, 0.88);
    backdrop-filter: blur(14px);
    font-size: 18px;
    font-weight: 700;
    z-index: 90;
    border: 2px dashed var(--accent-primary);
    border-radius: var(--radius-xl);
    color: var(--text-primary);
    letter-spacing: -0.015em;
  }

  /* ── Toast ── */
  .toast-pill {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-elevated);
    border: 1px solid var(--border-mid);
    padding: 9px 20px;
    border-radius: 99px;
    z-index: 95;
    box-shadow: var(--shadow-md), 0 0 0 1px rgba(255,255,255,0.055);
    font-weight: 600;
    font-size: 12.5px;
    letter-spacing: -0.01em;
    white-space: nowrap;
    animation: toast-in 220ms var(--ease-out);
  }
  @keyframes toast-in {
    from { opacity: 0; transform: translateX(-50%) translateY(10px) scale(0.94); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0)    scale(1); }
  }
</style>
