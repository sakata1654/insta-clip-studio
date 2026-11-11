<script>
  import { loadVideoPath } from '../../mediaHelpers.js';
  import { studio } from '../../state.svelte.js';
  import { getTauri } from '../../tauriBridge.js';
  import CategoryBlock from '../CategoryBlock.svelte';

  let url = $state('');
  let fmtSel = $state('best');
  let dir = $state('');
  let ss = $state('');
  let ee = $state('');
  let busy = $state(false);
  let pct = $state(0);
  let status = $state('');
  let log = $state('');
  let downloads = $state([]);

  $effect(() => {
    const T = getTauri();
    if (!T?.event) return;
    let unlisten;
    T.event.listen('ytdlp-log', (e) => {
      const l = String(e.payload || '');
      log += l + '\n';
      const m = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(l);
      if (m) pct = +m[1];
    }).then((u) => (unlisten = u));
    return () => unlisten?.();
  });

  async function startDownload() {
    if (!url.trim()) return;
    const T = getTauri();
    busy = true;
    log = '';
    pct = 0;
    status = 'Downloading…';
    try {
      const targetDir = dir || (await T.path.downloadDir());
      const outPath = await T.core.invoke('ytdlp_download', { url: url.trim(), fmt: fmtSel, dir: targetDir, start: ss, end: ee });
      status = 'Done ✔';
      pct = 100;
      studio.meta = {
        link: url.trim(),
        start: ss.trim(),
        end: ee.trim(),
        title: outPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, ''),
      };
      downloads = [{ path: outPath, name: outPath.split(/[\\/]/).pop() }, ...downloads];
    } catch (e) {
      status = 'Failed';
      log += '\nError: ' + (e?.message || e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="full-page">
  <div style="max-width:820px;margin:0 auto">
    <CategoryBlock title="Download Video via yt-dlp" icon="download" open={true}>
      <div class="rt" style="margin-bottom:8px">
        <input bind:value={url} placeholder="Paste YouTube, Instagram, X, or TikTok link…" style="flex:1" />
        <button
          type="button"
          class="sm"
          onclick={() => navigator.clipboard.readText().then((t) => (url = t)).catch(() => {})}
        >
          Paste
        </button>
      </div>
      <div class="sg" style="grid-template-columns:1fr 1fr 1fr">
        <label>
          Format
          <select bind:value={fmtSel}>
            <option value="best">Best MP4</option>
            <option value="1080">1080p MP4</option>
            <option value="720">720p MP4</option>
            <option value="audio">Audio only (MP3)</option>
          </select>
        </label>
        <label>Start time (optional)<input bind:value={ss} placeholder="00:12:30" /></label>
        <label>End time (optional)<input bind:value={ee} placeholder="00:15:00" /></label>
      </div>
      <div class="rt" style="margin-top:8px">
        <input bind:value={dir} placeholder="Save folder (leave blank for system Downloads)" style="flex:1" />
        <button
          type="button"
          class="sm"
          onclick={async () => {
            const p = await getTauri()?.dialog?.open({ directory: true });
            if (p) dir = p;
          }}
        >
          Browse…
        </button>
        <button type="button" class="pri" disabled={busy} onclick={startDownload}>
          {busy ? 'Downloading…' : 'Download'}
        </button>
      </div>
      <div class="pbar"><i style="width:{pct}%"></i></div>
      <div class="rt" style="justify-content:space-between">
        <span class="hint" style="margin:0">{status}</span>
        <button
          type="button"
          class="xs"
          onclick={async () => {
            try {
              status = 'yt-dlp ' + (await getTauri().core.invoke('ytdlp_version'));
            } catch (e) {
              status = String(e);
            }
          }}
        >
          Check yt-dlp
        </button>
      </div>
      {#if log}
        <pre class="console mono">{log}</pre>
      {/if}
    </CategoryBlock>

    {#each downloads as d}
      <div class="sub-card rt" style="justify-content:space-between">
        <span>{d.name}</span>
        <button
          type="button"
          class="sm pri"
          onclick={() => {
            studio.setView('ed');
            loadVideoPath(d.path);
          }}
        >
          Open in Editor
        </button>
      </div>
    {/each}
  </div>
</div>

<style>
  .full-page {
    grid-area: 2 / 1 / 4 / 3;
    overflow: auto;
    padding: 24px;
    background: var(--bg-primary);
  }
  .console {
    background: #05070b;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 10px;
    height: 150px;
    overflow: auto;
    font-size: 11px;
    color: var(--text-thirdly);
    margin: 8px 0 0;
  }
</style>
