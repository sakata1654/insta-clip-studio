<script>
  import { fmt, studio } from '../state.svelte.js';
  import { OVERLAY_PRESETS } from '../mediaHelpers.js';
  import CategoryBlock from './CategoryBlock.svelte';
  import Icon from './Icon.svelte';
  import StyleFieldRow from './StyleFieldRow.svelte';
  import StudioPresetsPanel from './panels/StudioPresetsPanel.svelte';
  import TextStyleFields from './panels/TextStyleFields.svelte';

  const selOverlay = $derived(
    (studio.mediaOverlays || []).find((o) => o.id === studio.selectedOverlayId) || null
  );
  const selText = $derived(
    studio.texts.find((t) => t.id === studio.sel) || null
  );
  const selSub = $derived(
    studio.subs.find((s) => s.id === studio.sel) || null
  );

  const contextLabel = $derived.by(() => {
    if (selOverlay && !selText) return `Overlay: ${selOverlay.name}`;
    if (selText) return 'Text Layer Properties';
    if (selSub) return 'Subtitle Cue Properties';
    return 'Clip Inspector';
  });

  function applyOvPreset(key) {
    if (!selOverlay) return;
    const pre = OVERLAY_PRESETS[key];
    if (!pre) return;
    Object.assign(selOverlay, {
      x: pre.x,
      y: pre.y,
      w: pre.w,
      h: pre.h,
      fit: pre.fit || 'contain',
      radius: pre.radius ?? 12,
      borderW: pre.borderW ?? 0,
      borderColor: pre.borderColor || '#ffffff',
      shadowBlur: pre.shadowBlur ?? 12,
      opacity: pre.opacity ?? selOverlay.opacity ?? 100,
    });
    studio.inv();
    studio.snap();
  }
</script>

