<script>
  import { getCachedAsr, makeAsrCacheKey, setCachedAsr } from '../../asrCache.js';
  import { transcriptionDuration, transcriptionFile } from '../../mediaHelpers.js';
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
  import { transcribeMediaWeb } from '../../webPlatform/webAiClient.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import Icon from '../Icon.svelte';
  import StyleWorkflow from './StyleWorkflow.svelte';

  let showAdvAsr = $state(false);

  // Web Cloud ASR state
  let eng = $state(
    typeof localStorage !== 'undefined' && ['groq', 'elevenlabs', 'openai'].includes(localStorage.icsAsrEngine)
      ? localStorage.icsAsrEngine
      : 'groq'
  );
  let groqModel = $state(typeof localStorage !== 'undefined' ? localStorage.getItem('icsGroqAsrModel') || 'whisper-large-v3' : 'whisper-large-v3');
  let elModel = $state(typeof localStorage !== 'undefined' ? localStorage.getItem('icsElModel') || 'scribe_v2' : 'scribe_v2');
  let groqKey = $state(studio.ovrGet().groq_key || '');
  let elKey = $state(studio.ovrGet().elevenlabs_key || '');
  let oaAsrKey = $state(studio.ovrGet().openai_key || '');
  let elDiarize = $state(false);
  let elTags = $state(false);
  let elStatus = $state('');

  let lang = $state('ur');
  let genre = $state('speech');
  let whisperModel = $state('whisper-1');
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

  function setEngine(v) {
    eng = v;
    try {
      localStorage.icsAsrEngine = v;
    } catch {}
  }

  function saveElKey() {
    const o = studio.ovrGet();
    o.groq_key = groqKey.trim();
    o.elevenlabs_key = elKey.trim();
    o.openai_key = oaAsrKey.trim();
    localStorage.icsOvr = JSON.stringify(o);
    elStatus = o.groq_key || o.elevenlabs_key || o.openai_key ? 'Saved in browser session ✔' : 'Cleared optional override';
  }

  async function generateSubs() {
    const mediaFile = await transcriptionFile();
    if (!mediaFile) return studio.toast('Import a video or audio file first.');
    const activeEng = ['groq', 'openai', 'elevenlabs'].includes(eng) ? eng : 'groq';
    const activeModel = activeEng === 'groq' ? groqModel : activeEng === 'elevenlabs' ? elModel : whisperModel;
    const userKey =
      activeEng === 'groq'
        ? groqKey.trim() || studio.ovrGet().groq_key || ''
        : activeEng === 'elevenlabs'
          ? elKey.trim() || studio.ovrGet().elevenlabs_key || ''
          : oaAsrKey.trim() || studio.ovrGet().openai_key || '';
    if (!userKey && !studio.serverHealth?.providers?.[activeEng]) {
      elStatus = `No server ${activeEng} key detected — add your API key below or configure Vercel env var.`;
      return studio.toast('Configure API key for transcription first.');
    }

    busy = true;
    pct = 0;
    try {
      const durHint = await transcriptionDuration();
      const cacheKey = makeAsrCacheKey({
        name: mediaFile.name || 'media',
        size: mediaFile.size || 0,
        dur: studio.dur || studio.audioDuration || durHint || 0,
        engine: activeEng,
        model: activeModel,
        lang,
        prompt: hints,
      });

      let out = getCachedAsr(cacheKey);
      let fromCache = !!out;
      if (!out) {
        out = await transcribeMediaWeb({
          file: mediaFile,
          engine: activeEng,
          lang,
          model: activeModel,
          maxWords: studio.subCfg.maxWords || 12,
          diarize: elDiarize,
          tagAudioEvents: elTags,
          prompt: hints.trim(),
          userKey,
          onProgress: (p, msg) => {
            pct = p;
            status = msg;
          },
        });
        if (out?.segments?.length) setCachedAsr(cacheKey, out);
      }

      const mc = studio.subCfg.maxChars || 84;
      const mw = studio.subCfg.maxWords || 12;
      const md = studio.subCfg.maxDur || 8;
      const rawSubs = segsToSubs(out.segments || [], mc, mw, md, () => studio.nextId());
      const segSubs = applyGenreSegmentation(rawSubs.sort((a, b) => a.s - b.s), genre, { maxChars: mc, maxWords: mw, maxDur: md });
      studio.subs = applySubtitlePadding(
        segSubs,
        studio.subCfg.padBeforeMs,
        studio.subCfg.padAfterMs,
        studio.dur || studio.audioDuration || out.duration || durHint || 0
      );
      studio.expandPipeSubtitles(false);
      pct = 100;
      status = `${studio.subs.length} cues ready${fromCache ? ' (cached)' : ''} (target ${mw}w · ±${studio.subCfg.padBeforeMs}ms)`;
      studio.inv();
      studio.snap();
      studio.subTab = 'edit';
    } catch (e) {
      status = 'Error: ' + (e?.message || e);
    } finally {
      busy = false;
    }
  }

  async function quickTranslate() {
    if (!studio.subs.length) return studio.toast('Generate subtitles first.');
    const key = studio.TR.key || (studio.API.prov === studio.TR.prov ? studio.API.key : '');
    if (!key && !studio.hasAiAccess(studio.TR.prov)) {
      studio.apiModalOpen = true;
      return;
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
    studio.subTab = 'edit';
    inp.value = '';
  }}
