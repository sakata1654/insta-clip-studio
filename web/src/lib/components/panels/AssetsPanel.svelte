<script>
  import {
    activateAudioAsset,
    addAssetFile,
    assetImage,
    assetPath,
    createLoopedVideo,
    createOverlayFromAsset,
    createTimedBackground,
    loadVideoPath,
    OVERLAY_PRESETS,
    relinkAsset,
  } from '../../mediaHelpers.js';
  import { fmt, studio } from '../../state.svelte.js';
  import { pickLocalBrowserFile } from '../../tauriBridge.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import StyleFieldRow from '../StyleFieldRow.svelte';

  let filter = $state('all'); // 'all' | 'video' | 'image' | 'audio'
  let presetChoice = $state('center-popup');
  let status = $state('');

  let imgIn = $state(null);
  let vidIn = $state(null);
  let audIn = $state(null);

  const visibleAssets = $derived(
    filter === 'all' ? studio.assetLibrary : studio.assetLibrary.filter((a) => a.type === filter)
  );
  const selectedOv = $derived(
    (studio.mediaOverlays || []).find((o) => o.id === studio.selectedOverlayId) ||
      studio.mediaOverlays[studio.mediaOverlays.length - 1] ||
      null
  );

  function addDialog(type) {
    (type === 'image' ? imgIn : type === 'video' ? vidIn : audIn)?.click();
  }

  async function runAssetAction(a, action) {
    try {
      if (action === 'remove') {
        studio.assetLibrary = studio.assetLibrary.filter((x) => x.id !== a.id);
        studio.mediaOverlays = studio.mediaOverlays.filter((o) => o.path !== a.path && o.assetId !== a.id);
        if (studio.aud.track === a.path) {
          studio.aud.track = '';
          studio.aud.trackName = '';
          studio.audioDuration = 0;
          studio.A?.pause();
        }
        studio.saveAssets();
        status = 'Asset removed.';
      } else if (action === 'audio') {
        const d = await activateAudioAsset(a);
        status = `Active audio: ${a.name}${d > 0 ? ` (${fmt(d)})` : ''}`;
      } else if (action === 'video') {
        const path = await assetPath(a);
        const ok = await loadVideoPath(path);
        if (ok) {
          studio.fg.mode = 'video';
          if (studio.V) studio.V.muted = !!studio.aud.track;
          status = `Using ${a.name} as base video`;
        }
      } else if (action === 'image') {
        const im = await assetImage(a);
        if (studio.V?.src && studio.file) {
          studio.fgImg = im;
          studio.fg.mode = 'image';
          studio.fg.assetPath = await assetPath(a);
          studio.inv();
          status = `Using ${a.name} inside card`;
        } else if (studio.aud.track) {
          await createTimedBackground(a);
          status = 'Background timeline created';
        } else {
          throw new Error('Open a video first or add an MP3 audio track.');
        }
      } else if (action === 'background') {
        await createTimedBackground(a);
        status = 'Timed background ready';
      } else if (action === 'loopVideo') {
        await createLoopedVideo(a);
        status = 'Looped background ready';
      } else if (action === 'overlay') {
        await createOverlayFromAsset(a, presetChoice);
        status = `Added ${a.name} (${OVERLAY_PRESETS[presetChoice]?.label || 'Overlay'})`;
        studio.toast(`Added ${a.name} overlay — drag or scroll on preview!`);
      }
    } catch (e) {
      status = 'Error: ' + (e?.message || e);
    }
  }

  function applyPresetToSelected(presetKey) {
    if (!selectedOv) return;
    const pre = OVERLAY_PRESETS[presetKey];
    if (!pre) return;
    Object.assign(selectedOv, {
      x: pre.x,
      y: pre.y,
      w: pre.w,
      h: pre.h,
      fit: pre.fit || 'contain',
      radius: pre.radius ?? 12,
      borderW: pre.borderW ?? 0,
      borderColor: pre.borderColor || '#ffffff',
      shadowBlur: pre.shadowBlur ?? 12,
      opacity: pre.opacity ?? selectedOv.opacity ?? 100,
    });
    studio.inv();
    studio.snap();
  }
</script>

<input bind:this={imgIn} type="file" accept="image/*" hidden onchange={(e) => e.currentTarget.files?.[0] && addAssetFile(e.currentTarget.files[0], 'image')} />
<input bind:this={vidIn} type="file" accept="video/*" hidden onchange={(e) => e.currentTarget.files?.[0] && addAssetFile(e.currentTarget.files[0], 'video')} />
<input bind:this={audIn} type="file" accept="audio/*" hidden onchange={(e) => e.currentTarget.files?.[0] && addAssetFile(e.currentTarget.files[0], 'audio')} />

