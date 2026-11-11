<script>
  import { activateAudioAsset, addAssetFile } from '../../mediaHelpers.js';
  import { fmt, studio } from '../../state.svelte.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import ExportPanel from '../panels/ExportPanel.svelte';
  import StyleFieldRow from '../StyleFieldRow.svelte';

  let audIn = $state(null);
  const audioAssets = $derived(studio.assetLibrary.filter((a) => a.type === 'audio'));

  function pickAudio() {
    audIn?.click();
  }
</script>

<input
  bind:this={audIn}
  type="file"
  accept="audio/*"
  hidden
  onchange={(e) => {
    const f = e.currentTarget.files?.[0];
    if (f) addAssetFile(f, 'audio');
    e.currentTarget.value = '';
  }}
/>

<CategoryBlock title="Audio Tracks & Levels" icon="music" open={true}>
  <StyleFieldRow
    label="Source volume"
    value={studio.vol}
    min={0}
    max={100}
    unit="%"
    onchange={(v) => {
      studio.vol = v;
      if (studio.V) studio.V.volume = v / 100;
    }}
  />

  <div class="bar" style="margin-top:8px">
    <button type="button" class="sm pri" style="flex:1" onclick={pickAudio}>Import Audio / MP3</button>
    {#if studio.aud.track}
      <button
        type="button"
        class="sm"
        onclick={() => {
          studio.aud.track = '';
          studio.aud.trackName = '';
          studio.audioDuration = 0;
          studio.A?.pause();
          studio.inv();
        }}
      >
        Use Video Audio
      </button>
    {/if}
  </div>

  {#if studio.aud.track}
    <div class="sub-card">
      <div class="rt" style="justify-content:space-between">
        <b style="font-size:12px">{studio.aud.trackName || 'Active Track'}</b>
        <span class="badge ok">Active</span>
      </div>
      {#if studio.audioDuration > 0}
        <div class="hint" style="margin:2px 0 0">Duration: {fmt(studio.audioDuration)}</div>
      {/if}
    </div>
  {/if}

  {#each audioAssets as a (a.id)}
    <div class="sub-card rt" style="justify-content:space-between">
      <div style="min-width:0">
        <div style="font-weight:560;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{a.name}</div>
        {#if a.duration > 0}
          <div class="hint" style="margin:0;font-size:10.5px">{fmt(a.duration)}</div>
        {/if}
      </div>
      <button type="button" class="xs pri" onclick={() => activateAudioAsset(a)}>Use Track</button>
    </div>
  {:else}
    <div class="hint" style="margin-bottom:0">
      No external audio imported yet. Embedded video audio plays by default.
    </div>
  {/each}
</CategoryBlock>

<ExportPanel modeTab="aud" />
