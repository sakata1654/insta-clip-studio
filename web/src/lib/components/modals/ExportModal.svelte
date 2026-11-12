<script>
  import { exportAll, makeThumb, saveBlob, shareBlob } from '../../renderer.js';
  import { fmt, studio } from '../../state.svelte.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import Icon from '../Icon.svelte';
  import StyleFieldRow from '../StyleFieldRow.svelte';

  let tab = $state('basic'); // 'basic' | 'caption' | 'queue'
  let advOpen = $state(false);
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
    if (studio.exportModalOpen) {
      startField = fmt(studio.trimS);
      endField = fmt(studio.trimE);
      if (!capTitle && studio.meta?.title) capTitle = studio.meta.title;
      if (!capLink && studio.meta?.link) capLink = studio.meta.link;
      if (!capSpk && studio.spk.text) capSpk = studio.spk.text.replace(/\|/g, ' – ');
    }
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
    studio.toast(`Clip range set: ${fmt(a)} – ${fmt(b)}`);
  }

  function buildCaption() {
    if (!capExp.trim()) capExp = studio.subs.map((s) => (s.t || '').replace(/\|/g, ' ').trim()).filter(Boolean).join(' ');
    const L = [];
    if (capTitle.trim()) L.push(capTitle.trim(), '');
    if (capExp.trim()) L.push(capExp.trim(), '');
    const M = [];
    if (capSpk.trim()) M.push('Speaker: ' + capSpk.trim());
    if (capLink.trim()) M.push('Full Video: ' + capLink.trim());
    if (capStart.trim() || capEnd.trim()) M.push(`Timestamp: ${capStart.trim()} – ${capEnd.trim()}`);
    if (M.length) L.push('—', ...M);
    capOut = L.join('\n').trim() + '\n';
  }
</script>

