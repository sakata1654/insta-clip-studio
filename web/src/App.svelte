<script>
  import { onMount } from 'svelte';
  import { openVideoFile } from './lib/mediaHelpers.js';
  import { studio } from './lib/state.svelte.js';
  import { viewport } from './lib/webPlatform/viewport.svelte.js';

  import ColorPickerPopover from './lib/components/ColorPickerPopover.svelte';
  import HeaderBar from './lib/components/HeaderBar.svelte';
  import Icon from './lib/components/Icon.svelte';
  import InspectorPanel from './lib/components/InspectorPanel.svelte';
  import PreviewStage from './lib/components/PreviewStage.svelte';
  import TimelineDock from './lib/components/TimelineDock.svelte';
  import ToolRail from './lib/components/ToolRail.svelte';

  import ConfirmModal from './lib/components/modals/ConfirmModal.svelte';
  import ExportModal from './lib/components/modals/ExportModal.svelte';
  import ProjectsDrawerModal from './lib/components/modals/ProjectsDrawerModal.svelte';
  import SettingsModal from './lib/components/modals/SettingsModal.svelte';

  import AiClipsView from './lib/components/views/AiClipsView.svelte';
  import ProjectHome from './lib/components/views/ProjectHome.svelte';
  import TranslateView from './lib/components/views/TranslateView.svelte';

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

  // Resizable panel dimensions (desktop)
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

  const mobileNavItems = [
    { id: 'media', label: 'Media', icon: 'media' },
    { id: 'subtitles', label: 'Subtitles', icon: 'subtitles' },
    { id: 'banners', label: 'Titles', icon: 'type' },
    { id: 'look', label: 'Canvas', icon: 'palette' },
    { id: 'ai', label: 'AI', icon: 'sparkles' },
  ];

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
    if (viewport.isMobile) studio.mobileSheet = 'tools';
    else if (viewport.isTablet) studio.tabletToolsOpen = true;
  }

  function tapMobileTool(tabId) {
    if (studio.mobileSheet === 'tools' && studio.leftTab === tabId) {
      studio.mobileSheet = null;
    } else {
      studio.leftTab = tabId;
      studio.mobileSheet = 'tools';
    }
  }

  function tapMobileInspector() {
    studio.mobileSheet = studio.mobileSheet === 'inspector' ? null : 'inspector';
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
  class:mode-desktop={viewport.isDesktop}
  class:mode-small-desktop={viewport.tier === 'small-desktop'}
  class:mode-tablet-land={viewport.tier === 'tablet-landscape'}
  class:mode-tablet-port={viewport.tier === 'tablet-portrait'}
  class:mode-mobile={viewport.isMobile}
  class:kbd-open={viewport.keyboardOpen}
  style="--left-w:{viewport.tier === 'small-desktop' ? Math.min(leftWidth, 260) : leftWidth}px;--right-w:{viewport.tier === 'small-desktop' ? Math.min(rightWidth, 276) : rightWidth}px;--tl-h:{timelineHeight}px"
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
    <!-- Desktop & Small-Desktop ToolRail -->
    {#if viewport.isDesktop}
      <ToolRail bind:active={studio.leftTab} />
    {/if}

    <!-- Desktop Left Drawer OR Collapsible Tablet Tools Panel -->
    {#if viewport.isDesktop || (viewport.tier === 'tablet-landscape' && studio.tabletToolsOpen)}
      <aside class="left-drawer" aria-label="Tool library panel">
        <div class="drawer-hdr">
          <h3>{leftTitles[studio.leftTab] || 'Media & Overlays'}</h3>
          {#if viewport.tier === 'tablet-landscape'}
            <div class="rt" style="gap:4px">
              {#each mobileNavItems as item}
                <button type="button" class="xs" class:pri={studio.leftTab === item.id} onclick={() => (studio.leftTab = item.id)} title={item.label}>
                  <Icon name={item.icon} size={12} />
                </button>
              {/each}
            </div>
          {:else if studio.leftTab === 'subtitles' && studio.subs.length}
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

        {#if viewport.isDesktop}
          <div
            class="resize-v left-handle"
            role="separator"
            aria-orientation="vertical"
            title="Drag to resize sidebar"
            onpointerdown={(e) => startResize('left', e)}
          ></div>
        {/if}
      </aside>
    {/if}

    <PreviewStage
      bind:this={stageRef}
      onOpenProjects={() => (projectsOpen = true)}
      onSelectWorkflow={routeWorkflow}
    />

    <!-- Desktop Right Inspector OR Tablet Landscape Collapsible Inspector -->
    {#if viewport.isDesktop || (viewport.tier === 'tablet-landscape' && studio.tabletInspectorOpen)}
      <div class="right-wrap">
        {#if viewport.isDesktop}
          <div
            class="resize-v right-handle"
            role="separator"
            aria-orientation="vertical"
            title="Drag to resize inspector"
            onpointerdown={(e) => startResize('right', e)}
          ></div>
        {/if}
        <InspectorPanel />
      </div>
    {/if}

    <!-- Bottom Multi-Track Timeline (always visible unless mobile soft keyboard covers screen) -->
    {#if !(viewport.isMobile && viewport.keyboardOpen)}
      <div class="tl-wrap">
        {#if viewport.isDesktop}
          <div
            class="resize-h"
            role="separator"
            aria-orientation="horizontal"
            title="Drag to resize timeline height"
            onpointerdown={(e) => startResize('timeline', e)}
          ></div>
        {/if}
        <TimelineDock />
      </div>
    {/if}

    <!-- Tablet Portrait Floating Overlay Drawer (for Tools or Inspector without squeezing preview) -->
    {#if viewport.tier === 'tablet-portrait' && (studio.tabletToolsOpen || studio.tabletInspectorOpen)}
      <div
        class="sheet-backdrop"
        role="presentation"
        onclick={(e) => {
          if (e.target === e.currentTarget) {
            studio.tabletToolsOpen = false;
            studio.tabletInspectorOpen = false;
          }
        }}
      >
        <section class="tablet-drawer" aria-label={studio.tabletInspectorOpen ? 'Properties Inspector' : 'Editing Tools'}>
          <div class="drawer-hdr">
            <h3>{studio.tabletInspectorOpen ? 'Properties Inspector' : (leftTitles[studio.leftTab] || 'Editing Tools')}</h3>
            <button
              type="button"
              class="sm"
              onclick={() => {
                studio.tabletToolsOpen = false;
                studio.tabletInspectorOpen = false;
              }}
            >
              Done
            </button>
          </div>
          {#if studio.tabletToolsOpen}
            <div class="sheet-tabs">
              {#each mobileNavItems as item}
                <button type="button" class="sm" class:pri={studio.leftTab === item.id} onclick={() => (studio.leftTab = item.id)}>
                  <Icon name={item.icon} size={13} />
                  <span>{item.label}</span>
                </button>
              {/each}
            </div>
          {/if}
          <div class="drawer-body">
            {#if studio.tabletInspectorOpen}
              <InspectorPanel />
            {:else if studio.leftTab === 'subtitles'}
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
        </section>
      </div>
    {/if}

    <!-- Mobile Primary Bottom Navigation Bar & Slide-Up Editing Bottom Sheet -->
    {#if viewport.isMobile}
      {#if studio.mobileSheet}
        <div
          class="sheet-backdrop"
          role="presentation"
          onclick={(e) => e.target === e.currentTarget && (studio.mobileSheet = null)}
        >
          <section class="mobile-sheet" aria-label="Mobile editing panel">
            <div class="sheet-grab"><i></i></div>
            <div class="sheet-hdr">
              <b>{studio.mobileSheet === 'inspector' ? 'Inspector & Style' : (leftTitles[studio.leftTab] || 'Tools')}</b>
              <button type="button" class="sm pri" onclick={() => (studio.mobileSheet = null)}>Done</button>
            </div>
            <div class="sheet-body">
              {#if studio.mobileSheet === 'inspector'}
                <InspectorPanel />
              {:else if studio.leftTab === 'subtitles'}
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
          </section>
        </div>
      {/if}

      <nav class="mobile-bottom-nav" aria-label="Mobile editing navigation">
        {#each mobileNavItems as item}
          <button
            type="button"
            class="mb-btn"
            class:on={studio.mobileSheet === 'tools' && studio.leftTab === item.id}
            onclick={() => tapMobileTool(item.id)}
          >
            <Icon name={item.icon} size={17} />
            <span>{item.label}</span>
          </button>
        {/each}
        <button
          type="button"
          class="mb-btn"
          class:on={studio.mobileSheet === 'inspector'}
          onclick={tapMobileInspector}
        >
          <Icon name="sliders" size={17} />
          <span>Inspect</span>
        </button>
      </nav>
    {/if}
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

{#if dragHover}
  <div class="drop-overlay">Drop video file to open in Studio</div>
{/if}

{#if studio.toastMsg}
  <div class="toast-pill" class:above-nav={viewport.isMobile}>{studio.toastMsg}</div>
{/if}

<style>
  .nle-shell {
    display: grid;
    grid-template-columns: 136px var(--left-w) 1fr var(--right-w);
    grid-template-rows: calc(46px + var(--sat)) 1fr var(--tl-h);
    grid-template-areas:
      'h h  h  h'
      'r ld m ri'
      'r t  t  t';
    height: 100dvh;
    width: 100%;
    overflow: hidden;
  }

  .nle-shell.mode-small-desktop {
    grid-template-columns: 108px var(--left-w) 1fr var(--right-w);
  }

  /* Tablet Landscape: Collapsible left tools & right inspector around generous center preview + timeline */
  .nle-shell.mode-tablet-land {
    grid-template-columns: auto 1fr auto;
    grid-template-rows: calc(46px + var(--sat)) 1fr 196px;
    grid-template-areas:
      'h  h h'
      'ld m ri'
      't  t t';
  }
  .nle-shell.mode-tablet-land .left-drawer {
    width: 268px;
  }
  .nle-shell.mode-tablet-land .right-wrap {
    width: 276px;
  }

  /* Tablet Portrait: Full-width preview + bottom timeline; drawers slide over on demand */
  .nle-shell.mode-tablet-port {
    grid-template-columns: 1fr;
    grid-template-rows: calc(46px + var(--sat)) 1fr 208px;
    grid-template-areas:
      'h'
      'm'
      't';
  }

  /* Mobile Phone (Portrait & Compact): Top bar + Preview + Touch Timeline + Fixed Bottom Navigation */
  .nle-shell.mode-mobile {
    grid-template-columns: 1fr;
    grid-template-rows: calc(46px + var(--sat)) 1fr minmax(146px, 28dvh) calc(56px + var(--sab));
    grid-template-areas:
      'h'
      'm'
      't'
      'bn';
  }
  .nle-shell.mode-mobile.kbd-open {
    grid-template-rows: calc(46px + var(--sat)) 1fr calc(56px + var(--sab));
    grid-template-areas:
      'h'
      'm'
      'bn';
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
    -webkit-overflow-scrolling: touch;
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

  /* Adaptive Mobile Bottom Navigation */
  .mobile-bottom-nav {
    grid-area: bn;
    height: calc(56px + var(--sab));
    padding: 0 calc(4px + var(--sar)) var(--sab) calc(4px + var(--sal));
    background: var(--bg-titlebar);
    border-top: 1px solid var(--border-color);
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    align-items: center;
    gap: 2px;
    z-index: 45;
  }
  .mb-btn {
    height: 48px;
    min-height: 44px;
    padding: 4px 2px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--text-thirdly);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    font-size: 10px;
    font-weight: 560;
  }
  .mb-btn.on {
    color: var(--accent);
    background: var(--accent-soft);
  }

  /* Slide-Up Mobile Sheet & Tablet Portrait Drawer */
  .sheet-backdrop {
    position: fixed;
    inset: 0;
    bottom: calc(56px + var(--sab));
    background: rgba(8, 10, 14, 0.56);
    backdrop-filter: blur(4px);
    z-index: 40;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .nle-shell.mode-tablet-port .sheet-backdrop {
    bottom: 0;
    justify-content: flex-start;
    align-items: stretch;
  }
  .mobile-sheet {
    width: 100%;
    max-height: 68dvh;
    background: var(--bg-secondary);
    border-top: 1px solid var(--border-strong);
    border-radius: 16px 16px 0 0;
    box-shadow: var(--shadow-lg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .sheet-grab {
    display: grid;
    place-items: center;
    padding: 8px 0 2px;
    flex-shrink: 0;
  }
  .sheet-grab i {
    width: 36px;
    height: 4px;
    border-radius: 99px;
    background: var(--border-strong);
  }
  .sheet-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 14px 10px;
    border-bottom: 1px solid var(--border-color);
    font-size: 13px;
    flex-shrink: 0;
  }
  .sheet-body {
    flex: 1;
    overflow-y: auto;
    padding: 10px 12px 18px;
    -webkit-overflow-scrolling: touch;
  }
  .sheet-body :global(.inspector-drawer) {
    width: 100%;
    height: 100%;
    border-left: 0;
    background: transparent;
  }
  .sheet-body :global(.inspector-drawer .insp-hdr) {
    display: none;
  }
  .tablet-drawer {
    width: min(400px, 90vw);
    height: 100%;
    padding-top: var(--sat);
    background: var(--bg-secondary);
    border-right: 1px solid var(--border-strong);
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
  }
  .tablet-drawer .drawer-body :global(.inspector-drawer) {
    width: 100%;
    height: 100%;
    border-left: 0;
    background: transparent;
  }
  .tablet-drawer .drawer-body :global(.inspector-drawer .insp-hdr) {
    display: none;
  }
  .sheet-tabs {
    display: flex;
    gap: 4px;
    padding: 8px 10px;
    overflow-x: auto;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
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
  .left-handle { right: -2px; }
  .right-handle { left: -2px; }

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
    max-width: calc(100vw - 24px);
    text-align: center;
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
  .toast-pill.above-nav {
    bottom: calc(68px + var(--sab));
  }
</style>
