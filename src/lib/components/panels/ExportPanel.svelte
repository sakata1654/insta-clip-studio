<script>
  import { exportAll, makeThumb, saveBlob } from '../../renderer.js';
  import { fmt, studio } from '../../state.svelte.js';
  import { getTauri } from '../../tauriBridge.js';
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

  <CategoryBlock title="MP4 Quality & Output" icon="upload" open={true}>
    <StyleFieldRow label="Auto-archive files" type="check" value={studio.ex.arch} onchange={(v) => (studio.ex.arch = v ? 1 : 0)} />
    <StyleFieldRow label="CRF quality" value={studio.ex.crf} min={14} max={28} onchange={(v) => (studio.ex.crf = v)} />
    <div class="bar" style="margin-top:8px">
      <button type="button" class="pri" style="flex:1" disabled={studio.exporting} onclick={() => exportAll()}>Export MP4 Video</button>
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
    <div class="pbar"><i style="width:{studio.exportPct}%"></i></div>
    <div class="hint" style="margin-bottom:2px">{studio.exportLabel}</div>
    {#if studio.exportStatus}
      <div class="hint">{studio.exportStatus}</div>
    {/if}
  </CategoryBlock>
{:else if modeTab === 'aud'}
  <CategoryBlock title="Audio Mastering & Vocal Separation" icon="sparkles" open={true}>
    <StyleFieldRow label="Studio enhance" type="check" value={studio.aud.enh} onchange={(v) => (studio.aud.enh = v ? 1 : 0)} />
    <StyleFieldRow label="Strip music (Demucs)" type="check" value={studio.aud.vocals} onchange={(v) => (studio.aud.vocals = v ? 1 : 0)} />
    <StyleFieldRow
      label="Demucs model"
      type="select"
      value={studio.aud.model}
      options={[
        ['htdemucs', 'htdemucs (fast)'],
        ['htdemucs_ft', 'htdemucs_ft (cleaner)'],
      ]}
      onchange={(v) => (studio.aud.model = v)}
    />
    <div class="bar" style="margin-top:8px">
      <button
        type="button"
        class="sm"
        onclick={async () => {
          const p = await getTauri()?.dialog?.open({ filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac', 'aac'] }] });
          if (p) studio.aud.pre = p;
        }}
      >
        Pre-enhanced audio…
      </button>
      {#if studio.aud.pre}
        <button type="button" class="xs" onclick={() => (studio.aud.pre = '')}>Clear</button>
      {/if}
    </div>
    <div class="hint">{studio.aud.pre ? 'Using: ' + studio.aud.pre.split(/[\\/]/).pop() : 'Chain: declip → high-pass → afftdn denoise → EQ → compression → -16 LUFS loudnorm.'}</div>
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
