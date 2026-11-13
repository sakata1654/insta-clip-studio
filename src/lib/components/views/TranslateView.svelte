<script>
  import { TRP } from '../../constants.js';
  import {
    aiCallJson,
    buildProjectTranslationSystemPrompt,
    buildProjectTranslationUserPrompt,
  } from '../../prompts.js';
  import { saveBlob } from '../../renderer.js';
  import { fmt, fts, studio } from '../../state.svelte.js';
  import { getTauri } from '../../tauriBridge.js';
  import { shapeBidiText } from '../../bidiHelper.js';
  import {
    DEFAULT_ISLAMIC_GLOSSARY,
    formatGlossaryPrompt,
    validateSubtitleCues,
  } from '../../transcriptEngine/transcriptModel.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import Icon from '../Icon.svelte';

  let busy = $state(false);
  let stopRequested = $state(false);
  let pct = $state(0);
  let status = $state('');
  let testStatus = $state('');
  let fetchedModels = $state([]);
  let activeStudioTab = $state('desk'); // 'transcript' | 'segmentation' | 'desk'

  const cueValidationIssues = $derived(validateSubtitleCues(studio.subs));
  const cueIssuesMap = $derived.by(() => {
    const m = new Map();
    for (const it of cueValidationIssues) {
      if (!m.has(it.cueId)) m.set(it.cueId, []);
      m.get(it.cueId).push(it);
    }
    return m;
  });

  const paragraphs = $derived.by(() => {
    if (!studio.subs.length) return [];
    const list = [];
    let cur = [];
    let wCount = 0;
    for (let i = 0; i < studio.subs.length; i++) {
      const s = studio.subs[i];
      const prev = cur.length ? cur[cur.length - 1] : null;
      const pauseGap = prev ? Math.max(0, s.s - prev.e) : 0;
      const words = (s.t || '').trim().split(/\s+/).filter(Boolean);
      const isEndPunct = /[.!?؟۔…]$/u.test(s.t || '');

      if (cur.length && (pauseGap >= 0.85 || wCount >= 40 || (isEndPunct && wCount >= 18))) {
        list.push({
          id: list.length + 1,
          s: cur[0].s,
          e: cur[cur.length - 1].e,
          text: cur.map((x) => (x.orig !== undefined ? x.orig : x.t)).join(' '),
          trText: cur.map((x) => x.tr || '').filter(Boolean).join(' '),
          cues: [...cur],
          wordCount: wCount,
        });
        cur = [];
        wCount = 0;
      }
      cur.push(s);
      wCount += words.length;
    }
    if (cur.length) {
      list.push({
        id: list.length + 1,
        s: cur[0].s,
        e: cur[cur.length - 1].e,
        text: cur.map((x) => (x.orig !== undefined ? x.orig : x.t)).join(' '),
        trText: cur.map((x) => x.tr || '').filter(Boolean).join(' '),
        cues: [...cur],
        wordCount: wCount,
      });
    }
    return list;
  });

  const hashStr = (s) => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + s.length;
  };
  const cacheMap = () => {
    try {
      return JSON.parse(localStorage.icsTrC || '{}');
    } catch {
      return {};
    }
  };
  const sig = () =>
    [
      studio.TR.prov,
      studio.TR.model,
      studio.TR.mode,
      studio.TR.src,
      studio.TR.tgt,
      studio.TR.style,
      studio.TR.islamicTermMode,
      studio.TR.useSalawatSymbol,
      studio.TR.cps,
      studio.TR.brk,
      studio.TR.poetry,
      studio.TR.gloss,
      studio.TR.extraPrefs,
      studio.TR.ctx,
      studio.TR.fullctx,
      studio.TR.temp,
      'minbar-v3',
    ].join('¦');

  function applyLine(o) {
    if (!o.tr) return;
    const src = o.orig !== undefined ? o.orig : o.t;
    o.orig = src;
    o.t = studio.TR.out === 'both' ? o.tr + '\n' + src : o.tr;
  }

  async function fetchGeminiModels() {
    if (studio.TR.prov !== 'gemini') return studio.toast('Model list is available for Gemini');
    if (!studio.TR.key) return studio.toast('Paste your Gemini API key first');
    try {
      const f = getTauri()?.http?.fetch || fetch;
      const r = await f(studio.TR.url.replace(/\/$/, '') + '/models?pageSize=200', {
        headers: { 'x-goog-api-key': studio.TR.key },
      });
      const j = await r.json();
      fetchedModels = (j.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/.test(m.name))
        .map((m) => m.name.replace('models/', ''));
      testStatus = `${fetchedModels.length} models loaded`;
    } catch (e) {
      testStatus = 'Error: ' + (e?.message || e);
    }
  }

  async function testConnection() {
    studio.saveTrCfg();
    testStatus = 'Testing…';
    try {
      const res = await aiCallJson(studio.TR, 'Return ONLY: {"items":[{"i":1,"t":"ok","issue":""}]}', '');
      testStatus = res?.items?.length || Array.isArray(res) ? 'Connected' : 'Unexpected response';
    } catch (e) {
      testStatus = 'Error: ' + (e?.message || e);
    }
  }

  async function runTranslate(opts = {}) {
    studio.saveTrCfg();
    if (!studio.subs.length) return studio.toast('No subtitles yet');
    const key = studio.TR.key || (studio.API.prov === studio.TR.prov ? studio.API.key : '');
    if (!key && studio.TR.prov !== 'ollama') return studio.toast('Add your API key first');

    const inRange = (o) => !studio.TR.range || (o.e > studio.trimS && o.s < studio.trimE);
    const todo = opts.only || studio.subs.filter((o) => inRange(o) && (opts.retry ? !!o.tre : opts.all || !o.tr || o.tre));
    if (!todo.length) return studio.toast(opts.retry ? 'No failed lines to retry' : 'Everything is already translated');

    stopRequested = false;
    busy = true;
    pct = 0;

    const C = cacheMap();
    const idxMap = new Map(studio.subs.map((o, k) => [o.id, k]));
    const sourceOf = (o) => (o.orig !== undefined ? o.orig : o.t);
    const sKey = sig();
    const fullText = studio.TR.fullctx ? studio.subs.map((o, k) => `[${k + 1}] ${sourceOf(o)}`).join('\n') : '';
    const fullHash = studio.TR.fullctx ? hashStr(fullText) : '';
    const cacheKeyFor = (o) => hashStr(`${sKey}|${fullHash}|${sourceOf(o)}|${fts(o.s)}|${fts(o.e)}`);

    let done = 0;
    let hit = 0;
    let fails = 0;
    const need = [];
    for (const o of todo) {
      const k = cacheKeyFor(o);
      if (!opts.only && !opts.all && !opts.retry && C[k] !== undefined) {
        const cached = typeof C[k] === 'string' ? { t: C[k], issue: '' } : C[k];
        o.tr = cached.t;
        if (cached.issue) o.trIssue = cached.issue;
        else delete o.trIssue;
        delete o.tre;
        hit++;
      } else {
        need.push(o);
      }
    }

    const sys = buildProjectTranslationSystemPrompt(studio.TR, !!studio.TR.poetry);
    const recentPairs = [];
    const effectiveCfg = { ...studio.TR, key };

    try {
      let i = 0;
      while (i < need.length && !stopRequested) {
        const ch = [];
        let charSum = 0;
        while (i < need.length && ch.length < studio.TR.batch && charSum < 5200) {
          const o = need[i++];
          ch.push(o);
          charSum += sourceOf(o).length;
        }
        const firstIdx = idxMap.get(ch[0].id);
        const lastIdx = idxMap.get(ch[ch.length - 1].id);
        const contextStr = studio.TR.fullctx
          ? studio.subs.length <= 180
            ? fullText
            : studio.subs
                .slice(Math.max(0, firstIdx - 60), Math.min(studio.subs.length, lastIdx + 61))
                .map((o, k) => `[${Math.max(0, firstIdx - 60) + k + 1}] ${sourceOf(o)}`)
                .join('\n')
          : '';

        const items = ch.map((o) => {
          const ix = idxMap.get(o.id);
          const prev = ix > 0 ? studio.subs[ix - 1] : null;
          const pauseMs = prev ? Math.max(0, Math.round((o.s - prev.e) * 1000)) : 0;
          return {
            i: o.id,
            t: sourceOf(o),
            durationMs: Math.max(200, Math.round((o.e - o.s) * 1000)),
            pauseBeforeMs: pauseMs,
            contextGapBefore: ix > 0 && ch[0].id === o.id && firstIdx > 0 && pauseMs >= 1000,
          };
        });

        const glossPrompt = formatGlossaryPrompt(DEFAULT_ISLAMIC_GLOSSARY);
        const combinedContext = (contextStr ? contextStr + '\n\n' : '') + glossPrompt;

        status = `Translating ${done + 1}–${done + ch.length} of ${need.length}…`;
        const res = await aiCallJson(
          effectiveCfg,
          buildProjectTranslationUserPrompt(studio.TR, items, combinedContext, recentPairs.slice(-5), !!studio.TR.poetry),
          sys,
          (m) => (status = m)
        );
        const arr = Array.isArray(res) ? res : res?.items || res?.translations || [];
        const byId = new Map(arr.map((r) => [+r.i, { t: String(r.t ?? '').trim(), issue: String(r.issue ?? '').trim() }]));

        const missed = [];
        for (const o of ch) {
          const entry = byId.get(o.id);
          if (entry && entry.t) {
            o.tr = shapeBidiText(entry.t);
            if (entry.issue) o.trIssue = entry.issue;
            else delete o.trIssue;
            delete o.tre;
            C[cacheKeyFor(o)] = { t: o.tr, issue: entry.issue };
            recentPairs.push({ s: sourceOf(o), t: o.tr });
          } else {
            missed.push(o);
          }
        }

        if (missed.length && !stopRequested) {
          status = `Recovering ${missed.length} missed line(s)…`;
          const retryItems = missed.map((o) => ({ i: o.id, t: sourceOf(o), durationMs: Math.max(200, Math.round((o.e - o.s) * 1000)), pauseBeforeMs: 0 }));
          try {
            const r2 = await aiCallJson(effectiveCfg, buildProjectTranslationUserPrompt(studio.TR, retryItems, '', recentPairs.slice(-5), !!studio.TR.poetry), sys);
            const arr2 = Array.isArray(r2) ? r2 : r2?.items || [];
            const m2 = new Map(arr2.map((r) => [+r.i, { t: String(r.t ?? '').trim(), issue: String(r.issue ?? '').trim() }]));
            for (const o of missed) {
              const entry = m2.get(o.id);
              if (entry && entry.t) {
                o.tr = shapeBidiText(entry.t);
                if (entry.issue) o.trIssue = entry.issue;
                else delete o.trIssue;
                delete o.tre;
                C[cacheKeyFor(o)] = { t: o.tr, issue: entry.issue };
              } else {
                o.tre = 'AI Error — missing in response';
                fails++;
              }
            }
          } catch {
            for (const o of missed) {
              o.tre = 'AI Error — retry failed';
              fails++;
            }
          }
        }

        done += ch.length;
        pct = Math.round((done / Math.max(1, need.length)) * 100);
        if (studio.TR.live) for (const o of ch) if (o.tr) applyLine(o);
        studio.inv();
      }

      if (studio.TR.live) {
        for (const o of todo) if (o.tr) applyLine(o);
        studio.expandPipeSubtitles(false);
      }
      status = `${stopRequested ? 'Stopped' : 'Done'} — ${done} translated, ${hit} cached${fails ? `, ${fails} failed (Retry)` : ''}`;
      studio.snap();
    } catch (e) {
      status = 'Error: ' + (e?.message || e);
    } finally {
      try {
        localStorage.icsTrC = JSON.stringify(Object.fromEntries(Object.entries(C).slice(-2500)));
      } catch {}
      busy = false;
    }
  }
