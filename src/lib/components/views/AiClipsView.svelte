<script>
  import {
    REJECT_REASONS,
    exportTrainerJson,
    findSmartClips,
    getTrainerSummary,
    loadTrainerProfile,
    parseTrainerJson,
    recordClipFeedback,
    resetTrainerProfile,
    runSelfTrainingReflection,
    saveTrainerProfile,
  } from '../../aiClipTrainer.js';
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
  let rejectMenuId = $state(null);

  let profile = $state(loadTrainerProfile());
  let trainer = $derived(getTrainerSummary(profile));
  let newRule = $state('');
  let importInput;

  function syncProfile() {
    profile = loadTrainerProfile();
  }

  async function runAiClips() {
    if (!studio.subs.length) return studio.toast('Generate or import subtitles first.');
    if (!studio.API.key && studio.API.prov !== 'ollama') {
      studio.apiModalOpen = true;
      return;
    }
    busy = true;
    topics = [];
    clips = [];
    rejectMenuId = null;
    try {
      const totalDur = Number(studio.dur) > 0 ? studio.dur : Math.max(...studio.subs.map((x) => +x.e || 0));
      const extra = [url.trim() ? `Video URL context: ${url.trim()}` : '', promptExtra.trim()].filter(Boolean).join(' | ');
      const res = await findSmartClips({
        subs: studio.subs,
        totalDur,
        apiCfg: studio.API,
        count,
        maxSec,
        extraPrompt: extra,
        onProgress: (m) => (status = m),
      });
      topics = res.topics || [];
      clips = (res.clips || []).map((c) => ({ ...c, approved: false, rejected: false }));
      syncProfile();
      status = `Found ${topics.length} topics and ${clips.length} boundary-snapped clips (${trainer.ruleCount} rules applied).`;
    } catch (e) {
      status = 'Error: ' + (e?.message || e);
    } finally {
      busy = false;
    }
  }

  function approveClip(c, checked) {
    c.approved = checked;
    if (checked && !c.recordedApprove) {
      c.rejected = false;
      c.recordedApprove = true;
      profile = recordClipFeedback(c, 'approve');
      studio.toast('Approved & added to AI training memory.');
    }
  }

  function rejectClip(c, reasonId) {
    c.approved = false;
    c.rejected = true;
    rejectMenuId = null;
    profile = recordClipFeedback(c, 'reject', { reason: reasonId });
    studio.toast('Feedback recorded — future runs will avoid this pattern.');
  }

  async function trainCoachNow() {
    if (!studio.API.key && studio.API.prov !== 'ollama') {
      studio.apiModalOpen = true;
      return;
    }
    busy = true;
    try {
      profile = await runSelfTrainingReflection(studio.API, (m) => (status = m));
      status = `AI Coach refreshed rules (${profile.learnedRules.length} rules active, ${trainer.daysTrained || 1} day(s) trained).`;
      studio.toast('Self-training reflection complete!');
    } catch (e) {
      status = 'Training error: ' + (e?.message || e);
    } finally {
      busy = false;
    }
  }

  function addCustomRule() {
    const t = newRule.trim();
    if (!t) return;
    profile = saveTrainerProfile({
      ...profile,
      learnedRules: [...profile.learnedRules, t].slice(-10),
    });
    newRule = '';
    studio.toast('Added rule to AI Clip Coach');
  }

  function removeRule(idx) {
    profile = saveTrainerProfile({
      ...profile,
      learnedRules: profile.learnedRules.filter((_, i) => i !== idx),
    });
  }

  async function onImportProfile(e) {
    const f = e.target?.files?.[0];
    if (!f) return;
    try {
      const txt = await f.text();
      profile = parseTrainerJson(txt);
      studio.toast('AI Trainer profile imported!');
    } catch (err) {
      studio.toast('Import failed: ' + (err?.message || err));
    } finally {
      e.target.value = '';
    }
  }

  async function handleResetTrainer() {
    const ok = await studio.askConfirm({
      title: 'Reset AI Training Memory',
      message: 'Clear learned rules, offset biases, and clip examples back to defaults?',
      confirmText: 'Reset Memory',
      danger: true,
    });
    if (!ok) return;
    profile = resetTrainerProfile();
    studio.toast('AI Trainer memory reset to defaults.');
  }

  async function batchExport() {
    const chosen = clips.filter((c) => c.approved);
    if (!chosen.length) return studio.toast('Approve at least one clip first.');
    const oldS = studio.trimS;
    const oldE = studio.trimE;
    const oldAi = studio.activeAiClip;
    for (let i = 0; i < chosen.length; i++) {
      const c = chosen[i];
      studio.trimS = c.start_seconds;
      studio.trimE = c.end_seconds;
      studio.activeAiClip = c;
      await exportAll({ filename: `${String(i + 1).padStart(2, '0')}_${c.title || 'clip'}`, skipTrainerFeedback: true });
      profile = recordClipFeedback(c, 'export');
    }
    studio.trimS = oldS;
    studio.trimE = oldE;
    studio.activeAiClip = oldAi;
  }
