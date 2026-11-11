<script>
  import { transcriptionDuration, transcriptionPath } from '../../mediaHelpers.js';
  import {
    aiCallJson,
    aiProofreadAsr,
    aiSemanticRearrange,
    applyGenreSegmentation,
    applySubtitlePadding,
    buildProjectTranslationSystemPrompt,
    buildProjectTranslationUserPrompt,
    segsToSubs,
  } from '../../prompts.js';
  import { saveBlob } from '../../renderer.js';
  import { fvtt, fts, studio } from '../../state.svelte.js';
  import { getTauri } from '../../tauriBridge.js';
  import CategoryBlock from '../CategoryBlock.svelte';

  let subTab = $state('gen'); // 'gen' | 'edit' | 'tr'

  // Transcription state
  let eng = $state(typeof localStorage !== 'undefined' ? localStorage.icsAsrEngine || 'auto' : 'auto');
  let elModel = $state(typeof localStorage !== 'undefined' ? localStorage.getItem('icsElModel') || 'scribe_v2' : 'scribe_v2');
  let elKey = $state(studio.ovrGet().elevenlabs_key || '');
  let elDiarize = $state(false);
  let elTags = $state(false);
  let elStatus = $state('');

  let lang = $state('ur');
  let genre = $state('speech');
  let whisperModel = $state('auto');
  let hints = $state('');
  let busy = $state(false);
  let pct = $state(0);
  let status = $state('');
  let fixes = $state(null);

  // Cue list state
  let search = $state('');
  let srtInput = $state(null);

  // Quick Translate state
  let trBusy = $state(false);
  let trPct = $state(0);
  let trStatus = $state('');

  const visibleSubs = $derived(
    search.trim()
      ? studio.subs.filter(
          (o) =>
            (o.t || '').toLowerCase().includes(search.trim().toLowerCase()) ||
            (o.orig || '').toLowerCase().includes(search.trim().toLowerCase())
        )
      : studio.subs
  );

  $effect(() => {
    const T = getTauri();
    if (!T?.event) return;
    let unlisten;
    T.event.listen('whisper-log', (e) => {
      const p = String(e.payload || '');
      const x = /extract-progress=(\d+)%/.exec(p);
      const m = /progress\s*=\s*(\d+)%/.exec(p);
      if (x) {
        pct = +x[1];
        status = `Extracting audio… ${x[1]}%`;
      } else if (p.startsWith('phase=uploading-elevenlabs')) {
        pct = 65;
        status = `Transcribing with ElevenLabs (${p.split(':')[1] || elModel})…`;
      } else if (m) {
        pct = +m[1];
        status = `Transcribing… ${m[1]}%`;
      }
    }).then((u) => (unlisten = u));
    return () => unlisten?.();
  });

  function setEngine(v) {
    eng = v;
    try {
      localStorage.icsAsrEngine = v;
    } catch {}
  }

  async function saveElKey() {
    const o = studio.ovrGet();
    o.elevenlabs_key = elKey.trim();
    localStorage.icsOvr = JSON.stringify(o);
    await getTauri().core.invoke('set_overrides', { map: o });
    elStatus = o.elevenlabs_key ? 'Saved ✔' : 'Cleared';
  }

  async function generateSubs() {
    if (!studio.file && !studio.aud.track) return studio.toast('Import a video or audio file first.');
    const T = getTauri();
    busy = true;
    pct = 0;
    try {
      const routed = eng === 'auto' ? 'faster' : eng;
      const model = routed === 'elevenlabs' ? elModel : whisperModel;
      const key = routed === 'elevenlabs' ? elKey.trim() || studio.ovrGet().elevenlabs_key || '' : '';
      if (routed === 'elevenlabs' && !key) throw new Error('Enter & save your ElevenLabs key first.');

      status = 'Preparing audio…';
      const input = await transcriptionPath();
      const durHint = await transcriptionDuration();
      const resRaw = await T.core.invoke('transcribe', {
        input,
        lang,
        maxlen: studio.subCfg.maxChars,
        maxWords: studio.subCfg.maxWords,
        translate: false,
        model,
        prompt: hints.trim(),
        ctx: false,
        det: false,
        engine: routed,
        durationHint: durHint,
        diarize: elDiarize,
        tagAudioEvents: elTags,
        elevenlabsKey: key || null,
      });

      const out = JSON.parse(resRaw);
      const mc = studio.subCfg.maxChars || 84;
      const mw = studio.subCfg.maxWords || 12;
      const md = studio.subCfg.maxDur || 8;
      const rawSubs = out.segments
        ? segsToSubs(out.segments, mc, mw, md, () => studio.nextId())
        : studio.parseSRT(out.srt);
      const segSubs = applyGenreSegmentation(rawSubs.sort((a, b) => a.s - b.s), genre, { maxChars: mc, maxWords: mw, maxDur: md });
      studio.subs = applySubtitlePadding(
        segSubs,
        studio.subCfg.padBeforeMs,
        studio.subCfg.padAfterMs,
        studio.dur || studio.audioDuration || durHint || 0
      );
      studio.expandPipeSubtitles(false);
      pct = 100;
      status = `${studio.subs.length} cues ready (target ${mw}w · ±${studio.subCfg.padBeforeMs}ms)`;
      studio.inv();
      studio.snap();
      subTab = 'edit';
    } catch (e) {
      status = 'Error: ' + (e?.message || e);
    } finally {
      busy = false;
    }
  }

  async function quickTranslate() {
    if (!studio.subs.length) return studio.toast('Generate subtitles first.');
    const key = studio.TR.key || (studio.API.prov === studio.TR.prov ? studio.API.key : '');
    if (!key && studio.TR.prov !== 'ollama') {
      studio.nav = 'tr';
      return studio.toast('Add your AI key in Translation settings.');
    }
    trBusy = true;
    trPct = 0;
    const cfg = { ...studio.TR, key };
    const sys = buildProjectTranslationSystemPrompt(cfg, !!studio.TR.poetry);
    const sourceOf = (o) => (o.orig !== undefined ? o.orig : o.t);
    try {
      for (let i = 0; i < studio.subs.length; i += 20) {
        const ch = studio.subs.slice(i, i + 20);
        trStatus = `Translating ${i + 1}–${i + ch.length} of ${studio.subs.length}…`;
        const items = ch.map((o) => ({ i: o.id, t: sourceOf(o), durationMs: Math.round((o.e - o.s) * 1000), pauseBeforeMs: 0 }));
        const res = await aiCallJson(cfg, buildProjectTranslationUserPrompt(cfg, items, '', [], !!studio.TR.poetry), sys);
        const byId = new Map((res?.items || []).map((r) => [+r.i, r]));
        for (const o of ch) {
          const entry = byId.get(o.id);
          if (entry?.t) {
            o.orig ??= o.t;
            o.tr = entry.t;
            if (entry.issue) o.trIssue = entry.issue;
            if (studio.TR.live) o.t = studio.TR.out === 'both' ? entry.t + '\n' + o.orig : entry.t;
          }
        }
        trPct = Math.round(((i + ch.length) / studio.subs.length) * 100);
        studio.inv();
      }
      if (studio.TR.live) studio.expandPipeSubtitles(false);
      trStatus = `Done · ${studio.subs.length} cues translated`;
      studio.snap();
    } catch (e) {
      trStatus = 'Error: ' + (e?.message || e);
    } finally {
      trBusy = false;
    }
  }