</script>

<div class="tr-page">
  <aside class="tr-side">
    <CategoryBlock title="AI Translation Provider" icon="languages" open={true}>
      <div class="sg" style="grid-template-columns:1fr">
        <label>
          Provider
          <select
            bind:value={studio.TR.prov}
            onchange={() => {
              const p = TRP[studio.TR.prov] || ['', ''];
              studio.TR.url = p[0];
              studio.TR.model = p[1];
              studio.saveTrCfg();
            }}
          >
            <option value="gemini">Google Gemini</option>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="groq">Groq</option>
            <option value="openrouter">OpenRouter</option>
            <option value="ollama">Ollama (local)</option>
            <option value="custom">Custom OpenAI-compatible</option>
          </select>
        </label>
        <label>Base URL<input bind:value={studio.TR.url} onchange={() => studio.saveTrCfg()} /></label>
        <label>API key<input type="password" bind:value={studio.TR.key} placeholder="paste API key" onchange={() => studio.saveTrCfg()} /></label>
        <label>Model<input list="trModelsList" bind:value={studio.TR.model} onchange={() => studio.saveTrCfg()} /></label>
        <datalist id="trModelsList">
          {#each fetchedModels as m}<option value={m}></option>{/each}
        </datalist>
      </div>
      <div class="bar" style="margin-top:8px">
        <button type="button" class="xs" onclick={fetchGeminiModels}>Fetch models</button>
        <button type="button" class="xs" onclick={testConnection}>Test</button>
        <button
          type="button"
          class="xs"
          onclick={() => {
            studio.TR.prov = studio.API.prov;
            studio.TR.url = studio.API.prov === 'gemini' ? TRP.gemini[0] : studio.API.url;
            studio.TR.key = studio.API.key;
            studio.TR.model = studio.API.model;
            studio.saveTrCfg();
            studio.toast('Synced from AI Settings');
          }}
        >
          Sync API Key
        </button>
        <span class="hint" style="margin:0">{testStatus}</span>
      </div>
    </CategoryBlock>

    <CategoryBlock title="Minbar Translation Options" icon="sparkles" open={true}>
      <div class="sg">
        <label>
          Task
          <select bind:value={studio.TR.mode}>
            <option value="translate">Translate</option>
            <option value="proofread">Proofread ASR</option>
            <option value="both">Proofread + translate</option>
          </select>
        </label>
        <label>
          Tone
          <select bind:value={studio.TR.style}>
            <option value="natural">Natural & fluent</option>
            <option value="reels">Reels captions</option>
            <option value="lecture">Religious sermon</option>
            <option value="formal">Formal</option>
          </select>
        </label>
        <label>From
          <select bind:value={studio.TR.src}>
            <option value="auto">Auto-detect</option>
            <option value="Urdu">Urdu</option>
            <option value="Arabic">Arabic</option>
            <option value="English">English</option>
            <option value="Hindi">Hindi</option>
            <option value="Persian">Persian</option>
          </select>
        </label>
        <label>To<input bind:value={studio.TR.tgt} /></label>
        <label>
          Islamic terms
          <select bind:value={studio.TR.islamicTermMode}>
            <option value="both">Translate + (fiqh)</option>
            <option value="translated">Translated only</option>
            <option value="transliterated">Transliterated only</option>
          </select>
        </label>
        <label>
          Apply mode
          <select bind:value={studio.TR.out}>
            <option value="replace">Keep orig in Dual</option>
            <option value="both">Bilingual inline</option>
          </select>
        </label>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
        <label class="chk-lbl"><input type="checkbox" bind:checked={studio.TR.useSalawatSymbol} /> Use ﷺ symbol for Prophet Muhammad</label>
        <label class="chk-lbl"><input type="checkbox" bind:checked={studio.TR.poetry} /> Poem / Qasida verse mode</label>
        <label class="chk-lbl"><input type="checkbox" bind:checked={studio.TR.brk} /> Insert “|” timing reveals</label>
        <label class="chk-lbl"><input type="checkbox" bind:checked={studio.TR.fullctx} /> Full transcript continuity context</label>
        <label class="chk-lbl"><input type="checkbox" bind:checked={studio.TR.live} /> Live-apply to video preview</label>
      </div>
      <label class="hint" for="tr-gloss-box" style="display:block;margin-top:8px">Glossary (<code>term = translation</code> per line)</label>
      <textarea id="tr-gloss-box" rows="3" style="width:100%" bind:value={studio.TR.gloss} placeholder="Allah&#10;ummah = community"></textarea>
    </CategoryBlock>
  </aside>

  <section class="tr-main">
    <div class="tr-view-tabs" role="tablist">
      <button
        type="button"
        class="tab-btn"
        class:active={activeStudioTab === 'transcript'}
        onclick={() => (activeStudioTab = 'transcript')}
      >
        <Icon name="align-left" size={13} />
        <span>1. Original Transcript ({paragraphs.length} paragraphs)</span>
      </button>
      <button
        type="button"
        class="tab-btn"
        class:active={activeStudioTab === 'segmentation'}
        onclick={() => (activeStudioTab = 'segmentation')}
      >
        <Icon name="subtitles" size={13} />
        <span>2. Subtitle Segmentation ({studio.subs.length} cues{#if cueValidationIssues.length} · <span class="badge warn-pill">{cueValidationIssues.length} alerts</span>{/if})</span>
      </button>
      <button
        type="button"
        class="tab-btn"
        class:active={activeStudioTab === 'desk'}
        onclick={() => (activeStudioTab = 'desk')}
      >
        <Icon name="languages" size={13} />
        <span>3. Translation Desk ({studio.subs.filter((s) => !!s.tr).length}/{studio.subs.length})</span>
      </button>
    </div>

    {#if activeStudioTab === 'transcript'}
      <!-- TAB 1: ORIGINAL TRANSCRIPT -->
      <div class="tr-toolbar">
        <div class="rt" style="gap:8px">
          <span class="badge mono">{paragraphs.reduce((sum, p) => sum + p.wordCount, 0)} total words</span>
          <span class="badge mono">{paragraphs.length} thought paragraphs</span>
        </div>
        <span style="flex:1"></span>
        <button
          type="button"
          class="sm"
          onclick={() => {
            const full = paragraphs.map((p) => `[${fmt(p.s)} - ${fmt(p.e)}]\n${p.text}\n`).join('\n');
            navigator.clipboard?.writeText(full);
            studio.toast('Transcript copied to clipboard');
          }}
        >
          <Icon name="copy" size={12} />
          <span>Copy Full Text</span>
        </button>
        <button
          type="button"
          class="sm"
          onclick={() => {
            const full = paragraphs.map((p) => `[${fmt(p.s)} - ${fmt(p.e)}]\n${p.text}\n${p.trText ? 'Tr: ' + p.trText + '\n' : ''}`).join('\n');
            saveBlob(new Blob([full], { type: 'text/plain' }), 'transcript.txt');
          }}
        >
          Export TXT
        </button>
      </div>

      <div class="tr-list">
        {#each paragraphs as p (p.id)}
          <div class="para-card">
            <div class="rt" style="justify-content:space-between;margin-bottom:6px">
              <div class="rt" style="gap:6px">
                <button type="button" class="xs pri" onclick={() => { studio.seek(p.s); studio.setView('ed'); }}>
                  ⏵ {fmt(p.s)} → {fmt(p.e)}
                </button>
                <span class="badge mono">{p.wordCount} words</span>
                <span class="badge mono">{p.cues.length} cues</span>
              </div>
            </div>
            <div class="para-text" dir="auto">
              {p.text}
            </div>
            {#if p.trText}
              <div class="para-tr-text" dir="auto">
                <span class="hint" style="margin:0 0 4px;font-size:11px;font-weight:600">Translation:</span>
                {p.trText}
              </div>
            {/if}
          </div>
        {:else}
          <div class="hint">No speech transcript available. Generate subtitles or import an SRT to read continuous paragraphs here.</div>
        {/each}
      </div>

    {:else if activeStudioTab === 'segmentation'}
      <!-- TAB 2: SUBTITLE SEGMENTATION -->
      <div class="tr-toolbar">
        <div class="rt" style="gap:8px">
          <span class="badge mono">{studio.subs.length} cues</span>
          <span class="badge ok">Recommended: 8–12 words/cue</span>
          {#if cueValidationIssues.length}
            <span class="badge warn">{cueValidationIssues.length} quality alerts</span>
          {/if}
        </div>
        <span style="flex:1"></span>
        <button
          type="button"
          class="sm pri"
          onclick={() => {
            studio.rewrapAndPad();
            studio.toast('Applied Intelligent Semantic Segmentation 2.0');
          }}
          title="Auto-balance cues into complete grammatical sentences and fix fragmented cuts"
        >
          <Icon name="sparkles" size={13} />
          <span>Auto-Fix & Balance Phrasing</span>
        </button>
        <button
          type="button"
          class="sm"
          onclick={() => {
            studio.expandPipeSubtitles(false);
            studio.inv();
            studio.snap();
            studio.toast('Divided cues at | markers');
          }}
        >
          Expand | Splits
        </button>
      </div>

      <div class="tr-list">
        {#each studio.subs as o, ix (o.id)}
          {@const words = (o.t || '').trim().split(/\s+/).filter(Boolean)}
          {@const alerts = cueIssuesMap.get(o.id) || []}
          <div class="seg-card" class:has-alert={alerts.length > 0}>
            <div class="rt" style="justify-content:space-between;margin-bottom:6px">
              <div class="rt" style="gap:6px">
                <button type="button" class="xs" onclick={() => { studio.seek(o.s); studio.setView('ed'); }}>
                  ⏵ {fmt(o.s)} → {fmt(o.e)}
                </button>
                <span
                  class="badge mono"
                  class:ok={words.length >= 7 && words.length <= 13}
                  class:warn={words.length < 6 || words.length > 14}
                >
                  {words.length}w {words.length >= 7 && words.length <= 13 ? '✓' : ''}
                </span>
                <span class="badge mono">{(o.e - o.s).toFixed(1)}s</span>
              </div>
              <div class="rt" style="gap:4px">
                {#if (o.t || '').includes('|')}
                  <button type="button" class="xs pri" onclick={() => studio.expandPipeSubtitles()} title="Split on | marker">Split |</button>
                {/if}
                {#if ix < studio.subs.length - 1}
                  <button type="button" class="xs" onclick={() => studio.transferWord(ix, 'prev')} title="Pull word from next cue">← Pull</button>
                  <button type="button" class="xs" onclick={() => studio.transferWord(ix, 'next')} title="Push word to next cue">Push →</button>
                  <button type="button" class="xs" onclick={() => studio.mergeSubAt(ix)} title="Merge with next cue">Merge ⊕</button>
                {/if}
              </div>
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

            {#if alerts.length > 0}
              <div class="seg-alerts">
                {#each alerts as a}
                  <div class="hint" style="margin:2px 0;font-size:11px;color:var(--accent-amber)">⚠ {a.message}</div>
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          <div class="hint">No subtitle cues available yet. Generate or import subtitles first.</div>
        {/each}
      </div>

    {:else}
      <!-- TAB 3: TRANSLATION DESK -->
      <div class="tr-toolbar">
        <button type="button" class="pri" disabled={busy} onclick={() => runTranslate()}>Translate</button>
        <button type="button" class="sm" disabled={busy} onclick={() => runTranslate({ retry: true })}>↻ Retry failed</button>
        <button type="button" class="sm" disabled={busy} onclick={() => runTranslate({ all: true })}>Re-do all</button>
        {#if busy}
          <button type="button" class="sm" onclick={() => (stopRequested = true)}>Stop</button>
        {/if}
        <button
          type="button"
          class="sm"
          onclick={() => {
            studio.subs.forEach(applyLine);
            studio.inv();
            studio.snap();
            studio.toast('Applied translations');
          }}
        >
          Apply
        </button>
        <button
          type="button"
          class="sm pri"
          onclick={() => {
            studio.subs.forEach((o) => {
              if (o.tr) {
                o.orig ??= o.t;
                if (studio.du.dualMode === 'split') o.t = o.tr;
              }
            });
            studio.du.on = 1;
            studio.du.showSource = true;
            studio.du.showTranslation = true;
            studio.inv();
            studio.snap();
            studio.setView('su');
            studio.sideTab = 'sty';
            studio.styleSubTab = 'dual';
            studio.toast('Dual Subtitles enabled! Style Source & Translation independently.');
          }}
        >
          Enable Dual Subs
        </button>
        <button
          type="button"
          class="sm"
          onclick={() => {
            let n = 0;
            studio.subs.forEach((o) => {
              if (o.orig !== undefined && o.tr) {
                [o.orig, o.tr] = [o.tr, o.orig];
                o.t = studio.TR.out === 'both' ? o.tr + '\n' + o.orig : o.tr;
                n++;
              }
            });
            studio.inv();
            studio.snap();
            studio.toast(n ? `Swapped ${n} lines` : 'Translate subtitles first');
          }}
        >
          ⇄ Swap
        </button>
        <button
          type="button"
          class="sm"
          onclick={() => saveBlob(new Blob([studio.subs.map((s, i) => `${i + 1}\n${fts(s.s)} --> ${fts(s.e)}\n${s.tr || s.t}\n`).join('\n')], { type: 'text/plain' }), 'translated.srt')}
        >
          SRT
        </button>
        <button
          type="button"
          class="sm"
          onclick={() => saveBlob(new Blob([studio.subs.map((s, i) => `${i + 1}\n${fts(s.s)} --> ${fts(s.e)}\n${s.tr ? s.tr + '\n' : ''}${s.orig ?? s.t}\n`).join('\n')], { type: 'text/plain' }), 'bilingual.srt')}
        >
          Bilingual SRT
        </button>
        <span class="hint" style="margin:0">{status}</span>
        <div class="pbar" style="width:100%;margin:4px 0 0"><i style="width:{pct}%"></i></div>
      </div>

      <div class="tr-list">
        {#each studio.subs as o (o.id)}
          {@const durS = Math.max(0.2, o.e - o.s || 1)}
          {@const trLen = (o.tr || '').replace(/\|/g, '').trim().length}
          {@const cps = trLen ? Math.round(trLen / durS) : 0}
          <div class="tr-row" class:ok={!!o.tr && !o.tre} class:err={!!o.tre}>
            <div>
              <button type="button" class="xs" onclick={() => { studio.seek(o.s); studio.setView('ed'); }}>⏵ {fmt(o.s)}</button>
              {#if cps > 0}
                <div class="badge mono" class:warn={cps > studio.TR.cps + 5} class:ok={cps <= studio.TR.cps + 5} style="margin-top:4px">
                  {cps} c/s
                </div>
              {/if}
              {#if o.trIssue}
                <div class="badge warn" title={o.trIssue} style="margin-top:4px">Review</div>
              {/if}
            </div>
            <div class="tr-src" dir="auto">{o.orig !== undefined ? o.orig : o.t}</div>
            <div>
              <textarea
                dir="auto"
                rows="2"
                style="width:100%"
                placeholder={o.tre || 'Translation…'}
                value={o.tr || ''}
                oninput={(e) => {
                  o.tr = e.currentTarget.value;
                  delete o.tre;
                  if (studio.TR.live && o.tr) applyLine(o);
                  studio.inv();
                }}
              ></textarea>
              {#if o.trIssue}
                <div class="hint" style="margin:3px 0 0;font-size:11px;color:var(--accent-amber)">⚠ {o.trIssue}</div>
              {/if}
            </div>
            <div style="display:flex;flex-direction:column;gap:4px">
              <button type="button" class="xs" onclick={() => runTranslate({ only: [o] })} title="Re-translate line">↻</button>
              <button
                type="button"
                class="xs"
                onclick={() => {
                  delete o.tr;
                  delete o.tre;
                  delete o.trIssue;
                  if (o.orig !== undefined) {
                    o.t = o.orig;
                    delete o.orig;
                  }
                  studio.inv();
                }}
              >
                ✕
              </button>
            </div>
          </div>
        {:else}
          <div class="hint">Generate or import subtitles first, then translate cleanly here.</div>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .tr-page {
    grid-column: 1 / -1;
    grid-row: 2 / -1;
    display: grid;
    grid-template-columns: 380px 1fr;
    overflow: hidden;
    min-height: 0;
    background: var(--bg-canvas);
  }
  .tr-side {
    padding: 12px;
    overflow: auto;
    border-right: 1px solid var(--border-color);
    background: var(--bg-rail);
  }
  .tr-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  .tr-toolbar {
    padding: 10px 14px;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    align-items: center;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-secondary);
  }
  .tr-list {
    flex: 1;
    overflow: auto;
    padding: 12px;
  }
  .tr-row {
    display: grid;
    grid-template-columns: 82px 1fr 1fr 44px;
    gap: 8px;
    margin-bottom: 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 9px;
    align-items: start;
  }
  .tr-row.ok {
    border-color: rgba(63, 185, 80, 0.4);
  }
  .tr-row.err {
    border-color: rgba(248, 81, 73, 0.55);
  }
  .tr-src {
    padding: 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 7px;
    white-space: pre-wrap;
    min-height: 52px;
  }
  .chk-lbl {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 12px;
    color: var(--text-secondary);
    cursor: pointer;
  }
  .tr-view-tabs {
    display: flex;
    background: var(--bg-rail);
    border-bottom: 1px solid var(--border-color);
    padding: 6px 12px 0;
    gap: 4px;
    flex-shrink: 0;
  }
  .tab-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    font-size: 12px;
    font-weight: 550;
    color: var(--text-secondary);
    background: transparent;
    border: 1px solid transparent;
    border-bottom: 0;
    border-radius: 8px 8px 0 0;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .tab-btn:hover {
    color: var(--text-primary);
    background: var(--bg-secondary);
  }
  .tab-btn.active {
    color: var(--accent);
    background: var(--bg-canvas);
    border-color: var(--border-color);
    border-bottom: 1px solid var(--bg-canvas);
    margin-bottom: -1px;
    font-weight: 650;
  }
  .para-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 14px;
    margin-bottom: 12px;
  }
  .para-text {
    font-size: 14px;
    line-height: 1.65;
    color: var(--text-primary);
    white-space: pre-wrap;
    padding: 8px 0;
  }
  .para-tr-text {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed var(--border-color);
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--accent-secondary);
    white-space: pre-wrap;
  }
  .seg-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 10px 12px;
    margin-bottom: 8px;
  }
  .seg-card.has-alert {
    border-color: rgba(210, 153, 34, 0.45);
  }
  .seg-alerts {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px dashed var(--border-color);
  }
  .warn-pill {
    background: rgba(210, 153, 34, 0.2);
    color: var(--accent-amber);
    padding: 2px 6px;
    border-radius: 10px;
    font-size: 10.5px;
  }
</style>
