<script>
  import { onMount } from 'svelte';
  import { openVideoFile } from './lib/mediaHelpers.js';
  import { studio } from './lib/state.svelte.js';

  import ColorPickerPopover from './lib/components/ColorPickerPopover.svelte';
  import EyedropperLoupe from './lib/components/EyedropperLoupe.svelte';
  import HeaderBar from './lib/components/HeaderBar.svelte';
  import InspectorPanel from './lib/components/InspectorPanel.svelte';
  import PreviewStage from './lib/components/PreviewStage.svelte';
  import TimelineDock from './lib/components/TimelineDock.svelte';
  import ToolRail from './lib/components/ToolRail.svelte';

  import ConfirmModal from './lib/components/modals/ConfirmModal.svelte';
  import ExportModal from './lib/components/modals/ExportModal.svelte';
  import ProjectsDrawerModal from './lib/components/modals/ProjectsDrawerModal.svelte';
  import SettingsModal from './lib/components/modals/SettingsModal.svelte';

  import ProjectHome from './lib/components/views/ProjectHome.svelte';
  import TranslateView from './lib/components/views/TranslateView.svelte';
  import AiClipsView from './lib/components/views/AiClipsView.svelte';

  import AiToolsWorkflow from './lib/components/workflows/AiToolsWorkflow.svelte';
  import AudioWorkflow from './lib/components/workflows/AudioWorkflow.svelte';
  import BannersWorkflow from './lib/components/workflows/BannersWorkflow.svelte';
  import CaptionsWorkflow from './lib/components/workflows/CaptionsWorkflow.svelte';
  import LookWorkflow from './lib/components/workflows/LookWorkflow.svelte';
  import MediaWorkflow from './lib/components/workflows/MediaWorkflow.svelte';

  let videoEl = $state(null);
  let audioEl = $state(null);
  let stageRef = $state(null);
  let dragHover = $state(false);

  let projectsOpen = $state(false);
  let settingsOpen = $state(false);

  // Resizable panel dimensions (persisted smoothly in localStorage)
  let leftWidth = $state(Number(typeof localStorage !== 'undefined' ? localStorage.icsLeftW : 0) || 308);
  let rightWidth = $state(Number(typeof localStorage !== 'undefined' ? localStorage.icsRightW : 0) || 320);
  let timelineHeight = $state(Number(typeof localStorage !== 'undefined' ? localStorage.icsTlH : 0) || 216);
  let resizeDrag = $state(null);

  $effect(() => {
    if (studio.nav === 'su') {
      studio.leftTab = studio.sideTab === 'sty' ? 'look' : 'subtitles';
      studio.nav = 'ed';
    }
  });

  const leftTitles = {
    media: 'Media & Overlays',
    subtitles: 'Subtitles',
    banners: 'Titles & Banners',
    look: 'Canvas & Color',
    audio: 'Audio & Mix',
    ai: 'AI Tools',
  };

  onMount(() => {
    studio.nav = 'ed';
    studio.V = videoEl;
    studio.A = audioEl;
    studio.snap();

    const saveIv = setInterval(() => {
      if (studio.activeProjectId && studio.unsaved) studio.saveProjectStore({ quiet: true, bundle: false });
    }, 8000);
    return () => clearInterval(saveIv);
  });

  function startResize(kind, e) {
    e.preventDefault();
    resizeDrag = {
      kind,
      x0: e.clientX,
      y0: e.clientY,
      w0: kind === 'left' ? leftWidth : rightWidth,
      h0: timelineHeight,
    };
  }

  function onWindowPointerMove(e) {
    if (!resizeDrag) return;
    if (resizeDrag.kind === 'left') {
      leftWidth = Math.max(250, Math.min(440, resizeDrag.w0 + (e.clientX - resizeDrag.x0)));
    } else if (resizeDrag.kind === 'right') {
      rightWidth = Math.max(260, Math.min(460, resizeDrag.w0 - (e.clientX - resizeDrag.x0)));
    } else if (resizeDrag.kind === 'timeline') {
      timelineHeight = Math.max(150, Math.min(360, resizeDrag.h0 - (e.clientY - resizeDrag.y0)));
    }
  }

  function onWindowPointerUp() {
    if (!resizeDrag) return;
    try {
      localStorage.icsLeftW = String(Math.round(leftWidth));
      localStorage.icsRightW = String(Math.round(rightWidth));
      localStorage.icsTlH = String(Math.round(timelineHeight));
    } catch {}
    resizeDrag = null;
    stageRef?.syncCanvasSize();
  }

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
    } else if (studio.shortcutMatch(e, 'split')) {
      e.preventDefault();
      studio.splitSelectedAtPlayhead();
    } else if (e.key === 'Delete' || e.key === 'Backspace' || studio.shortcutMatch(e, 'delete')) {
      if (studio.sel || studio.selectedOverlayId) {
        e.preventDefault();
        studio.deleteSelectedBlock();
      }
    } else if (studio.shortcutMatch(e, 'save')) {
      e.preventDefault();
      studio.saveProjectStore();
    } else if (studio.shortcutMatch(e, 'previous')) {
      e.preventDefault();
      studio.stepFrame(-1);
    } else if (studio.shortcutMatch(e, 'next')) {
      e.preventDefault();
      studio.stepFrame(1);
    }
  }

  function routeWorkflow(target) {
    const map = {
      media: 'media',
      captions: 'subtitles',
      style: 'look',
      canvas: 'look',
      presets: 'look',
      banners: 'banners',
      export: 'export',
    };
    studio.leftTab = map[target] || target;
  }