<aside class="inspector-drawer" aria-label="Right properties inspector">
  <div class="insp-hdr">
    <div class="rt" style="gap:6px;min-width:0">
      <Icon name="sliders" size={14} />
      <h3 class="insp-title" title={contextLabel}>{contextLabel}</h3>
    </div>
    {#if selOverlay || selText || selSub}
      <button
        type="button"
        class="xs ghost"
        onclick={() => {
          studio.clearSelection();
          studio.act = null;
        }}
        title="Clear selection"
      >
        Clear
      </button>
    {/if}
  </div>

  <div class="insp-body">
      <!-- Dynamic Context Inspector -->
      {#if selOverlay && !selText}
        <CategoryBlock title="Selected Overlay: {selOverlay.name}" icon="layers" open={true}>
          <div class="bar" style="gap:4px">
            {#each Object.entries(OVERLAY_PRESETS).slice(0, 6) as [k, p]}
              <button type="button" class="xs" onclick={() => applyOvPreset(k)}>{p.label}</button>
            {/each}
          </div>
          <div class="sg">
            <label>Start (s)<input type="number" step="0.1" min="0" bind:value={selOverlay.start} oninput={() => studio.inv()} /></label>
            <label>End (s)<input type="number" step="0.1" min="0.1" bind:value={selOverlay.end} oninput={() => studio.inv()} /></label>
          </div>
          <StyleFieldRow
            label="Fit mode"
            type="select"
            value={selOverlay.fit || 'contain'}
            options={[['contain', 'Contain'], ['cover', 'Cover'], ['fill', 'Stretch']]}
            onchange={(v) => ((selOverlay.fit = v), studio.inv())}
          />
          <StyleFieldRow
            label="Blend mode"
            type="select"
            value={selOverlay.blend || 'source-over'}
            options={[['source-over', 'Normal'], ['screen', 'Screen'], ['multiply', 'Multiply'], ['overlay', 'Overlay'], ['lighten', 'Lighten']]}
            onchange={(v) => ((selOverlay.blend = v), studio.inv())}
          />
          <StyleFieldRow label="Position X" value={selOverlay.x} min={0} max={100} unit="%" onchange={(v) => ((selOverlay.x = v), studio.inv())} />
          <StyleFieldRow label="Position Y" value={selOverlay.y} min={0} max={100} unit="%" onchange={(v) => ((selOverlay.y = v), studio.inv())} />
          <StyleFieldRow label="Width" value={selOverlay.w} min={5} max={100} unit="%" onchange={(v) => ((selOverlay.w = v), studio.inv())} />
          <StyleFieldRow label="Height" value={selOverlay.h} min={5} max={100} unit="%" onchange={(v) => ((selOverlay.h = v), studio.inv())} />
          <StyleFieldRow label="Opacity" value={selOverlay.opacity} min={0} max={100} unit="%" onchange={(v) => ((selOverlay.opacity = v), studio.inv())} />
          <StyleFieldRow label="Radius" value={selOverlay.radius ?? 12} min={0} max={200} unit="px" onchange={(v) => ((selOverlay.radius = v), studio.inv())} />
          <StyleFieldRow label="Fade in/out" value={selOverlay.fadeMs ?? 200} min={0} max={1500} step={50} unit="ms" onchange={(v) => ((selOverlay.fadeMs = v), studio.inv())} />
          {#if selOverlay.type === 'video'}
            <StyleFieldRow label="Loop MP4" type="check" value={selOverlay.loop !== false} onchange={(v) => ((selOverlay.loop = v), studio.inv())} />
            <StyleFieldRow label="Mute MP4" type="check" value={selOverlay.mute !== false} onchange={(v) => ((selOverlay.mute = v), studio.inv())} />
          {/if}
        </CategoryBlock>
      {/if}

      {#if selText}
        <CategoryBlock title="Selected Text Overlay" icon="type" open={true}>
          <div class="bar" style="margin-bottom:8px">
            <button
              type="button"
              class="xs"
              style="flex:1"
              onclick={() => {
                selText.enabled = selText.enabled === false;
                studio.inv();
                studio.snap();
              }}
            >
              <Icon name={selText.enabled === false ? 'eye' : 'eye-off'} size={12} />
              <span>{selText.enabled === false ? 'Show Layer' : 'Hide Layer'}</span>
            </button>
            <button
              type="button"
              class="xs danger"
              onclick={() => studio.deleteSelectedBlock()}
            >
              <Icon name="trash" size={12} />
              <span>Delete</span>
            </button>
          </div>
          <TextStyleFields item={selText} />
        </CategoryBlock>
      {/if}

      {#if selSub}
        {@const subIdx = studio.subs.indexOf(selSub)}
        <CategoryBlock title="Selected Cue #{subIdx + 1}" icon="subtitles" open={true}>
          <div class="sg" style="margin-bottom:6px">
            <label>Start (s)<input type="number" step="0.05" bind:value={selSub.s} oninput={() => studio.inv()} /></label>
            <label>End (s)<input type="number" step="0.05" bind:value={selSub.e} oninput={() => studio.inv()} /></label>
          </div>
          <label class="hint" for="insp-sub-txt" style="margin:2px 0">Subtitle Text</label>
          <textarea
            id="insp-sub-txt"
            dir="auto"
            rows="2"
            style="width:100%"
            value={selSub.t}
            oninput={(e) => {
              selSub.t = e.currentTarget.value;
              studio.inv();
            }}
            onblur={() => studio.expandPipeSubtitles()}
          ></textarea>
          {#if selSub.tr !== undefined || studio.du.on}
            <label class="hint" for="insp-sub-tr" style="margin:6px 0 2px;display:block">Translation Line</label>
            <textarea
              id="insp-sub-tr"
              dir="auto"
              rows="2"
              style="width:100%"
              value={selSub.tr || ''}
              oninput={(e) => {
                selSub.tr = e.currentTarget.value;
                studio.inv();
              }}
              onblur={() => studio.expandPipeSubtitles()}
            ></textarea>
          {/if}
          <div class="bar" style="margin-top:8px;margin-bottom:0">
            {#if (selSub.t || '').includes('|') || (selSub.tr || '').includes('|')}
              <button type="button" class="xs pri" onclick={() => studio.expandPipeSubtitles()} title="Divide this cue at | separator">Split on |</button>
            {/if}
            {#if subIdx < studio.subs.length - 1}
              <button type="button" class="xs" onclick={() => studio.transferWord(subIdx, 'prev')}>Pull Word</button>
              <button type="button" class="xs" onclick={() => studio.transferWord(subIdx, 'next')}>Push Word</button>
              <button type="button" class="xs" onclick={() => studio.mergeSubAt(subIdx)}>Merge Next</button>
            {/if}
            <button
              type="button"
              class="xs danger"
              style="margin-left:auto"
              onclick={() => {
                studio.subs.splice(subIdx, 1);
                studio.sel = null;
                studio.inv();
                studio.snap();
              }}
            >
              Delete
            </button>
          </div>
          <button
            type="button"
            class="xs"
            style="width:100%;margin-top:8px"
            onclick={() => {
              studio.leftTab = 'subtitles';
              studio.subTab = 'style';
            }}
          >
            Customize Subtitle Appearance →
          </button>
        </CategoryBlock>
      {/if}

      {#if !selOverlay && !selText && !selSub}
        <CategoryBlock title="Active Clip Summary" icon="film" open={true}>
          <div class="rt" style="justify-content:space-between;margin-bottom:6px">
            <span class="hint" style="margin:0">Aspect Ratio</span>
            <span class="badge mono">{studio.aspect}</span>
          </div>
          <div class="rt" style="justify-content:space-between;margin-bottom:6px">
            <span class="hint" style="margin:0">Trim Range</span>
            <span class="badge mono">{fmt(studio.trimS)} → {fmt(studio.trimE)}</span>
          </div>
          <StyleFieldRow label="Video Volume" value={studio.au?.vid ?? 100} min={0} max={200} unit="%" onchange={(v) => ((studio.au.vid = v), studio.syncVidVol?.())} />
          <div class="hint" style="margin:8px 0 0">
            Select any subtitle cue, title overlay, or media layer in the preview or timeline to edit its properties here.
          </div>
        </CategoryBlock>

        <StudioPresetsPanel />
      {/if}
  </div>
</aside>

<style>
  .inspector-drawer {
    grid-area: ri;
    background: var(--bg-rail);
    border-left: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }
  .insp-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 9px 12px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
    flex-shrink: 0;
  }
  .insp-title {
    margin: 0;
    font-size: 12px;
    font-weight: 620;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .insp-body {
    flex: 1;
    overflow-y: auto;
    padding: 10px;
  }
</style>
