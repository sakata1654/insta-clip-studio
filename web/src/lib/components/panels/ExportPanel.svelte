<script>
  import { exportAll, makeThumb, saveBlob } from '../../renderer.js';
  import { fmt, studio } from '../../state.svelte.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import StyleFieldRow from '../StyleFieldRow.svelte';

  let { modeTab = 'exp' } = $props(); // 'exp' | 'aud' | 'cap'
  let startField = $state(fmt(studio.trimS));
  let endField = $state(fmt(studio.trimE));
  let capTitle = $state(studio.meta?.title || '');
  let capLink = $state(studio.meta?.link || '');
  let capStart = $state(studio.meta?.start || '');
  let capEnd = $state(studio.meta?.end || '');
  let capSpk = $state((studio.spk.text || '').replace(/\|/g, ' – '));
  let capExp = $state('');
  let capOut = $state('');

  $effect(() => {
    startField = fmt(studio.trimS);
    endField = fmt(studio.trimE);
  });

  function parseTimeField(value) {
    const raw = String(value || '').trim();
    if (!raw) return NaN;
    if (/^\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
    const parts = raw.split(':');
    if (parts.length > 3 || parts.some((x) => x.trim() === '' || !/^\d+(?:\.\d+)?$/.test(x.trim()))) return NaN;
    return parts.map(Number).reduce((a, n) => a * 60 + n, 0);
  }

  function applyRange() {
    const a = parseTimeField(startField);
    const b = parseTimeField(endField);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b <= a) return studio.toast('Enter valid start/end timestamps');
    studio.trimS = a;
    studio.trimE = b;
    studio.inv();
    studio.toast(`Range set: ${fmt(a)} – ${fmt(b)}`);
  }

  function buildCaption() {
    if (!capExp.trim()) capExp = studio.subs.map((s) => (s.t || '').replace(/\|/g, ' ').trim()).filter(Boolean).join(' ');
    const L = [];
    if (capTitle.trim()) L.push('🎬 ' + capTitle.trim(), '');
    if (capExp.trim()) L.push(capExp.trim(), '');
    const M = [];
    if (capSpk.trim()) M.push('🎙️ Speaker: ' + capSpk.trim());
    if (capLink.trim()) M.push('🔗 Full Video: ' + capLink.trim());
    if (capStart.trim() || capEnd.trim()) M.push(`⏱️ Clip Timestamp: ${capStart.trim()} – ${capEnd.trim()}`);
    if (M.length) {
      const d = '─'.repeat(28);
      L.push(d, ...M, d);
    }
    capOut = L.join('\n').trim() + '\n';
  }
</script>

