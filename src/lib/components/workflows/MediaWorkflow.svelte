<script>
  import { loadVideoPath, openVideoFile } from '../../mediaHelpers.js';
  import { aiCallJson } from '../../prompts.js';
  import { fmt, studio } from '../../state.svelte.js';
  import { getTauri } from '../../tauriBridge.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import Icon from '../Icon.svelte';
  import AssetsPanel from '../panels/AssetsPanel.svelte';

  let subTab = $state('import'); // 'import' | 'dl' | 'assets' | 'ai'
  let vidIn = $state(null);

  // Download state
  let dlUrl = $state('');
  let dlFmt = $state('best');
  let dlBusy = $state(false);
  let dlPct = $state(0);
  let dlStatus = $state('');

  // AI clips quick state
  let aiCount = $state(6);
  let aiMax = $state(120);
  let aiBusy = $state(false);
  let aiStatus = $state('');
  let aiClips = $state([]);

  async function browseLocalVideo() {
    const T = getTauri();
    if (T?.dialog) {
      try {
        const p = await T.dialog.open({ filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }] });
        if (p) await loadVideoPath(p);
      } catch (e) {
        studio.toast(String(e));
      }
    } else {
      vidIn?.click();
    }
  }

  async function downloadUrl() {
    if (!dlUrl.trim()) return;
    const T = getTauri();
    dlBusy = true;
    dlPct = 0;
    dlStatus = 'Downloading…';
    const unlisten = await T.event?.listen('ytdlp-log', (e) => {
      const m = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(String(e.payload || ''));
      if (m) dlPct = +m[1];
    });
    try {
      const dir = await T.path.downloadDir();
      const outPath = await T.core.invoke('ytdlp_download', { url: dlUrl.trim(), fmt: dlFmt, dir, start: '', end: '' });
      dlStatus = 'Downloaded ✔ Opening…';
      dlPct = 100;
      studio.meta = { link: dlUrl.trim(), title: outPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') };
      await loadVideoPath(outPath);
    } catch (e) {
      dlStatus = '❌ ' + (e?.message || e);
    } finally {
      unlisten?.();
      dlBusy = false;
    }
  }

  async function findViralClips() {
    if (!studio.subs.length) return studio.toast('Generate subtitles first (Captions tab).');
    if (!studio.API.key && studio.API.prov !== 'ollama') {
      studio.apiModalOpen = true;
      return;
    }
    aiBusy = true;
    aiClips = [];
    try {
      const sorted = [...studio.subs].sort((a, b) => a.s - b.s);
      const transcript = sorted.map((x) => `[${fmt(x.s)}–${fmt(x.e)}] ${x.orig ?? x.t}`).join('\n');
      aiStatus = 'Analyzing transcript for complete standalone clips…';
      const sec = await aiCallJson(
        studio.API,
        `Select up to ${aiCount} standalone short clips (max ${aiMax}s) that never cut mid-thought. Return JSON {"clips":[{"title":"...","start_seconds":0.0,"end_seconds":45.0,"summary":"...","quality_score":88}]}.\n\nTRANSCRIPT:\n${transcript}`,
        'You are an expert short-form video editor. Return JSON only.'
      );
      aiClips = (sec.clips || []).filter((c) => +c.end_seconds > +c.start_seconds);
      aiStatus = `Found ${aiClips.length} standalone clips.`;
    } catch (e) {
      aiStatus = '❌ ' + (e?.message || e);
    } finally {
      aiBusy = false;
    }
  }
</script>

<input
  bind:this={vidIn}
  type="file"
  accept="video/*"
  hidden
  onchange={(e) => {
    const f = e.currentTarget.files?.[0];
    if (f) openVideoFile(f);
    e.currentTarget.value = '';
  }}
/>

<div class="seg-pills quad">
  <button type="button" class:on={subTab === 'import'} onclick={() => (subTab = 'import')}>Import</button>
  <button type="button" class:on={subTab === 'dl'} onclick={() => (subTab = 'dl')}>Link</button>
  <button type="button" class:on={subTab === 'assets'} onclick={() => (subTab = 'assets')}>Assets</button>
  <button type="button" class:on={subTab === 'ai'} onclick={() => (subTab = 'ai')}>AI Clips</button>
</div>

{#if subTab === 'import'}
  <div class="drop-card" role="button" tabindex="0" onclick={browseLocalVideo} onkeydown={(e) => e.key === 'Enter' && browseLocalVideo()}>
    <div class="drop-ic"><Icon name="upload" size={22} /></div>
    <b style="font-size:13px">Import Video or Drop File</b>
    <div class="hint" style="margin:2px 0 8px">MP4, MOV, MKV, WebM or M4V</div>
    <span class="badge pri">{studio.file ? studio.file.name : 'Choose from PC…'}</span>
  </div>

  {#if studio.file}
    <CategoryBlock title="Loaded Media" icon="film" open={true}>
      <div class="rt" style="justify-content:space-between">
        <span class="hint" style="margin:0;color:var(--text-primary)">{studio.file.name}</span>
        <span class="badge mono">{fmt(studio.dur)}</span>
      </div>
      <div class="hint" style="margin:4px 0 0">Trim: {fmt(studio.trimS)} → {fmt(studio.trimE)}</div>
    </CategoryBlock>
  {/if}
{:else if subTab === 'dl'}
  <CategoryBlock title="Download from URL (yt-dlp)" icon="download" open={true}>
    <input bind:value={dlUrl} placeholder="Paste YouTube / Instagram / X link…" style="width:100%;margin-bottom:8px" />
    <div class="rt">
      <select bind:value={dlFmt} style="flex:1">
        <option value="best">Best MP4</option>
        <option value="1080">1080p MP4</option>
        <option value="720">720p MP4</option>
        <option value="audio">Audio MP3 only</option>
      </select>
      <button type="button" class="pri sm" disabled={dlBusy} onclick={downloadUrl}>
        {dlBusy ? 'Downloading…' : 'Fetch Video'}
      </button>
    </div>
    <div class="pbar"><i style="width:{dlPct}%"></i></div>
    {#if dlStatus}
      <div class="hint" style="margin:2px 0 0">{dlStatus}</div>
    {/if}
  </CategoryBlock>
{:else if subTab === 'assets'}
  <AssetsPanel />
{:else}
  <CategoryBlock title="AI Clip Finder" icon="sparkles" open={true}>
    <div class="sg">
      <label>Max clips<input type="number" min="1" max="25" bind:value={aiCount} /></label>
      <label>Max sec<input type="number" min="15" max="300" bind:value={aiMax} /></label>
    </div>
    <div class="bar" style="margin-top:8px">
      <button type="button" class="pri sm" style="flex:1" disabled={aiBusy} onclick={findViralClips}>Find Best Clips</button>
      <button type="button" class="sm" onclick={() => (studio.apiModalOpen = true)}>API Key</button>
    </div>
    {#if aiStatus}
      <div class="hint">{aiStatus}</div>
    {/if}
    {#each aiClips as c}
      <div class="sub-card">
        <div class="rt" style="justify-content:space-between">
          <b>{c.title}</b>
          <span class="badge pri mono">{Math.round(c.end_seconds - c.start_seconds)}s</span>
        </div>
        <div class="hint" style="margin:3px 0 6px">{fmt(+c.start_seconds)} – {fmt(+c.end_seconds)}</div>
        <button
          type="button"
          class="xs pri"
          onclick={() => {
            studio.trimS = +c.start_seconds;
            studio.trimE = +c.end_seconds;
            studio.seek(+c.start_seconds);
            studio.toast('Trim range loaded');
          }}
        >
          Apply Range to Timeline
        </button>
      </div>
    {/each}
  </CategoryBlock>
{/if}

<style>
  .drop-card {
    border: 1.5px dashed var(--border-strong);
    border-radius: 14px;
    padding: 22px 16px;
    text-align: center;
    background: rgba(255, 255, 255, 0.02);
    cursor: pointer;
    margin-bottom: 10px;
    transition: border-color 160ms ease, background 160ms ease;
  }
  .drop-card:hover {
    border-color: var(--accent-primary);
    background: var(--accent-primary-soft);
  }
  .drop-ic {
    width: 42px;
    height: 42px;
    border-radius: 12px;
    background: var(--accent-primary-soft);
    color: var(--accent-primary);
    display: inline-grid;
    place-items: center;
    margin-bottom: 8px;
  }
</style>
