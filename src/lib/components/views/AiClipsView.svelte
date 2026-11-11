<script>
  import { aiCallJson } from '../../prompts.js';
  import { exportAll, saveBlob } from '../../renderer.js';
  import { fmt, studio } from '../../state.svelte.js';
  import CategoryBlock from '../CategoryBlock.svelte';

  let url = $state('');
  let count = $state(8);
  let maxSec = $state(120);
  let promptExtra = $state('');
  let busy = $state(false);
  let status = $state('');
  let topics = $state([]);
  let clips = $state([]);

  const aiTs = (s) => {
    s = Math.max(0, Number(s) || 0);
    return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${(s % 60).toFixed(3).padStart(6, '0')}`;
  };

  async function runAiClips() {
    if (!studio.subs.length) return studio.toast('Generate or import subtitles first.');
    if (!studio.API.key && studio.API.prov !== 'ollama') {
      studio.apiModalOpen = true;
      return;
    }
    busy = true;
    topics = [];
    clips = [];
    try {
      const sorted = [...studio.subs].sort((a, b) => a.s - b.s);
      const transcript = sorted.map((x) => `[${aiTs(x.s)}–${aiTs(x.e)}] ${x.orig !== undefined ? x.orig : x.t}`).join('\n');
      const totalDur = Number(studio.dur) > 0 ? studio.dur : Math.max(...sorted.map((x) => x.e));

      status = 'Pass 1/2: building chronological topic map…';
      const pass1 = `Create a chronological topic map covering the full recording. Merge adjacent segments on the same topic. Use exact source timestamps. Source duration: ${totalDur.toFixed(2)}s. Instructions: ${promptExtra || 'None'}\n\nTRANSCRIPT:\n${transcript}\n\nReturn JSON {"topics":[{"topic":"...","start_seconds":0.0,"end_seconds":60.0,"summary":"..."}]}.`;
      const map = await aiCallJson(studio.API, pass1, 'You are an expert educational/video editor. Return JSON only.');
      topics = (map.topics || []).filter((t) => +t.end_seconds > +t.start_seconds);

      status = `Pass 2/2: selecting up to ${count} self-contained clips…`;
      const pass2 = `Using the topic map and complete transcript, select up to ${count} self-contained clips (max ${maxSec}s each, prefer 45–120s). Never cut mid-sentence or mid-quotation. Return JSON {"clips":[{"title":"...","topic":"...","start_seconds":0.0,"end_seconds":60.0,"hook":"...","summary":"...","quality_score":85}]}.\nTOPIC MAP:\n${JSON.stringify(topics)}\nTRANSCRIPT:\n${transcript}\nExtra: ${promptExtra || 'None'}`;
      const sec = await aiCallJson(studio.API, pass2, 'You are an expert video editor selecting standalone short-form clips. Return JSON only.');
      clips = (sec.clips || [])
        .filter((c) => Number.isFinite(+c.start_seconds) && Number.isFinite(+c.end_seconds) && +c.end_seconds > +c.start_seconds)
        .map((c) => ({ ...c, start_seconds: +c.start_seconds, end_seconds: +c.end_seconds, approved: false }));
      status = `Found ${topics.length} topics and ${clips.length} standalone clips.`;
    } catch (e) {
      status = '❌ ' + (e?.message || e);
    } finally {
      busy = false;
    }
  }

  async function batchExport() {
    const chosen = clips.filter((c) => c.approved);
    if (!chosen.length) return studio.toast('Mark at least one clip Approved first.');
    const oldS = studio.trimS;
    const oldE = studio.trimE;
    for (let i = 0; i < chosen.length; i++) {
      const c = chosen[i];
      studio.trimS = c.start_seconds;
      studio.trimE = c.end_seconds;
      await exportAll({ filename: `${String(i + 1).padStart(2, '0')}_${c.title || 'clip'}` });
    }
    studio.trimS = oldS;
    studio.trimE = oldE;
  }
</script>

<div class="full-page">
  <div style="max-width:1040px;margin:0 auto">
    <CategoryBlock title="AI Transcript-First Viral Clip Finder (2-Pass)" icon="sparkles" open={true}>
      <div class="sg" style="grid-template-columns:2fr 1fr 1fr">
        <label>Source video URL (context only)<input bind:value={url} placeholder="https://youtube.com/..." /></label>
        <label>Target clips<input type="number" min="1" max="30" bind:value={count} /></label>
        <label>Max duration (s)<input type="number" min="15" max="300" bind:value={maxSec} /></label>
      </div>
      <textarea rows="2" style="width:100%;margin-top:8px" bind:value={promptExtra} placeholder="Additional prompt instructions (optional, e.g. prioritize stories, practical reminders)…"></textarea>
      <div class="bar" style="margin-top:8px;margin-bottom:2px">
        <button type="button" class="pri" disabled={busy} onclick={runAiClips}>Run 2-Pass AI Clip Finder</button>
        <button type="button" onclick={() => (studio.apiModalOpen = true)}>AI API Settings</button>
        <button type="button" onclick={batchExport}>Batch Export Approved ({clips.filter((c) => c.approved).length})</button>
        <button
          type="button"
          onclick={() => saveBlob(new Blob([JSON.stringify({ topics, clips }, null, 2)], { type: 'application/json' }), 'ai-clips.json')}
        >
          Export JSON
        </button>
        <span class="hint" style="margin:0">{status}</span>
      </div>
    </CategoryBlock>

    {#if clips.length}
      <div class="clip-grid">
        {#each clips as c}
          <div class="style-category-block" style="padding:12px;margin:0">
            <div class="rt" style="justify-content:space-between">
              <b>{c.title}</b>
              <span class="badge pri mono">{Math.round(c.end_seconds - c.start_seconds)}s · {c.quality_score || 0}/100</span>
            </div>
            <div class="hint" style="margin:4px 0">{fmt(c.start_seconds)} – {fmt(c.end_seconds)} · {c.topic || ''}</div>
            <p style="margin:6px 0;font-size:12.5px">{c.summary || ''}</p>
            <div class="rt">
              <button
                type="button"
                class="sm pri"
                onclick={() => {
                  studio.trimS = c.start_seconds;
                  studio.trimE = c.end_seconds;
                  studio.seek(c.start_seconds);
                  studio.setView('ed');
                  studio.toast('Loaded clip into editor');
                }}
              >
                Use in Editor
              </button>
              <label class="chk-lbl" style="margin-left:auto"><input type="checkbox" bind:checked={c.approved} /> Approved</label>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .full-page {
    grid-area: 2 / 1 / 4 / 3;
    overflow: auto;
    padding: 24px;
    background: var(--bg-primary);
  }
  .clip-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 12px;
  }
  .chk-lbl {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
  }
</style>
