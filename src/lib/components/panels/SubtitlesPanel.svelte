<script>
  import { FONTS } from '../../constants.js';
  import { transcriptionDuration, transcriptionPath } from '../../mediaHelpers.js';
  import {
    aiProofreadAsr,
    aiSemanticRearrange,
    applyGenreSegmentation,
    applySubtitlePadding,
    segsToSubs,
  } from '../../prompts.js';
  import { saveBlob } from '../../renderer.js';
  import { fmt, fvtt, fts, studio } from '../../state.svelte.js';
  import { getTauri } from '../../tauriBridge.js';
  import CategoryBlock from '../CategoryBlock.svelte';

  let eng = $state(typeof localStorage !== 'undefined' ? localStorage.icsAsrEngine || 'auto' : 'auto');
  let elModel = $state(typeof localStorage !== 'undefined' ? localStorage.getItem('icsElModel') || 'scribe_v2' : 'scribe_v2');
  let elKey = $state(studio.ovrGet().elevenlabs_key || '');
  let elDiarize = $state(false);
  let elTags = $state(false);
  let elKeyStatus = $state('');

  let lang = $state('ur');
  let genre = $state('speech');
  let whisperModel = $state('auto');
  let customModel = $state('');
  let hints = $state('');
  let carryCtx = $state(false);
  let deterministic = $state(false);
  let translateToEn = $state(false);

  let busy = $state(false);
  let asrPct = $state(0);
  let asrStatus = $state('');
  let aiFixes = $state(null);

  let subSearch = $state('');
  let frFind = $state('');
  let frRep = $state('');
  let srtInput = $state(null);

  $effect(() => {
    const T = getTauri();
    if (!T?.event) return;
    let unlisten;
    T.event.listen('whisper-log', (e) => {
      const p = String(e.payload || '');
      const x = /extract-progress=(\d+)%/.exec(p);
      const m = /progress\s*=\s*(\d+)%/.exec(p);
      if (x) {
        asrPct = +x[1];
        asrStatus = `Extracting audio… ${x[1]}%`;
      } else if (p.startsWith('phase=uploading-elevenlabs')) {
        asrPct = 65;
        asrStatus = `Transcribing via ElevenLabs (${p.split(':')[1] || elModel})…`;
      } else if (p === 'phase=loading-model') {
        asrPct = 10;
        asrStatus = 'Audio ready — loading model…';
      } else if (m) {
        asrPct = +m[1];
        asrStatus = `Transcribing… ${m[1]}%`;
      }
    }).then((u) => (unlisten = u));
    return () => unlisten?.();
  });

  const visibleSubs = $derived(
    subSearch.trim()
      ? studio.subs.filter(
          (o) =>
            (o.t || '').toLowerCase().includes(subSearch.trim().toLowerCase()) ||
            (o.orig || '').toLowerCase().includes(subSearch.trim().toLowerCase())
        )
      : studio.subs
  );

  function setEngineMode(v) {
    eng = v;
    try {
      localStorage.icsAsrEngine = v;
    } catch {}
  }

  async function saveElevenLabsKey() {
    const o = studio.ovrGet();
    o.elevenlabs_key = elKey.trim();
    localStorage.icsOvr = JSON.stringify(o);
    await getTauri().core.invoke('set_overrides', { map: o });
    elKeyStatus = o.elevenlabs_key ? 'Key saved ✔' : 'Key cleared';
    studio.toast('ElevenLabs key saved');
  }

  async function testElevenLabsKey() {
    const key = elKey.trim() || studio.ovrGet().elevenlabs_key || '';
    if (!key) return (elKeyStatus = '❌ Enter an ElevenLabs API key first');
    elKeyStatus = 'Testing key…';
    try {
      const res = await getTauri().core.invoke('test_elevenlabs', { key });
      elKeyStatus = '✅ ' + res;
    } catch (e) {
      elKeyStatus = '❌ ' + (e?.message || e);
    }
  }

  function routeEngine() {
    if (eng !== 'auto') return eng;
    const c = studio.env?.cohere || {};
    if ((lang === 'ar' || lang === 'en') && c.runtime && c.token && (c.models || []).includes(lang === 'ar' ? 'arabic' : 'general')) {
      return 'cohere';
    }
    return 'faster';
  }

  async function runTranscribe() {
    if (!studio.file && !studio.aud.track) return studio.toast('Open a video or add an audio asset first.');
    const T = getTauri();
    busy = true;
    asrPct = 0;
    try {
      const routed = routeEngine();
      const model = routed === 'elevenlabs' ? elModel : customModel.trim() || whisperModel;
      const keyToUse = routed === 'elevenlabs' ? elKey.trim() || studio.ovrGet().elevenlabs_key || '' : '';
      if (routed === 'elevenlabs' && !keyToUse) throw new Error('Save your ElevenLabs API key first.');

      asrStatus = 'Preparing audio…';
      const input = await transcriptionPath();
      const durHint = await transcriptionDuration();
      const rawOut = await T.core.invoke('transcribe', {
        input,
        lang,
        maxlen: studio.subCfg.maxChars,
        maxWords: studio.subCfg.maxWords,
        translate: translateToEn,
        model,
        prompt: hints.trim(),
        ctx: carryCtx,
        det: deterministic,
        engine: routed,
        durationHint: durHint,
        diarize: elDiarize,
        tagAudioEvents: elTags,
        elevenlabsKey: keyToUse || null,
      });

      const out = JSON.parse(rawOut);
      const mc = studio.subCfg.maxChars || 84;
      const mw = studio.subCfg.maxWords || 12;
      const md = studio.subCfg.maxDur || 8;
      const rawSubs = out.segments
        ? segsToSubs(out.segments, mc, mw, md, () => studio.nextId())
        : studio.parseSRT(out.srt);
      const segSubs = applyGenreSegmentation(rawSubs.sort((x, y) => x.s - y.s), genre, { maxChars: mc, maxWords: mw, maxDur: md });
      studio.subs = applySubtitlePadding(
        segSubs,
        studio.subCfg.padBeforeMs,
        studio.subCfg.padAfterMs,
        studio.dur || studio.audioDuration || durHint || 0
      );
      studio.expandPipeSubtitles(false);
      asrPct = 100;
      const label = out.engine === 'elevenlabs' ? `ElevenLabs ${out.model || elModel}` : out.engine === 'cohere' ? 'Cohere Transcribe' : 'Whisper';
      asrStatus = `${studio.subs.length} subtitles created with ${label} (max ${mw}w · pad −${studio.subCfg.padBeforeMs}/+${studio.subCfg.padAfterMs}ms).`;
      studio.inv();
      studio.snap();
    } catch (e) {
      asrStatus = '❌ ' + (e?.message || e);
    } finally {
      busy = false;
    }
  }

  async function runAiRearrange() {
    if (!studio.subs.length) return studio.toast('Transcribe or add subtitles first');
    const cfg = studio.TR.key || studio.TR.prov === 'ollama' ? studio.TR : studio.API;
    if (!cfg.key && cfg.prov !== 'ollama') {
      studio.apiModalOpen = true;
      return studio.toast('Configure an AI API key first');
    }
    busy = true;
    try {
      const grouped = await aiSemanticRearrange(studio.subs, cfg, studio.subCfg, (m) => (asrStatus = m));
      const withIds = grouped.map((x) => ({ id: studio.nextId(), ...x }));
      studio.subs = applySubtitlePadding(withIds, studio.subCfg.padBeforeMs, studio.subCfg.padAfterMs, studio.dur || studio.audioDuration || 0);
      studio.inv();
      studio.snap();
      asrStatus = `AI rearranged phrasing into ${studio.subs.length} natural subtitles.`;
    } catch (e) {
      asrStatus = '❌ ' + (e?.message || e);
    } finally {
      busy = false;
    }
  }

  async function runAiProofread() {
    if (!studio.subs.length) return studio.toast('No subtitles to proofread');
    const cfg = studio.TR.key || studio.TR.prov === 'ollama' ? studio.TR : studio.API;
    if (!cfg.key && cfg.prov !== 'ollama') {
      studio.apiModalOpen = true;
      return studio.toast('Configure an AI API key first');
    }
    busy = true;
    try {
      aiFixes = await aiProofreadAsr(studio.subs, cfg, (m) => (asrStatus = m));
      asrStatus = `Scan complete: ${aiFixes.corrections.length} suggestion(s), ${aiFixes.warnings.length} uncertain passage(s).`;
    } catch (e) {
      asrStatus = '❌ ' + (e?.message || e);
    } finally {
      busy = false;
    }
  }

  function applyCorrection(c) {
    const sub = studio.subs.find((s) => s.id === c.id);
    if (!sub) return;
    sub.t = c.after;
    if (sub.orig !== undefined) sub.orig = c.after;
    aiFixes.corrections = aiFixes.corrections.filter((x) => x.id !== c.id);
    studio.inv();
    studio.snap();
  }

  const shiftAll = (delta) => {
    studio.subs.forEach((s) => {
      s.s = Math.max(0, +(s.s + delta).toFixed(3));
      s.e = Math.max(s.s + 0.1, +(s.e + delta).toFixed(3));
      if (s.rawS !== undefined) s.rawS = Math.max(0, +(s.rawS + delta).toFixed(3));
      if (s.rawE !== undefined) s.rawE = Math.max(s.rawS + 0.1, +(s.rawE + delta).toFixed(3));
    });
    studio.inv();
    studio.snap();
  };