</script>

<svelte:window
  onkeydown={onWindowKeydown}
  onpointermove={onWindowPointerMove}
  onpointerup={onWindowPointerUp}
  ondragover={(e) => {
    e.preventDefault();
    dragHover = true;
  }}
  ondragleave={(e) => {
    if (!e.relatedTarget) dragHover = false;
  }}
  ondrop={async (e) => {
    e.preventDefault();
    dragHover = false;
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type.startsWith('video')) {
      await openVideoFile(f);
      studio.homeOpen = false;
    }
  }}
/>

<div
  class="nle-shell"
  style="--left-w:{leftWidth}px;--right-w:{rightWidth}px;--tl-h:{timelineHeight}px"
>
  <HeaderBar
    onOpenProjects={() => (projectsOpen = true)}
    onOpenSettings={() => (settingsOpen = true)}
  />

  {#if studio.nav === 'tr'}
    <TranslateView />
  {:else if studio.nav === 'ai'}
    <AiClipsView />
  {:else}
    <ToolRail bind:active={studio.leftTab} />

    <aside class="left-drawer" aria-label="Tool library panel">
      <div class="drawer-hdr">
        <h3>{leftTitles[studio.leftTab] || 'Media & Overlays'}</h3>
        {#if studio.leftTab === 'subtitles' && studio.subs.length}
          <span class="badge mono">{studio.subs.length} cues</span>
        {:else if studio.leftTab === 'media' && studio.mediaOverlays.length}
          <span class="badge pri mono">{studio.mediaOverlays.length} overlays</span>
        {/if}
      </div>

      <div class="drawer-body">
        {#if studio.leftTab === 'subtitles'}
          <CaptionsWorkflow />
        {:else if studio.leftTab === 'banners'}
          <BannersWorkflow />
        {:else if studio.leftTab === 'look'}
          <LookWorkflow />
        {:else if studio.leftTab === 'audio'}
          <AudioWorkflow />
        {:else if studio.leftTab === 'ai'}
          <AiToolsWorkflow />
        {:else}
          <MediaWorkflow />
        {/if}
      </div>

      <!-- Left Panel Width Resize Handle -->
      <div
        class="resize-v left-handle"
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize sidebar"
        onpointerdown={(e) => startResize('left', e)}
      ></div>
    </aside>

    <PreviewStage
      bind:this={stageRef}
      onOpenProjects={() => (projectsOpen = true)}
      onSelectWorkflow={routeWorkflow}
    />

    <div class="right-wrap">
      <div
        class="resize-v right-handle"
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize inspector"
        onpointerdown={(e) => startResize('right', e)}
      ></div>
      <InspectorPanel />
    </div>

    <div class="tl-wrap">
      <div
        class="resize-h"
        role="separator"
        aria-orientation="horizontal"
        title="Drag to resize timeline height"
        onpointerdown={(e) => startResize('timeline', e)}
      ></div>
      <TimelineDock />
    </div>
  {/if}
</div>

<video bind:this={videoEl} playsinline crossorigin="anonymous" hidden onseeked={() => studio.inv(false)}></video>
<audio bind:this={audioEl} preload="auto" crossorigin="anonymous" hidden ontimeupdate={() => studio.inv(false)}></audio>

<ProjectHome onOpenSettings={() => (settingsOpen = true)} />
<ProjectsDrawerModal bind:open={projectsOpen} />
<SettingsModal bind:open={settingsOpen} />
<ExportModal />
<ConfirmModal />
<ColorPickerPopover />
<EyedropperLoupe />

{#if dragHover}
  <div class="drop-overlay">Drop video file to open in Studio</div>
{/if}

{#if studio.toastMsg}
  <div class="toast-pill">{studio.toastMsg}</div>
{/if}

<style>
  .nle-shell {
    display: grid;
    grid-template-columns: 136px var(--left-w) 1fr var(--right-w);
    grid-template-rows: 46px 1fr var(--tl-h);
    grid-template-areas:
      'h h  h  h'
      'r ld m ri'
      'r t  t  t';
    height: 100vh;
    width: 100vw;
    overflow: hidden;
  }

  .left-drawer {
    grid-area: ld;
    position: relative;
    background: var(--bg-rail);
    border-right: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .drawer-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 9px 12px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
    flex-shrink: 0;
  }
  .drawer-hdr h3 {
    margin: 0;
    font-size: 12px;
    font-weight: 620;
    letter-spacing: -0.01em;
  }
  .drawer-body {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
  }

  .right-wrap {
    grid-area: ri;
    position: relative;
    display: flex;
    min-height: 0;
    min-width: 0;
  }
  .right-wrap :global(.inspector-drawer) {
    flex: 1;
  }

  .tl-wrap {
    grid-area: t;
    position: relative;
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .tl-wrap :global(.tl-dock) {
    flex: 1;
  }

  .resize-v {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 5px;
    cursor: col-resize;
    z-index: 12;
  }
  .resize-v:hover {
    background: var(--accent-soft);
  }
  .left-handle {
    right: -2px;
  }
  .right-handle {
    left: -2px;
  }

  .resize-h {
    position: absolute;
    left: 0;
    right: 0;
    top: -3px;
    height: 6px;
    cursor: row-resize;
    z-index: 12;
  }
  .resize-h:hover {
    background: var(--accent-soft);
  }

  .drop-overlay {
    position: fixed;
    inset: 16px;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--bg-canvas) 90%, transparent);
    backdrop-filter: blur(8px);
    font-size: 16px;
    font-weight: 620;
    z-index: 90;
    border: 2px dashed var(--accent);
    border-radius: var(--radius-xl);
    color: var(--text-primary);
  }

  .toast-pill {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--bg-secondary);
    border: 1px solid var(--border-mid);
    padding: 8px 16px;
    border-radius: var(--radius-md);
    z-index: 95;
    box-shadow: var(--shadow-md);
    font-weight: 560;
    font-size: 12.2px;
    color: var(--text-primary);
  }

  @media (max-width: 1120px) {
    .nle-shell {
      grid-template-columns: 108px 260px 1fr 270px;
    }
  }
</style>