/>

<div class="seg-pills tri">
  <button type="button" class:on={studio.subTab === 'gen'} onclick={() => (studio.subTab = 'gen')}>Generate</button>
  <button type="button" class:on={studio.subTab === 'edit'} onclick={() => (studio.subTab = 'edit')}>Edit ({studio.subs.length})</button>
  <button type="button" class:on={studio.subTab === 'style'} onclick={() => (studio.subTab = 'style')}>Style</button>
</div>

{#if studio.subTab === 'gen'}
  <CategoryBlock title="Generate Subtitles" icon="subtitles" open={true}>
    <div class="sg" style="margin-bottom:8px">
      <label>
        Provider
        <select value={eng} onchange={(e) => setEngine(e.currentTarget.value)}>
          <option value="groq">Groq</option>
          <option value="elevenlabs">ElevenLabs</option>
          <option value="openai">OpenAI</option>
        </select>
      </label>
      <label>
        Model
        {#if eng === 'groq'}
          <select bind:value={groqModel} onchange={() => { try { localStorage.icsGroqAsrModel = groqModel; } catch {} }}>
            <option value="whisper-large-v3">Whisper Large V3</option>
            <option value="whisper-large-v3-turbo">Whisper Large V3 Turbo</option>
          </select>
        {:else if eng === 'elevenlabs'}
          <select bind:value={elModel} onchange={() => { try { localStorage.icsElModel = elModel; } catch {} }}>
            <option value="scribe_v2">Scribe v2</option>
            <option value="scribe_v1">Scribe v1</option>
          </select>
        {:else}
          <select bind:value={whisperModel}>
            <option value="whisper-1">Whisper-1</option>
          </select>
        {/if}
      </label>
    </div>

    {#if eng === 'groq' && !groqKey && !studio.serverHealth?.providers?.groq}
      <div class="sub-card" style="margin-bottom:8px">
        <div class="rt">
          <input type="password" bind:value={groqKey} placeholder="Groq API Key (gsk_…)" style="flex:1;min-width:0" />
          <button type="button" class="xs pri" onclick={saveElKey}>Save</button>
        </div>
        {#if elStatus}<div class="hint" style="margin:4px 0 0">{elStatus}</div>{/if}
      </div>
    {:else if eng === 'elevenlabs' && !elKey && !studio.serverHealth?.providers?.elevenlabs}
      <div class="sub-card" style="margin-bottom:8px">
        <div class="rt">
          <input type="password" bind:value={elKey} placeholder="ElevenLabs xi-api-key" style="flex:1;min-width:0" />
          <button type="button" class="xs pri" onclick={saveElKey}>Save</button>
        </div>
        {#if elStatus}<div class="hint" style="margin:4px 0 0">{elStatus}</div>{/if}
      </div>
    {:else if eng === 'openai' && !oaAsrKey && !studio.serverHealth?.providers?.openai}
      <div class="sub-card" style="margin-bottom:8px">
        <div class="rt">
          <input type="password" bind:value={oaAsrKey} placeholder="OpenAI sk-... key" style="flex:1;min-width:0" />
          <button type="button" class="xs pri" onclick={saveElKey}>Save</button>
        </div>
        {#if elStatus}<div class="hint" style="margin:4px 0 0">{elStatus}</div>{/if}
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
        Content Style
        <select bind:value={genre}>
          <option value="speech">Speech / Lecture</option>
          <option value="poetry">Poem / Qasida</option>
          <option value="religious">Religious / Hadith</option>
        </select>
      </label>
    </div>

    <div class="bar" style="margin-top:10px;margin-bottom:2px">
      <button type="button" class="pri" style="flex:1" disabled={busy} onclick={generateSubs}>
        {busy ? 'Transcribing…' : 'Generate Subtitles'}
      </button>
    </div>
    <div class="pbar"><i style="width:{pct}%"></i></div>
    {#if status}<div class="hint" style="margin:2px 0 0">{status}</div>{/if}

    <button type="button" class="adv-toggle" aria-expanded={showAdvAsr} onclick={() => (showAdvAsr = !showAdvAsr)}>
      <span>Advanced Transcription &amp; Segmentation</span>
      <Icon name={showAdvAsr ? 'chev-up' : 'chev-down'} size={13} />
    </button>

    {#if showAdvAsr}
      <div class="adv-box">
        {#if eng === 'groq'}
          <div class="sub-card" style="margin-bottom:8px">
            <div class="rt" style="justify-content:space-between;margin-bottom:6px">
              <span class="hint" style="margin:0">Groq Whisper Large V3 (Word Timestamps)</span>
              <span class="badge" class:ok={studio.serverHealth?.providers?.groq}>
                {studio.serverHealth?.providers?.groq ? 'Server Key Active' : 'BYOK'}
              </span>
            </div>
            <div class="rt">
              <input type="password" bind:value={groqKey} placeholder={studio.serverHealth?.providers?.groq ? 'Optional BYOK override…' : 'Groq API Key (gsk_…)'} style="flex:1;min-width:0" />
              <button type="button" class="xs pri" onclick={saveElKey}>Save</button>
            </div>
            {#if elStatus}<div class="hint" style="margin:4px 0 0">{elStatus}</div>{/if}
          </div>
        {:else if eng === 'elevenlabs'}
          <div class="sub-card" style="margin-bottom:8px">
            <div class="rt" style="justify-content:space-between;margin-bottom:6px">
              <span class="hint" style="margin:0">Word timestamps &amp; diarization</span>
              <span class="badge" class:ok={studio.serverHealth?.providers?.elevenlabs}>
                {studio.serverHealth?.providers?.elevenlabs ? 'Server Key Active' : 'BYOK'}
              </span>
            </div>
            <div class="rt">
              <input type="password" bind:value={elKey} placeholder={studio.serverHealth?.providers?.elevenlabs ? 'Optional BYOK override…' : 'ElevenLabs xi-api-key'} style="flex:1;min-width:0" />
              <button type="button" class="xs pri" onclick={saveElKey}>Save</button>
            </div>
            {#if elStatus}<div class="hint" style="margin:4px 0 0">{elStatus}</div>{/if}
          </div>
        {:else}
          <div class="sub-card" style="margin-bottom:8px">
            <div class="rt" style="justify-content:space-between;margin-bottom:6px">
              <span class="hint" style="margin:0">OpenAI Cloud Whisper</span>
              <span class="badge" class:ok={studio.serverHealth?.providers?.openai}>
                {studio.serverHealth?.providers?.openai ? 'Server Key Active' : 'BYOK'}
              </span>
            </div>
            <div class="rt">
              <input type="password" bind:value={oaAsrKey} placeholder={studio.serverHealth?.providers?.openai ? 'Optional OpenAI key override…' : 'OpenAI sk-... key'} style="flex:1;min-width:0" />
              <button type="button" class="xs pri" onclick={saveElKey}>Save</button>
            </div>
            {#if elStatus}<div class="hint" style="margin:4px 0 0">{elStatus}</div>{/if}
          </div>
        {/if}

        <input bind:value={hints} placeholder="Keyterms hint (names, Arabic terms…)" style="width:100%;margin-bottom:8px" />

        <div class="sg" style="grid-template-columns:1fr 1fr 1fr">
          <label>Max words<input type="number" min="0" max="40" bind:value={studio.subCfg.maxWords} /></label>
          <label>Pad before ms<input type="number" min="0" max="2000" step="50" bind:value={studio.subCfg.padBeforeMs} /></label>
          <label>Pad after ms<input type="number" min="0" max="2000" step="50" bind:value={studio.subCfg.padAfterMs} /></label>
        </div>
        <button type="button" class="xs" style="width:100%;margin-top:6px" onclick={() => studio.rewrapAndPad()}>
          Re-wrap Existing Subtitles
        </button>
      </div>
    {/if}
  </CategoryBlock>
{:else if studio.subTab === 'edit'}
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
        if (!studio.hasAiAccess(cfg.prov)) return (studio.apiModalOpen = true);
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
      AI Smart Split
    </button>
    <button
      type="button"
      class="xs"
      disabled={busy || !studio.subs.length}
      onclick={async () => {
        const cfg = studio.TR.key ? studio.TR : studio.API;
        if (!studio.hasAiAccess(cfg.prov)) return (studio.apiModalOpen = true);
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
    <div class="hint">No subtitles yet. Switch to <b>Generate</b> or click Import SRT.</div>
  {/each}

  <CategoryBlock title="Bilingual Translation" icon="languages" open={false}>
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
      Open Translation Desk →
    </button>
  </CategoryBlock>
{:else}
  <StyleWorkflow />
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