<CategoryBlock title="Media Bin (Videos, Banners, Logos, Audio)" icon="folder" open={true}>
  <div class="bar">
    <button type="button" class="xs pri" onclick={() => addDialog('video')}>＋ Video / B-Roll</button>
    <button type="button" class="xs" onclick={() => addDialog('image')}>＋ Banner / Image</button>
    <button type="button" class="xs" onclick={() => addDialog('audio')}>＋ MP3 / Audio</button>
  </div>

  <div class="seg-pills quad">
    <button type="button" class:on={filter === 'all'} onclick={() => (filter = 'all')}>All ({studio.assetLibrary.length})</button>
    <button type="button" class:on={filter === 'video'} onclick={() => (filter = 'video')}>Videos</button>
    <button type="button" class:on={filter === 'image'} onclick={() => (filter = 'image')}>Images</button>
    <button type="button" class:on={filter === 'audio'} onclick={() => (filter = 'audio')}>Audio</button>
  </div>

  <div class="rt" style="margin-bottom:8px">
    <span class="hint" style="margin:0;white-space:nowrap">Overlay placement:</span>
    <select bind:value={presetChoice} style="flex:1;padding:4px 7px;font-size:11.5px">
      {#each Object.entries(OVERLAY_PRESETS) as [k, p]}
        <option value={k}>{p.label}</option>
      {/each}
    </select>
  </div>

  {#if studio.aud.track}
    <div class="sub-card rt" style="justify-content:space-between;padding:6px 8px">
      <span style="font-size:11.5px">🎧 Active Audio: <b>{studio.aud.trackName}</b></span>
      <button
        type="button"
        class="xs"
        onclick={() => {
          studio.aud.track = '';
          studio.aud.trackName = '';
          studio.audioDuration = 0;
          studio.A?.pause();
          if (studio.V) studio.V.muted = false;
          studio.inv();
        }}
      >
        Reset
      </button>
    </div>
  {/if}

  {#if status}
    <div class="hint">{status}</div>
  {/if}

  <div class="asset-grid">
    {#each visibleAssets as a (a.id)}
      <div class="asset-card">
        <div class="thumb-wrap">
          {#if a.thumbUrl}
            <img src={a.thumbUrl} alt={a.name} />
          {:else}
            <div class="thumb-placeholder">{a.type.toUpperCase()}</div>
          {/if}
          <span class="badge type-tag">{a.type}</span>
          {#if a.duration > 0}
            <span class="badge dur-tag mono">{fmt(a.duration)}</span>
          {/if}
        </div>
        <div class="asset-meta">
          <div class="asset-name" title={a.name}>{a.name}</div>
          {#if a.status === 'missing'}
            <button
              type="button"
              class="xs pri"
              style="width:100%;margin-top:4px"
              onclick={async () => {
                const f = await pickLocalBrowserFile('*/*', false);
                if (f) {
                  await relinkAsset(a, f);
                  status = `Relinked ${a.name}`;
                }
              }}
            >
              Relink File
            </button>
          {/if}
          <div class="bar" style="margin:5px 0 0;gap:4px">
            {#if a.type === 'video' || a.type === 'image'}
              <button type="button" class="xs pri" onclick={() => runAssetAction(a, 'overlay')} title="Add as timed overlay video/banner">＋ Overlay</button>
            {/if}
            {#if a.type === 'image'}
              <button type="button" class="xs" onclick={() => runAssetAction(a, 'image')}>Card</button>
              <button type="button" class="xs" onclick={() => runAssetAction(a, 'background')}>Timed BG</button>
            {:else if a.type === 'video'}
              <button type="button" class="xs" onclick={() => runAssetAction(a, 'video')}>Main</button>
              <button type="button" class="xs" onclick={() => runAssetAction(a, 'loopVideo')}>Loop</button>
            {:else}
              <button type="button" class="xs pri" onclick={() => runAssetAction(a, 'audio')}>Use Audio</button>
            {/if}
            <button type="button" class="xs" style="margin-left:auto" onclick={() => runAssetAction(a, 'remove')}>✕</button>
          </div>
        </div>
      </div>
    {:else}
      <div class="hint" style="grid-column:1/3">Import overlay videos, PNG banners, speaker photos, or MP3 speech tracks above.</div>
    {/each}
  </div>
</CategoryBlock>

{#if studio.mediaOverlays.length}
  <CategoryBlock title="Active Overlay Videos & Banners ({studio.mediaOverlays.length})" icon="film" open={true}>
    <div class="bar">
      {#each studio.mediaOverlays as o (o.id)}
        <button
          type="button"
          class="xs"
          class:pri={selectedOv?.id === o.id}
          onclick={() => ((studio.selectedOverlayId = o.id), studio.seek(o.start || 0))}
        >
          {o.name.slice(0, 18)}
        </button>
      {/each}
    </div>

    {#if selectedOv}
      <div class="sub-card">
        <div class="rt" style="justify-content:space-between;margin-bottom:6px">
          <b>{selectedOv.name}</b>
          <button
            type="button"
            class="xs"
            onclick={() => {
              studio.mediaOverlays = studio.mediaOverlays.filter((x) => x.id !== selectedOv.id);
              studio.inv();
              studio.snap();
            }}
          >
            Remove
          </button>
        </div>

        <div class="bar" style="gap:4px">
          {#each Object.entries(OVERLAY_PRESETS).slice(0, 6) as [k, p]}
            <button type="button" class="xs" onclick={() => applyPresetToSelected(k)}>{p.label}</button>
          {/each}
        </div>

        <div class="sg">
          <label>Start (s)<input type="number" step="0.1" min="0" bind:value={selectedOv.start} oninput={() => studio.inv()} /></label>
          <label>End (s)<input type="number" step="0.1" min="0.1" bind:value={selectedOv.end} oninput={() => studio.inv()} /></label>
        </div>

        <StyleFieldRow
          label="Fit mode"
          type="select"
          value={selectedOv.fit || 'contain'}
          options={[
            ['contain', 'Contain (Fit)'],
            ['cover', 'Cover (Crop fill)'],
            ['fill', 'Stretch'],
          ]}
          onchange={(v) => ((selectedOv.fit = v), studio.inv())}
        />
        <StyleFieldRow
          label="Blend mode"
          type="select"
          value={selectedOv.blend || 'source-over'}
          options={[
            ['source-over', 'Normal'],
            ['screen', 'Screen (Light/Particles)'],
            ['multiply', 'Multiply'],
            ['overlay', 'Overlay'],
            ['lighten', 'Lighten'],
          ]}
          onchange={(v) => ((selectedOv.blend = v), studio.inv())}
        />
        <StyleFieldRow label="Position X" value={selectedOv.x} min={0} max={100} unit="%" onchange={(v) => ((selectedOv.x = v), studio.inv())} />
        <StyleFieldRow label="Position Y" value={selectedOv.y} min={0} max={100} unit="%" onchange={(v) => ((selectedOv.y = v), studio.inv())} />
        <StyleFieldRow label="Width" value={selectedOv.w} min={5} max={100} unit="%" onchange={(v) => ((selectedOv.w = v), studio.inv())} />
        <StyleFieldRow label="Height" value={selectedOv.h} min={5} max={100} unit="%" onchange={(v) => ((selectedOv.h = v), studio.inv())} />
        <StyleFieldRow label="Opacity" value={selectedOv.opacity} min={0} max={100} unit="%" onchange={(v) => ((selectedOv.opacity = v), studio.inv())} />
        <StyleFieldRow label="Corner radius" value={selectedOv.radius ?? 12} min={0} max={200} unit="px" onchange={(v) => ((selectedOv.radius = v), studio.inv())} />
        <StyleFieldRow label="Border width" value={selectedOv.borderW ?? 0} min={0} max={20} unit="px" onchange={(v) => ((selectedOv.borderW = v), studio.inv())} />
        <StyleFieldRow label="Border color" type="color" value={selectedOv.borderColor || '#ffffff'} onchange={(v) => ((selectedOv.borderColor = v), studio.inv())} />
        <StyleFieldRow label="Shadow blur" value={selectedOv.shadowBlur ?? 12} min={0} max={50} unit="px" onchange={(v) => ((selectedOv.shadowBlur = v), studio.inv())} />
        <StyleFieldRow label="Fade in/out" value={selectedOv.fadeMs ?? 200} min={0} max={1500} step={50} unit="ms" onchange={(v) => ((selectedOv.fadeMs = v), studio.inv())} />
        {#if selectedOv.type === 'video'}
          <StyleFieldRow label="Loop video" type="check" value={selectedOv.loop !== false} onchange={(v) => ((selectedOv.loop = v), studio.inv())} />
          <StyleFieldRow label="Mute video" type="check" value={selectedOv.mute !== false} onchange={(v) => ((selectedOv.mute = v), studio.inv())} />
        {/if}
      </div>
    {/if}
  </CategoryBlock>
{/if}

<style>
  .asset-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .asset-card {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .thumb-wrap {
    position: relative;
    height: 76px;
    background: #06080d;
    display: grid;
    place-items: center;
    overflow: hidden;
  }
  .thumb-wrap img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .thumb-placeholder {
    font-size: 11px;
    font-weight: 700;
    color: var(--text-thirdly);
    letter-spacing: 0.08em;
  }
  .type-tag {
    position: absolute;
    top: 4px;
    left: 4px;
    font-size: 9.5px;
    padding: 1px 6px;
    background: rgba(0, 0, 0, 0.72);
    text-transform: uppercase;
  }
  .dur-tag {
    position: absolute;
    bottom: 4px;
    right: 4px;
    font-size: 9.5px;
    padding: 1px 5px;
    background: rgba(0, 0, 0, 0.78);
  }
  .asset-meta {
    padding: 7px;
  }
  .asset-name {
    font-size: 11.2px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