</script>

<input
  bind:this={srtInput}
  type="file"
  accept=".srt,.txt"
  hidden
  onchange={async (e) => {
    const inp = e.currentTarget;
    const f = inp.files?.[0];
    if (!f) return;
    studio.subs = studio.parseSRT(await f.text());
    studio.inv();
    studio.snap();
    subTab = 'edit';
    inp.value = '';
  }}
/>

<div class="seg-pills tri">
  <button type="button" class:on={subTab === 'gen'} onclick={() => (subTab = 'gen')}>1. Transcribe</button>
  <button type="button" class:on={subTab === 'edit'} onclick={() => (subTab = 'edit')}>2. Cues ({studio.subs.length})</button>
  <button type="button" class:on={subTab === 'tr'} onclick={() => (subTab = 'tr')}>3. Translate</button>
</div>

{#if subTab === 'gen'}
  <CategoryBlock title="Model Picker" icon="subtitles" open={true}>
    <div class="seg-pills">
      <button type="button" class:on={eng !== 'elevenlabs'} onclick={() => setEngine('auto')}>🎙 Local Whisper / Cohere</button>
      <button type="button" class:on={eng === 'elevenlabs'} onclick={() => setEngine('elevenlabs')}>☁ ElevenLabs Scribe 2</button>
    </div>

    {#if eng === 'elevenlabs'}
      <div class="sub-card">
        <select bind:value={elModel} style="width:100%;margin-bottom:6px">
          <option value="scribe_v2">Scribe v2 (Best Accuracy + Keyterms)</option>
          <option value="scribe_v1">Scribe v1</option>
        </select>
        <div class="rt">
          <input type="password" bind:value={elKey} placeholder="ElevenLabs xi-api-key" style="flex:1;min-width:0" />
          <button type="button" class="xs pri" onclick={saveElKey}>Save</button>
        </div>
        {#if elStatus}<div class="hint" style="margin:4px 0 0">{elStatus}</div>{/if}
      </div>
    {:else}
      <div class="sg">
        <label>
          Engine
          <select value={eng} onchange={(e) => setEngine(e.currentTarget.value)}>
            <option value="auto">Auto (Best)</option>
            <option value="faster">faster-whisper</option>
            <option value="cohere">Cohere Transcribe</option>
            <option value="cpp">whisper.cpp</option>
          </select>
        </label>
        <label>
          Model
          <select bind:value={whisperModel}>
            <option value="auto">Auto (large-v3)</option>
            <option value="large-v3">large-v3</option>
            <option value="medium">medium</option>
            <option value="small">small</option>
          </select>
        </label>
      </div>
    {/if}

    <div class="sg">
      <label>
        Language
        <select bind:value={lang}>
          <option value="ur">Urdu</option>
          <option value="ar">Arabic</option>
          <option value="en">English</option>
          <option value="hi">Hindi</option>
          <option value="auto">Auto-detect</option>
        </select>
      </label>
      <label>
        Style
        <select bind:value={genre}>
          <option value="speech">Speech / Lecture</option>
          <option value="poetry">Poem / Qasida</option>
          <option value="religious">Religious / Hadith</option>
        </select>
      </label>
    </div>

    <input bind:value={hints} placeholder="Keyterms hint (names, Arabic terms…)" style="width:100%;margin-top:8px" />
  </CategoryBlock>

  <CategoryBlock title="Natural Segmentation (Target: 8–12w · 500ms)" icon="sliders" open={true}>
    <div class="sg" style="grid-template-columns:1fr 1fr 1fr">
      <label>Max words<input type="number" min="0" max="40" bind:value={studio.subCfg.maxWords} /></label>
      <label>Pad before ms<input type="number" min="0" max="2000" step="50" bind:value={studio.subCfg.padBeforeMs} /></label>
      <label>Pad after ms<input type="number" min="0" max="2000" step="50" bind:value={studio.subCfg.padAfterMs} /></label>
    </div>
    <div class="bar" style="margin-top:10px;margin-bottom:2px">
      <button type="button" class="pri" style="flex:1" disabled={busy} onclick={generateSubs}>
        {busy ? 'Transcribing…' : 'Generate Subtitles'}
      </button>
      <button type="button" class="sm" onclick={() => studio.rewrapAndPad()} title="Apply word limit and padding">
        Re-wrap
      </button>
    </div>
    <div class="pbar"><i style="width:{pct}%"></i></div>
    {#if status}<div class="hint" style="margin:2px 0 0">{status}</div>{/if}
  </CategoryBlock>
{:else if subTab === 'edit'}
  <div class="bar">
    <button type="button" class="xs" onclick={() => srtInput?.click()}>Import SRT</button>
    <button type="button" class="xs" onclick={() => saveBlob(new Blob([studio.subs.map((s, i) => `${i + 1}\n${fts(s.s)} --> ${fts(s.e)}\n${s.t}\n`).join('\n')], { type: 'text/plain' }), 'subtitles.srt')}>Export SRT</button>
    <button type="button" class="xs" onclick={() => saveBlob(new Blob(['WEBVTT\n\n' + studio.subs.map((s, i) => `${i + 1}\n${fvtt(s.s)} --> ${fvtt(s.e)}\n${s.t}\n`).join('\n')], { type: 'text/vtt' }), 'subtitles.vtt')}>VTT</button>
    <button
      type="button"
      class="xs"
      disabled={busy || !studio.subs.length}
      onclick={async () => {
        const cfg = studio.TR.key ? studio.TR : studio.API;
        if (!cfg.key) return (studio.apiModalOpen = true);
        busy = true;
        try {
          const g = await aiSemanticRearrange(studio.subs, cfg, studio.subCfg);
          studio.subs = applySubtitlePadding(g.map((x) => ({ id: studio.nextId(), ...x })), studio.subCfg.padBeforeMs, studio.subCfg.padAfterMs, studio.dur);
          studio.expandPipeSubtitles(false);
          studio.inv();
          studio.snap();
        } catch (e) {
          studio.toast(String(e));
        } finally {
          busy = false;
        }
      }}
    >
      AI Arrange
    </button>
    <button
      type="button"
      class="xs"
      disabled={busy || !studio.subs.length}
      onclick={async () => {
        const cfg = studio.TR.key ? studio.TR : studio.API;
        if (!cfg.key) return (studio.apiModalOpen = true);
        busy = true;
        try {
          fixes = await aiProofreadAsr(studio.subs, cfg);
        } catch (e) {
          studio.toast(String(e));
        } finally {
          busy = false;
        }
      }}
    >
      Proofread
    </button>
  </div>

  {#if fixes && (fixes.corrections.length || fixes.warnings.length)}
    <div class="sub-card" style="border-color:var(--accent-primary)">
      <div class="rt" style="justify-content:space-between">
        <b>{fixes.corrections.length} fix(es) · {fixes.warnings.length} review</b>
        <button type="button" class="xs" onclick={() => (fixes = null)}>Dismiss</button>
      </div>
      {#each fixes.corrections as c (c.id)}
        <div class="rt" style="margin-top:4px;font-size:11.5px">
          <span style="flex:1"><s>{c.before}</s> → <b>{c.after}</b></span>
          <button
            type="button"
            class="xs pri"
            onclick={() => {
              const s = studio.subs.find((x) => x.id === c.id);
              if (s) s.t = c.after;
              fixes.corrections = fixes.corrections.filter((x) => x.id !== c.id);
              studio.inv();
              studio.snap();
            }}
          >
            Fix
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <input bind:value={search} placeholder="Search cues…" style="width:100%;margin-bottom:8px" />

  {#each visibleSubs as o (o.id)}
    {@const ix = studio.subs.indexOf(o)}
    <div class="cue-card" class:act={studio.act === o.id}>
      <div class="rt" style="margin-bottom:5px">
        <span class="badge mono">{o.s.toFixed(1)}s → {o.e.toFixed(1)}s</span>
        <span class="badge mono">{(o.t || '').trim().split(/\s+/).filter(Boolean).length}w</span>
        <span style="flex:1"></span>
        {#if (o.t || '').includes('|')}
          <button type="button" class="xs pri" onclick={() => studio.expandPipeSubtitles()} title="Split subtitle at | separator">Split |</button>
        {/if}
        {#if ix < studio.subs.length - 1}
          <button type="button" class="xs" onclick={() => studio.transferWord(ix, 'prev')} title="Pull word">←</button>
          <button type="button" class="xs" onclick={() => studio.transferWord(ix, 'next')} title="Push word">→</button>
          <button type="button" class="xs" onclick={() => studio.mergeSubAt(ix)} title="Merge">⊕</button>
        {/if}
        <button type="button" class="xs" onclick={() => studio.seek(o.s)}>⏵</button>
        <button type="button" class="xs" onclick={() => (studio.subs.splice(ix, 1), studio.inv(), studio.snap())}>✕</button>
      </div>
      <textarea
        dir="auto"
        rows="2"
        style="width:100%"
        value={o.t}
        oninput={(e) => {
          o.t = e.currentTarget.value;
          studio.inv();
        }}
        onblur={() => studio.expandPipeSubtitles()}
      ></textarea>
      {#if o.tr}
        <div class="hint" style="margin:3px 0 0;font-size:11px;color:var(--accent-secondary)">{o.tr}</div>
      {/if}
    </div>
  {:else}
    <div class="hint">No subtitles yet. Switch to <b>1. Transcribe</b> or click Import SRT.</div>
  {/each}
{:else}
  <CategoryBlock title="AI Translation & Dual Subtitles" icon="languages" open={true}>
    <div class="sg">
      <label>To Language<input bind:value={studio.TR.tgt} /></label>
      <label>
        Islamic Terms
        <select bind:value={studio.TR.islamicTermMode}>
          <option value="both">Translate + (fiqh)</option>
          <option value="translated">Translated only</option>
          <option value="transliterated">Transliterated</option>
        </select>
      </label>
    </div>
    <div style="margin-top:8px">
      <label class="chk-lbl"><input type="checkbox" bind:checked={studio.TR.useSalawatSymbol} /> Auto-format ﷺ for Prophet Muhammad</label>
    </div>
    <div class="bar" style="margin-top:10px">
      <button type="button" class="pri" style="flex:1" disabled={trBusy} onclick={quickTranslate}>
        {trBusy ? 'Translating…' : 'Translate All Cues'}
      </button>
      <button
        type="button"
        class="sm"
        onclick={() => {
          studio.du.on = 1;
          studio.du.showSource = true;
          studio.du.showTranslation = true;
          studio.inv();
          studio.snap();
          studio.toast('Dual Subtitles Enabled! Customize in Style tab.');
        }}
      >
        Enable Dual Subs
      </button>
    </div>
    <div class="pbar"><i style="width:{trPct}%"></i></div>
    {#if trStatus}<div class="hint">{trStatus}</div>{/if}
    <button type="button" class="sm" style="width:100%;margin-top:6px" onclick={() => (studio.nav = 'tr')}>
      Open Fullscreen Bilingual Translator →
    </button>
  </CategoryBlock>
{/if}

<style>
  .cue-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 8px;
    margin-bottom: 7px;
  }
  .cue-card.act {
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 1px var(--accent-primary-soft);
  }
</style>