{#if modeTab === 'exp'}
  <CategoryBlock title="Clip Export Range" icon="scissors" open={true}>
    <div class="sg">
      <label>Start<input bind:value={startField} /></label>
      <label>End<input bind:value={endField} /></label>
    </div>
    <div class="bar" style="margin-top:8px">
      <button type="button" class="xs" onclick={() => ((studio.trimS = Math.min(studio.currentPlayhead(), studio.trimE - 0.2)), studio.inv())}>Start = Playhead</button>
      <button type="button" class="xs" onclick={() => ((studio.trimE = Math.max(studio.currentPlayhead(), studio.trimS + 0.2)), studio.inv())}>End = Playhead</button>
      <button type="button" class="xs" onclick={applyRange}>Apply</button>
    </div>
    <div class="hint">Selected {fmt(studio.trimE - studio.trimS)} of {fmt(studio.dur)}</div>
  </CategoryBlock>

  <CategoryBlock title="MP4 Quality & Web Encoder" icon="upload" open={true}>
    <StyleFieldRow
      label="Output resolution"
      type="select"
      value={studio.ex.res || 'source'}
      options={[
        ['source', 'Original Canvas Size'],
        ['1080', '1080p Full HD'],
        ['720', '720p Fast Web'],
      ]}
      onchange={(v) => (studio.ex.res = v)}
    />
    <StyleFieldRow
      label="Frame rate (FPS)"
      type="select"
      value={String(studio.ex.fps || 30)}
      options={[
        ['24', '24 fps (Cinematic)'],
        ['30', '30 fps (Standard)'],
        ['60', '60 fps (Smooth)'],
      ]}
      onchange={(v) => (studio.ex.fps = +v)}
    />
    <StyleFieldRow label="Video bitrate (Mbps)" value={studio.ex.bitrate || 10} min={2} max={32} step={1} onchange={(v) => (studio.ex.bitrate = v)} />
    <StyleFieldRow
      label="Browser encoder"
      type="select"
      value={studio.ex.encoder || 'auto'}
      options={[
        ['auto', studio.caps?.webcodecsH264 ? 'Auto (WebCodecs MP4)' : 'Auto (MediaRecorder)'],
        ['webcodecs', 'WebCodecs H.264 MP4 Worker'],
        ['mediarecorder', 'MediaRecorder Fallback'],
      ]}
      onchange={(v) => (studio.ex.encoder = v)}
    />
    <StyleFieldRow label="Export .SRT + .JSON archive" type="check" value={studio.ex.arch} onchange={(v) => (studio.ex.arch = v ? 1 : 0)} />
    <div class="bar" style="margin-top:8px">
      <button type="button" class="pri" style="flex:1" onclick={() => exportAll()}>Export MP4 in Background</button>
      <button
        type="button"
        class="sm"
        onclick={async () => {
          const b = await makeThumb(studio.V, studio.C);
          if (b) saveBlob(b, 'thumbnail.png');
          else studio.toast('Open a video first');
        }}
      >
        Thumbnail
      </button>
    </div>
    <p class="hint" style="margin:4px 0 0">Processed 100% locally in a background Worker — no video upload required.</p>
  </CategoryBlock>

  {#if studio.exportJobs.length}
    <CategoryBlock title="Background Export Queue ({studio.exportJobs.length})" icon="layers" open={true}>
      <div class="bar" style="justify-content:flex-end;margin-bottom:6px">
        {#if studio.exportJobs.some((j) => j.done)}
          <button type="button" class="xs ghost" onclick={() => studio.clearFinishedJobs()}>Clear Finished</button>
        {/if}
      </div>
      {#each studio.exportJobs as j (j.id)}
        <div class="sub-card">
          <div class="rt" style="justify-content:space-between;gap:6px">
            <b style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{j.name}</b>
            <span class="badge" class:ok={j.done && !j.error} class:err={j.error} class:pri={!j.done}>
              {j.done ? (j.error ? 'Failed' : 'Done') : `${j.pct}%`}
            </span>
          </div>
          <div class="pbar" style="margin:6px 0"><i style="width:{j.pct}%"></i></div>
          <div class="rt" style="justify-content:space-between;gap:6px">
            <span class="hint" style="margin:0;font-size:11px">{j.label}</span>
            {#if !j.done && j.cancel}
              <button type="button" class="xs danger" onclick={() => j.cancel()}>Cancel</button>
            {:else if j.done && !j.error && j.downloadUrl}
              <a class="btn xs pri" href={j.downloadUrl} download={j.filename || 'export.mp4'}>Download</a>
            {/if}
          </div>
        </div>
      {/each}
    </CategoryBlock>
  {/if}
{:else if modeTab === 'aud'}
  <CategoryBlock title="Browser Audio Mixing & Desktop FX Notice" icon="sparkles" open={true}>
    <StyleFieldRow
      label="Added music / track level"
      value={studio.aud.musicVol ?? 100}
      min={0}
      max={150}
      unit="%"
      onchange={(v) => {
        studio.aud.musicVol = v;
        if (studio.A) studio.A.volume = Math.min(1, v / 100);
      }}
    />
    <div class="sub-card" style="margin-top:8px">
      <div class="rt" style="justify-content:space-between">
        <b style="font-size:11.5px">Demucs AI Vocal Separation &amp; FFmpeg LUFS Chain</b>
        <span class="badge">Desktop Only</span>
      </div>
      <div class="hint" style="margin:4px 0 0">
        Heavyweight PyTorch vocal isolation (Demucs) and multi-stage FFmpeg filters require the desktop Tauri app. Browser WebCodecs cleanly mixes trimmed source + imported audio tracks locally into 48 kHz AAC MP4.
      </div>
    </div>
  </CategoryBlock>
{:else}
  <CategoryBlock title="Social Caption Builder" icon="type" open={true}>
    <div class="sg" style="grid-template-columns:1fr">
      <label>Title<input bind:value={capTitle} /></label>
      <label>Speaker<input bind:value={capSpk} /></label>
      <label>Link<input bind:value={capLink} /></label>
      <label>Explanation / Transcript<textarea rows="3" bind:value={capExp}></textarea></label>
    </div>
    <div class="bar" style="margin-top:8px">
      <button type="button" class="pri sm" onclick={buildCaption}>Build caption</button>
      <button type="button" class="sm" onclick={() => navigator.clipboard.writeText(capOut).then(() => studio.toast('Copied'))}>Copy</button>
      <button type="button" class="sm" onclick={() => saveBlob(new Blob([capOut], { type: 'text/plain' }), 'caption.txt')}>Save .txt</button>
    </div>
    <textarea rows="6" style="width:100%" bind:value={capOut}></textarea>
  </CategoryBlock>
{/if}