</script>

<div class="full-page">
  <div style="max-width:1060px;margin:0 auto">
    <CategoryBlock title="AI Smart Clip Finder (3-Pass Boundary Snap + Critic)" icon="sparkles" open={true}>
      <div class="sg" style="grid-template-columns:2fr 1fr 1fr">
        <label>Source video URL (optional context)<input bind:value={url} placeholder="https://youtube.com/..." /></label>
        <label>Target clips<input type="number" min="1" max="25" bind:value={count} /></label>
        <label>Max duration (s)<input type="number" min="15" max="300" bind:value={maxSec} /></label>
      </div>
      <textarea
        rows="2"
        style="width:100%;margin-top:8px"
        bind:value={promptExtra}
        placeholder="Focus instructions (optional, e.g. prioritize compelling stories, Q&A punchlines, practical advice)…"
      ></textarea>
      <div class="bar" style="margin-top:8px;margin-bottom:2px;flex-wrap:wrap">
        <button type="button" class="pri" disabled={busy} onclick={runAiClips}>
          {busy ? 'Working…' : 'Find Smart Clips'}
        </button>
        <button type="button" onclick={() => (studio.apiModalOpen = true)}>AI API Settings</button>
        <button type="button" onclick={batchExport}>Batch Export Approved ({clips.filter((c) => c.approved).length})</button>
        <button
          type="button"
          onclick={() => saveBlob(new Blob([JSON.stringify({ topics, clips }, null, 2)], { type: 'application/json' }), 'ai-clips.json')}
        >
          Export Clips JSON
        </button>
        <span class="hint" style="margin:0">{status}</span>
      </div>
    </CategoryBlock>

    <CategoryBlock title="Self-Training AI Coach (Learns Day by Day)" icon="sliders" open={false}>
      <div class="stats-row">
        <div class="stat-pill"><span class="hint">Days Trained</span><b class="mono">{trainer.daysTrained}</b></div>
        <div class="stat-pill"><span class="hint">Approved</span><b class="mono">{trainer.approved}</b></div>
        <div class="stat-pill"><span class="hint">Rejected</span><b class="mono">{trainer.rejected}</b></div>
        <div class="stat-pill"><span class="hint">Trim Corrections</span><b class="mono">{trainer.trimCorrected}</b></div>
        <div class="stat-pill"><span class="hint">Sweet Spot</span><b class="mono">~{trainer.preferredDurSec}s</b></div>
        <div class="stat-pill">
          <span class="hint">Trim Bias</span>
          <b class="mono">{trainer.startBiasMs >= 0 ? '+' : ''}{trainer.startBiasMs}ms / {trainer.endBiasMs >= 0 ? '+' : ''}{trainer.endBiasMs}ms</b>
        </div>
      </div>

      <div class="bar" style="margin:10px 0;flex-wrap:wrap">
        <button
          type="button"
          class="pri sm"
          disabled={busy || trainer.approved + trainer.rejected + trainer.exported + trainer.trimCorrected === 0}
          onclick={trainCoachNow}
        >
          Reflect & Update Rules Now ({trainer.pendingSignals} new signals)
        </button>
        <button
          type="button"
          class="sm"
          onclick={() => saveBlob(new Blob([exportTrainerJson(profile)], { type: 'application/json' }), 'ai-clip-trainer.json')}
        >
          Export Coach Memory
        </button>
        <button type="button" class="sm" onclick={() => importInput?.click()}>Import Coach Memory</button>
        <input bind:this={importInput} type="file" accept=".json" style="display:none" onchange={onImportProfile} />
        <button type="button" class="sm" style="margin-left:auto" onclick={handleResetTrainer}>Reset Memory</button>
      </div>

      <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
        <div class="hint" style="margin:0">Active Editing Rules injected into every AI Clip run:</div>
        {#each profile.learnedRules as rule, idx}
          <div class="sub-card" style="display:flex;align-items:center;gap:8px;padding:8px 10px">
            <span class="badge mono">{idx + 1}</span>
            <span style="flex:1;font-size:12px">{rule}</span>
            <button type="button" class="xs" onclick={() => removeRule(idx)} title="Remove rule">✕</button>
          </div>
        {/each}
        <div class="bar" style="margin-top:4px">
          <input type="text" style="flex:1" placeholder="Teach AI a custom rule (e.g. Never pick clips under 25s…)" bind:value={newRule} />
          <button type="button" class="sm pri" onclick={addCustomRule}>Add Rule</button>
        </div>
      </div>
    </CategoryBlock>

    {#if clips.length}
      <div class="clip-grid">
        {#each clips as c}
          <div class="style-category-block" style="padding:12px;margin:0;opacity:{c.rejected ? 0.58 : 1}">
            <div class="rt" style="justify-content:space-between;gap:6px">
              <b>{c.title}</b>
              <span class="badge pri mono">{Math.round(c.end_seconds - c.start_seconds)}s · {c.quality_score || 0}/100</span>
            </div>
            <div class="hint mono" style="margin:4px 0">
              {fmt(c.start_seconds)} – {fmt(c.end_seconds)} · {c.hook_grade || 'Hook'} · {c.ending_grade || 'End'}
            </div>
            {#if c.opening_text}
              <div class="hint" style="margin:3px 0;color:var(--t1)">Start: “{c.opening_text.slice(0, 95)}{c.opening_text.length > 95 ? '…' : ''}”</div>
            {/if}
            {#if c.closing_text}
              <div class="hint" style="margin:2px 0">End: “{c.closing_text.slice(0, 95)}{c.closing_text.length > 95 ? '…' : ''}”</div>
            {/if}
            <p style="margin:6px 0;font-size:12.5px">{c.critic_note || c.summary || ''}</p>
            <div class="rt" style="flex-wrap:wrap;gap:6px">
              <button
                type="button"
                class="sm pri"
                onclick={() => {
                  studio.trimS = c.start_seconds;
                  studio.trimE = c.end_seconds;
                  studio.activeAiClip = { ...c };
                  studio.seek(c.start_seconds);
                  studio.setView('ed');
                  studio.toast('Loaded clip — timeline edits & exports train the AI!');
                }}
              >
                Use in Editor
              </button>
              <button
                type="button"
                class="sm"
                onclick={() => (rejectMenuId = rejectMenuId === c.id ? null : c.id)}
              >
                {c.rejected ? 'Rejected' : 'Reject'}
              </button>
              <label class="chk-lbl" style="margin-left:auto">
                <input type="checkbox" checked={c.approved} onchange={(e) => approveClip(c, e.currentTarget.checked)} /> Approved
              </label>
            </div>
            {#if rejectMenuId === c.id}
              <div class="bar" style="gap:4px;margin-top:8px;flex-wrap:wrap">
                {#each REJECT_REASONS as rr}
                  <button type="button" class="xs" onclick={() => rejectClip(c, rr.id)}>{rr.label}</button>
                {/each}
              </div>
            {/if}
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
  .stats-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 8px;
  }
  .stat-pill {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border: 1px solid var(--bd);
    border-radius: var(--r-md);
    background: var(--bg-input);
    font-size: 12px;
  }
</style>