{#if studio.exportModalOpen}
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    aria-label="Export Video & Captions"
    tabindex="-1"
    onkeydown={(e) => e.key === 'Escape' && (studio.exportModalOpen = false)}
    onclick={(e) => e.target === e.currentTarget && (studio.exportModalOpen = false)}
  >
    <div class="modal-card export-modal">
      <div class="rt" style="justify-content:space-between;margin-bottom:10px">
        <div class="rt" style="gap:8px">
          <Icon name="upload" size={16} />
          <h3 style="margin:0">Export Project</h3>
        </div>
        <button type="button" class="xs ghost" onclick={() => (studio.exportModalOpen = false)} aria-label="Close export dialog">✕</button>
      </div>

      <div class="seg-pills tri">
        <button type="button" class:on={tab === 'basic'} onclick={() => (tab = 'basic')}>Video Export</button>
        <button type="button" class:on={tab === 'caption'} onclick={() => (tab = 'caption')}>Social Caption</button>
        <button type="button" class:on={tab === 'queue'} onclick={() => (tab = 'queue')}>
          Queue {#if studio.exportJobs.length}({studio.exportJobs.length}){/if}
        </button>
      </div>

      {#if tab === 'basic'}
        <CategoryBlock title="Basic Settings" icon="sliders" open={true}>
          <div class="sg">
            <label>Clip Start<input bind:value={startField} /></label>
            <label>Clip End<input bind:value={endField} /></label>
          </div>
          <div class="bar" style="margin-top:6px">
            <button type="button" class="xs" onclick={() => ((studio.trimS = Math.min(studio.currentPlayhead(), studio.trimE - 0.2)), studio.inv())}>Set Start</button>
            <button type="button" class="xs" onclick={() => ((studio.trimE = Math.max(studio.currentPlayhead(), studio.trimS + 0.2)), studio.inv())}>Set End</button>
            <button type="button" class="xs" onclick={() => ((studio.trimS = 0), (studio.trimE = studio.dur || studio.audioDuration || 0), studio.inv())}>Full Video</button>
            <button type="button" class="xs" onclick={applyRange}>Apply Range</button>
          </div>
          <StyleFieldRow
            label="Resolution"
            type="select"
            value={studio.ex.res || 'source'}
            options={[['source', 'Original Canvas'], ['1080', '1080p Full HD'], ['720', '720p Fast Web']]}
            onchange={(v) => (studio.ex.res = v)}
          />
          <StyleFieldRow
            label="Frame rate"
            type="select"
            value={String(studio.ex.fps || 30)}
            options={[['24', '24 fps'], ['30', '30 fps'], ['60', '60 fps']]}
            onchange={(v) => (studio.ex.fps = +v)}
          />
          <div class="hint" style="margin-bottom:2px">Duration: {fmt(Math.max(0, studio.trimE - studio.trimS))} · {studio.aspect}</div>
        </CategoryBlock>

        <button type="button" class="adv-toggle" onclick={() => (advOpen = !advOpen)}>
          <span>Advanced Encoding Options</span>
          <span class="mono">{advOpen ? '−' : '+'}</span>
        </button>
        {#if advOpen}
          <div class="adv-box">
            <StyleFieldRow label="Video bitrate (Mbps)" value={studio.ex.bitrate || 10} min={2} max={32} step={1} onchange={(v) => (studio.ex.bitrate = v)} />
            <StyleFieldRow
              label="Browser encoder"
              type="select"
              value={studio.ex.encoder || 'auto'}
              options={[['auto', 'Auto (WebCodecs MP4 / Fallback)'], ['webcodecs', 'WebCodecs Hardware'], ['mediarecorder', 'MediaRecorder']]}
              onchange={(v) => (studio.ex.encoder = v)}
            />
          </div>
        {/if}

        <div class="bar" style="margin-top:12px;margin-bottom:0">
          <button
            type="button"
            class="pri"
            style="flex:1"
            onclick={() => {
              exportAll();
              tab = 'queue';
            }}
          >
            Start Background Export
          </button>
          <button
            type="button"
            class="sm"
            onclick={async () => {
              const b = await makeThumb(studio.V, studio.C);
              if (b) saveBlob(b, 'thumbnail.png');
              else studio.toast('Open a video first');
            }}
          >
            Save Thumbnail
          </button>
        </div>
        <p class="hint" style="margin:6px 0 0">Renders in your browser so you can continue editing.</p>
      {:else if tab === 'caption'}
        <div class="sg" style="grid-template-columns:1fr">
          <label>Title<input bind:value={capTitle} placeholder="Clip title" /></label>
          <label>Speaker<input bind:value={capSpk} placeholder="Speaker name" /></label>
          <label>Reference Link<input bind:value={capLink} placeholder="https://…" /></label>
          <label>Transcript / Notes<textarea rows="3" bind:value={capExp}></textarea></label>
        </div>
        <div class="bar" style="margin-top:8px">
          <button type="button" class="pri sm" onclick={buildCaption}>Generate Caption</button>
          <button type="button" class="sm" disabled={!capOut} onclick={() => navigator.clipboard.writeText(capOut).then(() => studio.toast('Copied'))}>Copy</button>
          <button type="button" class="sm" disabled={!capOut} onclick={() => saveBlob(new Blob([capOut], { type: 'text/plain' }), 'caption.txt')}>Save .txt</button>
        </div>
        <textarea rows="5" style="width:100%" bind:value={capOut} placeholder="Generated social caption appears here…"></textarea>
      {:else}
        {#if studio.exportJobs.length}
          <div class="bar" style="justify-content:flex-end;margin-bottom:8px">
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
              <div class="rt" style="justify-content:space-between">
                <span class="hint" style="margin:0;font-size:11px">{j.label}</span>
                <div class="rt" style="gap:4px">
                  {#if j.blob && typeof navigator !== 'undefined' && navigator.share}
                    <button type="button" class="xs" onclick={() => shareBlob(j.blob, j.filename || `${j.name}.mp4`)}>Share</button>
                  {/if}
                  {#if !j.done && j.cancel}
                    <button type="button" class="xs danger" onclick={() => j.cancel()}>Cancel</button>
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        {:else}
          <div class="sub-card" style="text-align:center;padding:22px">
            <div style="font-weight:600;margin-bottom:4px">No Exports Running</div>
            <p class="hint" style="margin:0 0 10px">Start a video export from the Video Export tab to track progress here.</p>
            <button type="button" class="sm pri" onclick={() => (tab = 'basic')}>Go to Video Export</button>
          </div>
        {/if}
      {/if}
    </div>
  </div>
{/if}

<style>
  .export-modal {
    width: min(520px, 94vw);
    max-height: 88vh;
    overflow-y: auto;
  }
</style>
