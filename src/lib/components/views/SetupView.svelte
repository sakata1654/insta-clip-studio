<script>
  import { onMount } from 'svelte';
  import { studio } from '../../state.svelte.js';
  import { getTauri } from '../../tauriBridge.js';
  import CategoryBlock from '../CategoryBlock.svelte';

  let ovr = $state(studio.ovrGet());
  let scanStatus = $state('');
  let elStatus = $state('');
  let logText = $state('');

  const envItems = $derived.by(() => {
    const e = studio.env;
    if (!e) return [];
    const p = e.pkgs || {};
    const c = e.cohere || {};
    const el = e.elevenlabs || {};
    return [
      { name: 'ElevenLabs Scribe v2 / v1', ok: !!el.key, detail: el.key ? 'API key saved' : 'Cloud STT — paste xi-api-key below' },
      { name: 'yt-dlp (Video Downloader)', ok: e.yt_dlp?.ok, detail: e.yt_dlp?.path || '', inst: 'ytdlp', req: true },
      { name: 'FFmpeg (Audio + MP4 Encode)', ok: e.ffmpeg?.ok, detail: e.ffmpeg?.path || '', inst: 'ffmpeg', req: true },
      { name: 'Python Runtime', ok: e.python?.ok, detail: e.python?.version || 'not found', inst: 'python' },
      { name: 'faster-whisper (Local ASR)', ok: !!p.faster_whisper, detail: p.faster_whisper ? (p.cuda ? 'CUDA GPU ready' : 'CPU mode') : 'Needs Python', inst: 'faster_whisper' },
      { name: 'Cohere Transcribe Runtime', ok: !!c.runtime, detail: c.runtime ? 'Transformers ' + c.version : 'Optional EN/AR runtime', inst: 'cohere' },
      { name: 'Demucs (Vocal Separation)', ok: !!p.demucs, detail: p.demucs ? 'Installed' : 'Optional', inst: 'demucs' },
      { name: 'Face Detection (MediaPipe)', ok: studio.fdOk, detail: 'Bundled locally' },
    ];
  });

  export async function scanEnv() {
    const T = getTauri();
    if (!T?.core) return;
    scanStatus = 'Scanning…';
    try {
      await T.core.invoke('set_overrides', { map: studio.ovrGet() });
      studio.env = JSON.parse(await T.core.invoke('env_check'));
      scanStatus = '';
    } catch (e) {
      scanStatus = 'Scan failed: ' + (e?.message || e);
    }
  }

  onMount(() => {
    scanEnv();
    const T = getTauri();
    let unlisten;
    T?.event?.listen('setup-log', (e) => (logText += String(e.payload) + '\n')).then((u) => (unlisten = u));
    return () => unlisten?.();
  });

  async function saveOverrides() {
    localStorage.icsOvr = JSON.stringify(ovr);
    await scanEnv();
    studio.toast('Saved binary paths & keys');
  }
</script>

<div class="full-page">
  <div style="max-width:820px;margin:0 auto">
    <CategoryBlock title="Environment, Binaries & API Keys" icon="settings" open={true}>
      <div class="bar">
        <button type="button" class="pri sm" onclick={scanEnv}>Re-scan Environment</button>
        <span class="hint" style="margin:0">{scanStatus}</span>
      </div>

      {#each envItems as it}
        <div class="sub-card rt" style="justify-content:space-between">
          <div>
            <div class="rt" style="gap:6px">
              <span class="badge" class:ok={it.ok} class:err={!it.ok && it.req}>
                {it.ok ? 'Ready' : it.req ? 'Required' : 'Optional'}
              </span>
              <b>{it.name}</b>
            </div>
            <div class="hint" style="margin:2px 0 0;font-size:11px">{it.detail || 'Not detected'}</div>
          </div>
          {#if !it.ok && it.inst}
            <button
              type="button"
              class="xs"
              onclick={async () => {
                try {
                  await getTauri().core.invoke('install_tool', { name: it.inst });
                  await scanEnv();
                } catch (e) {
                  logText += 'Error: ' + e + '\n';
                }
              }}
            >
              Install
            </button>
          {/if}
        </div>
      {/each}

      <div class="style-control-group-heading" style="margin-top:12px">Custom Paths & API Keys</div>
      <div class="sg">
        <label>Python path<input bind:value={ovr.python} placeholder="python.exe" /></label>
        <label>yt-dlp path<input bind:value={ovr['yt-dlp']} placeholder="yt-dlp.exe" /></label>
        <label>FFmpeg path<input bind:value={ovr.ffmpeg} placeholder="ffmpeg.exe" /></label>
        <label>Hugging Face token<input type="password" bind:value={ovr.hf_token} placeholder="hf_..." /></label>
        <label style="grid-column:1/3">
          ElevenLabs API key (Scribe v2 / v1)
          <div class="rt" style="margin-top:4px">
            <input type="password" bind:value={ovr.elevenlabs_key} placeholder="xi-api-key" style="flex:1" />
            <button
              type="button"
              class="sm"
              onclick={async () => {
                elStatus = 'Testing…';
                try {
                  elStatus = 'OK: ' + (await getTauri().core.invoke('test_elevenlabs', { key: ovr.elevenlabs_key || '' }));
                } catch (e) {
                  elStatus = 'Error: ' + (e?.message || e);
                }
              }}
            >
              Test key
            </button>
          </div>
        </label>
      </div>
      <div class="bar" style="margin-top:10px;margin-bottom:0">
        <button type="button" class="pri sm" onclick={saveOverrides}>Save & Re-scan</button>
        <span class="hint" style="margin:0">{elStatus}</span>
      </div>
      {#if logText}
        <pre class="console mono">{logText}</pre>
      {/if}
    </CategoryBlock>
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
    height: 130px;
    overflow: auto;
    font-size: 11px;
    margin: 10px 0 0;
  }
</style>