</script>

<input
  bind:this={srtInput}
  type="file"
  accept=".srt,.txt"
  hidden
  onchange={async (e) => {
    const f = e.currentTarget.files?.[0];
    if (!f) return;
    studio.subs = studio.parseSRT(await f.text());
    studio.inv();
    studio.snap();
    studio.toast(`${studio.subs.length} subtitles imported`);
    e.currentTarget.value = '';
  }}
/>

<CategoryBlock title="Transcription Engine (Whisper / ElevenLabs Scribe 2)" icon="subtitles" open={true}>
  <div class="seg-pills">
    <button type="button" class:on={eng !== 'elevenlabs'} onclick={() => setEngineMode('auto')}>Whisper / Local</button>
    <button type="button" class:on={eng === 'elevenlabs'} onclick={() => setEngineMode('elevenlabs')}>ElevenLabs Scribe 2</button>
  </div>

  <label class="field-label">
    Engine selection
    <select value={eng} onchange={(e) => setEngineMode(e.currentTarget.value)}>
      <option value="auto">Auto — best local model per language</option>
      <option value="elevenlabs">ElevenLabs Scribe (Cloud API · Scribe v2 / v1)</option>
      <option value="faster">Whisper — faster-whisper (Python)</option>
      <option value="cohere">Cohere Transcribe (EN / AR only)</option>
      <option value="cpp">Whisper — whisper.cpp</option>
    </select>
  </label>

  {#if eng === 'elevenlabs'}
    <div class="sub-card">
      <div class="rt" style="justify-content:space-between;margin-bottom:6px">
        <b style="font-size:12px">ElevenLabs Cloud STT</b>
        <span class="badge pri">{elModel}</span>
      </div>
      <select
        style="width:100%;margin-bottom:6px"
        bind:value={elModel}
        onchange={() => {
          try {
            localStorage.setItem('icsElModel', elModel);
          } catch {}
        }}
      >
        <option value="scribe_v2">Scribe v2 (scribe_v2) — Highest accuracy + keyterms</option>
        <option value="scribe_v1">Scribe v1 (scribe_v1) — Classic</option>
      </select>
      <div class="rt">
        <input type="password" bind:value={elKey} placeholder="xi-api-key" style="flex:1;min-width:0" />
        <button type="button" class="xs" onclick={saveElevenLabsKey}>Save</button>
        <button type="button" class="xs" onclick={testElevenLabsKey}>Test</button>
      </div>
      <div class="hint" style="margin:4px 0 6px">{elKeyStatus}</div>
      <div class="rt" style="gap:12px;flex-wrap:wrap">
        <label class="chk-lbl"><input type="checkbox" bind:checked={elDiarize} /> Speaker labels</label>
        <label class="chk-lbl"><input type="checkbox" bind:checked={elTags} /> Audio events</label>
      </div>
    </div>
  {:else if eng !== 'cohere'}
    <select style="width:100%;margin-top:6px" bind:value={whisperModel}>
      <option value="auto">Model: auto (large-v3 → distil-large-v3 → medium)</option>
      <option value="large-v3">large-v3</option>
      <option value="distil-large-v3">distil-large-v3</option>
      <option value="medium">medium</option>
      <option value="small">small</option>
      <option value="base">base</option>
    </select>
    <input bind:value={customModel} placeholder="Custom HF model ID (optional)" style="width:100%;margin-top:6px" />
  {/if}

  <div class="sg">
    <label>
      Language
      <select bind:value={lang}>
        <option value="ur">Urdu</option>
        <option value="hi">Hindi</option>
        <option value="ar">Arabic</option>
        <option value="auto">Auto-detect</option>
        <option value="en">English</option>
        <option value="fa">Persian</option>
        <option value="tr">Turkish</option>
        <option value="id">Indonesian</option>
        <option value="fr">French</option>
        <option value="es">Spanish</option>
      </select>
    </label>
    <label>
      Content type
      <select bind:value={genre}>
        <option value="speech">Speech / lecture</option>
        <option value="poetry">Poem / qasida</option>
        <option value="religious">Religious / hadith</option>
      </select>
    </label>
  </div>

  <!-- Max 8 words & 500ms before/after padding card -->
  <div class="sub-card">
    <div class="rt" style="justify-content:space-between;margin-bottom:4px">
      <b style="font-size:11.5px">Max Words & Timing Padding</b>
      <button type="button" class="xs" onclick={() => studio.rewrapAndPad()}>✂ Re-wrap & Pad</button>
    </div>
    <div class="sg" style="grid-template-columns:1fr 1fr 1fr">
      <label>Max words<input type="number" min="0" max="40" bind:value={studio.subCfg.maxWords} /></label>
      <label>Max chars<input type="number" min="0" max="160" bind:value={studio.subCfg.maxChars} /></label>
      <label>Max sec<input type="number" min="0" max="20" step="0.5" bind:value={studio.subCfg.maxDur} /></label>
    </div>
    <div class="sg" style="grid-template-columns:1fr 1fr">
      <label>Pad before (ms)<input type="number" min="0" max="2000" step="50" bind:value={studio.subCfg.padBeforeMs} /></label>
      <label>Pad after (ms)<input type="number" min="0" max="2000" step="50" bind:value={studio.subCfg.padAfterMs} /></label>
    </div>
  </div>

  <input bind:value={hints} placeholder="Keyterms / vocabulary hints (comma-separated)" style="width:100%;margin-top:6px" />

  {#if eng !== 'elevenlabs' && eng !== 'cohere'}
    <div style="display:flex;flex-direction:column;gap:5px;margin-top:6px">
      <label class="chk-lbl"><input type="checkbox" bind:checked={carryCtx} /> Carry context across chunks</label>
      <label class="chk-lbl"><input type="checkbox" bind:checked={deterministic} /> Deterministic decoding</label>
      <label class="chk-lbl"><input type="checkbox" bind:checked={translateToEn} /> Whisper translate → English</label>
    </div>
  {/if}

  <div class="bar" style="margin-top:8px;margin-bottom:4px">
    <button type="button" class="pri" style="flex:1" disabled={busy} onclick={runTranscribe}>
      {busy ? 'Working…' : 'Generate Subtitles'}
    </button>
    <button type="button" class="sm" disabled={busy || !studio.subs.length} onclick={runAiRearrange} title="Minbar AI Semantic Boundary Rearranger">
      ✨ AI Arrange
    </button>
    <button type="button" class="sm" disabled={busy || !studio.subs.length} onclick={runAiProofread} title="Minbar Conservative ASR Proofreader">
      🔎 Proofread
    </button>
  </div>

  <div class="pbar"><i style="width:{asrPct}%"></i></div>
  {#if asrStatus}
    <div class="hint" style="margin-bottom:2px">{asrStatus}</div>
  {/if}
</CategoryBlock>

{#if aiFixes && (aiFixes.corrections.length || aiFixes.warnings.length)}
  <CategoryBlock title="AI Proofread Suggestions ({aiFixes.corrections.length + aiFixes.warnings.length})" icon="sparkles" open={true}>
    {#each aiFixes.corrections as c (c.id)}
      <div class="sub-card">
        <div class="rt" style="justify-content:space-between">
          <span class="badge ok">Correction · {Math.round((c.confidence || 0.99) * 100)}%</span>
          <button type="button" class="xs pri" onclick={() => applyCorrection(c)}>Apply fix</button>
        </div>
        <div class="hint" style="margin:4px 0"><s>{c.before}</s> → <b>{c.after}</b></div>
        <div class="hint" style="margin:0;font-size:11px">{c.reason}</div>
      </div>
    {/each}
    {#each aiFixes.warnings as w (w.id)}
      <div class="sub-card">
        <span class="badge warn">Uncertain ASR · Review audio</span>
        <div class="hint" style="margin:4px 0">Heard: {w.text}<br />Guess: <b>{w.suggestion}</b></div>
      </div>
    {/each}
  </CategoryBlock>
{/if}

<div class="bar">
  <button type="button" class="pri sm" style="flex:1" onclick={() => studio.setView('tr')}>Open Translation Workspace →</button>
</div>

<div class="sub-card" style="margin-top:0">
  <div class="bar">
    <button type="button" class="xs" onclick={() => {
      const t = studio.currentPlayhead();
      studio.subs.push({ id: studio.nextId(), s: t, e: Math.min(t + 2, studio.dur || t + 2), rawS: t, rawE: Math.min(t + 2, studio.dur || t + 2), t: 'New subtitle' });
      studio.subs.sort((a, b) => a.s - b.s);
      studio.inv();
      studio.snap();
    }}>+ At playhead</button>
    <button type="button" class="xs" onclick={() => srtInput?.click()}>Import SRT</button>
    <button type="button" class="xs" onclick={() => saveBlob(new Blob([studio.subs.map((s, i) => `${i + 1}\n${fts(s.s)} --> ${fts(s.e)}\n${s.t}\n`).join('\n')], { type: 'text/plain' }), 'subtitles.srt')}>SRT</button>
    <button type="button" class="xs" onclick={() => saveBlob(new Blob(['WEBVTT\n\n' + studio.subs.map((s, i) => `${i + 1}\n${fvtt(s.s)} --> ${fvtt(s.e)}\n${s.t}\n`).join('\n')], { type: 'text/vtt' }), 'subtitles.vtt')}>VTT</button>
    <button type="button" class="xs" onclick={() => shiftAll(-0.1)}>−0.1s</button>
    <button type="button" class="xs" onclick={() => shiftAll(0.1)}>+0.1s</button>
    <button type="button" class="xs" onclick={() => confirm('Delete all subtitles?') && ((studio.subs = []), studio.inv(), studio.snap())}>Clear</button>
  </div>
  <div class="rt">
    <input type="number" step="0.8" style="width:0;display:none" />
    <input bind:value={frFind} placeholder="Find" style="flex:1;min-width:0" />
    <input bind:value={frRep} placeholder="Replace" style="flex:1;min-width:0" />
    <button
      type="button"
      class="xs"
      onclick={() => {
        if (!frFind) return;
        let n = 0;
        studio.subs.forEach((o) => {
          const c = o.t.split(frFind).length - 1;
          if (c) {
            o.t = o.t.split(frFind).join(frRep);
            n += c;
          }
        });
        studio.toast(n + ' replaced');
        studio.inv();
        studio.snap();
      }}
    >
      Replace
    </button>
  </div>
</div>

<input bind:value={subSearch} placeholder="Search subtitles…" style="width:100%;margin-bottom:8px" />

{#each visibleSubs as o (o.id)}
  {@const idx = studio.subs.indexOf(o)}
  {@const wc = (o.t || '').trim().split(/\s+/).filter(Boolean).length}
  <div class="sub-item" class:active={studio.act === o.id} class:selected={studio.sel === o.id}>
    <div class="rt" style="margin-bottom:5px;flex-wrap:wrap">
      <input type="number" step="0.1" min="0" style="width:66px;padding:3px 6px" value={o.s.toFixed(2)} oninput={(e) => { o.s = +e.currentTarget.value; o.rawS = o.s; studio.inv(); }} />
      <input type="number" step="0.1" min="0" style="width:66px;padding:3px 6px" value={o.e.toFixed(2)} oninput={(e) => { o.e = +e.currentTarget.value; o.rawE = o.e; studio.inv(); }} />
      <span class="badge mono">{wc}w · {Math.max(0, o.e - o.s).toFixed(1)}s</span>
      <span style="flex:1"></span>
      {#if idx < studio.subs.length - 1}
        <button type="button" class="xs" onclick={() => studio.transferWord(idx, 'prev')} title="Pull 1st word from next">←</button>
        <button type="button" class="xs" onclick={() => studio.transferWord(idx, 'next')} title="Push last word to next">→</button>
        <button type="button" class="xs" onclick={() => studio.mergeSubAt(idx)} title="Merge with next">⊕</button>
      {/if}
      <button type="button" class="xs" onclick={() => ((studio.sel = o.id), studio.seek(o.s))}>⏵</button>
      <button type="button" class="xs" onclick={() => (studio.subs.splice(idx, 1), studio.inv(), studio.snap())}>✕</button>
    </div>
    <textarea
      dir="auto"
      rows="2"
      style="width:100%;resize:vertical"
      value={o.t}
      oninput={(e) => {
        o.t = e.currentTarget.value;
        studio.inv();
      }}
    ></textarea>
    {#if o.tr && studio.du.on}
      <div class="hint" style="margin:3px 0 0;font-size:11px">TR: {o.tr}</div>
    {/if}
  </div>
{:else}
  <div class="hint">No subtitles yet. Generate with Whisper or ElevenLabs Scribe 2 above, or import an .srt file.</div>
{/each}

<style>
  .field-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11.5px;
    color: var(--text-thirdly);
    margin-top: 6px;
  }
  .chk-lbl {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .sub-item {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 8px;
    margin-bottom: 8px;
  }
  .sub-item.active {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 1px var(--accent-primary-soft);
  }
  .sub-item.selected {
    outline: 1px solid var(--accent-secondary);
  }
</style>
