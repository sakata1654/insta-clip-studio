<script>
  import {
    APPROVE_TAGS,
    CONTENT_CATEGORIES,
    REJECT_REASONS,
    buildFineTuneDataset,
    evaluateAgainstBenchmark,
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

  let category = $state('auto');
  let count = $state(8);
  let minSec = $state(45);
  let maxSec = $state(120);
  let promptExtra = $state('');
  let busy = $state(false);
  let status = $state('');
  let lectureMeta = $state({ main_subject: '', detected_category: '', fromCache: false });
  let topics = $state([]);
  let clips = $state([]);
  let rejectMenuId = $state(null);
  let approveMenuId = $state(null);
  let benchmarkReport = $state(null);

  let profile = $state(loadTrainerProfile());
  let trainer = $derived(getTrainerSummary(profile));
  let fineTuneInfo = $derived(buildFineTuneDataset(profile));
  let newRule = $state('');
  let importInput;

  function syncProfile() {
    profile = loadTrainerProfile();
  }

  async function runAiClips() {
    if (!studio.subs.length) return studio.toast('Generate or import subtitles first.');
    if (!(studio.hasAiAccess ? studio.hasAiAccess() : studio.API.key || studio.API.prov === 'ollama')) {
      studio.apiModalOpen = true;
      return;
    }
    busy = true;
    topics = [];
    clips = [];
    rejectMenuId = null;
    approveMenuId = null;
    try {
      const totalDur = Number(studio.dur) > 0 ? studio.dur : Math.max(...studio.subs.map((x) => +x.e || 0));
      const res = await findSmartClips({
        subs: studio.subs,
        totalDur,
        apiCfg: studio.API,
        count,
        minSec,
        maxSec,
        category,
        extraPrompt: promptExtra.trim(),
        onProgress: (m) => (status = m),
      });
      lectureMeta = {
        main_subject: res.main_subject || '',
        detected_category: res.detected_category || category,
        fromCache: !!res.fromCache,
      };
      topics = res.topics || [];
      clips = (res.clips || []).map((c) => ({ ...c, approved: false, rejected: false, positiveTags: [] }));
      syncProfile();
      status = `Found ${topics.length} lecture sections and ${clips.length} standalone reels (${lectureMeta.detected_category.replace(/_/g, ' ')}).`;
    } catch (e) {
      status = 'Error: ' + (e?.message || e);
    } finally {
      busy = false;
    }
  }

  function approveClip(c, checked, tagId = null) {
    if (tagId) {
      if (!c.positiveTags.includes(tagId)) c.positiveTags = [...c.positiveTags, tagId];
      c.approved = true;
      c.rejected = false;
      profile = recordClipFeedback(c, 'approve', { positiveTags: [tagId], category: c.category });
      studio.toast(`Tagged "${APPROVE_TAGS.find((t) => t.id === tagId)?.label}"`);
      return;
    }
    c.approved = checked;
    if (checked) {
      c.rejected = false;
      approveMenuId = c.id;
      if (!c.recordedApprove) {
        c.recordedApprove = true;
        profile = recordClipFeedback(c, 'approve', { category: c.category });
        studio.toast('Approved — optionally tap what worked well.');
      }
    } else if (approveMenuId === c.id) {
      approveMenuId = null;
    }
  }

  function rejectClip(c, reasonId) {
    c.approved = false;
    c.rejected = true;
    rejectMenuId = null;
    approveMenuId = null;
    profile = recordClipFeedback(c, 'reject', { reason: reasonId, category: c.category });
    studio.toast('Rejection logged to Editorial Intelligence.');
  }

  function loadIntoTimeline(c) {
    studio.trimS = c.start_seconds;
    studio.trimE = c.end_seconds;
    studio.activeAiClip = { ...c };
    studio.seek(c.start_seconds);
    profile = recordClipFeedback(c, 'preview_open', { category: c.category });
    studio.setView('ed');
    studio.toast('Loaded into timeline — manual boundary edits & exports auto-train the AI!');
  }

  async function trainCoachNow() {
    if (!(studio.hasAiAccess ? studio.hasAiAccess() : studio.API.key || studio.API.prov === 'ollama')) {
      studio.apiModalOpen = true;
      return;
    }
    busy = true;
    try {
      const catFocus = lectureMeta.detected_category || (category !== 'auto' ? category : 'general');
      profile = await runSelfTrainingReflection(studio.API, (m) => (status = m), undefined, catFocus);
      status = `Editorial Intelligence v${profile.profileVersion} updated (${profile.learnedRules.length} rules active).`;
      studio.toast('Editorial preferences updated!');
    } catch (e) {
      status = 'Reflection error: ' + (e?.message || e);
    } finally {
      busy = false;
    }
  }

  function toggleLearningEnabled() {
    profile = saveTrainerProfile({ ...profile, learningEnabled: !profile.learningEnabled });
    studio.toast(profile.learningEnabled ? 'Editorial learning enabled' : 'Editorial learning paused');
  }

  function disableLearnedPreference(prefId) {
    const next = new Set(profile.disabledPreferences || []);
    next.add(prefId);
    profile = saveTrainerProfile({ ...profile, disabledPreferences: [...next] });
    studio.toast('Preference hidden/overridden');
  }

  function addCustomRule() {
    const t = newRule.trim();
    if (!t) return;
    profile = saveTrainerProfile({
      ...profile,
      profileVersion: (profile.profileVersion || 1) + 1,
      learnedRules: [...profile.learnedRules, t].slice(-12),
    });
    newRule = '';
    studio.toast('Added custom editorial rule');
  }

  function removeRule(idx) {
    profile = saveTrainerProfile({
      ...profile,
      learnedRules: profile.learnedRules.filter((_, i) => i !== idx),
    });
  }

  function runBenchmarkNow() {
    benchmarkReport = evaluateAgainstBenchmark(profile, true);
    syncProfile();
    studio.toast('Evaluated ranker against historical benchmark examples');
  }

  async function onImportProfile(e) {
    const f = e.target?.files?.[0];
    if (!f) return;
    try {
      const txt = await f.text();
      profile = parseTrainerJson(txt);
      studio.toast('Editorial Intelligence profile imported!');
    } catch (err) {
      studio.toast('Import failed: ' + (err?.message || err));
    } finally {
      e.target.value = '';
    }
  }

  async function handleResetTrainer() {
    const ok = await studio.confirm({
      title: 'Reset Editorial Intelligence',
      message: 'Clear learned preferences, examples, category profiles, and adaptive ranking weights back to baseline?',
      confirmText: 'Reset Profile',
      danger: true,
    });
    if (!ok) return;
    profile = resetTrainerProfile();
    benchmarkReport = null;
    studio.toast('Editorial Intelligence reset to baseline standards.');
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
      await exportAll({ filename: `${String(i + 1).padStart(2, '0')}_${c.title || 'reel'}`, skipTrainerFeedback: true });
      profile = recordClipFeedback(c, 'export', { category: c.category });
    }
    studio.trimS = oldS;
    studio.trimE = oldE;
    studio.activeAiClip = oldAi;
  }
</script>

<div class="full-page">
  <div style="max-width:1100px;margin:0 auto">
    <CategoryBlock title="AI Lecture-to-Reels Engine (4-Pass Comprehension & Context Critic)" icon="sparkles" open={true}>
      <div class="sg" style="grid-template-columns:repeat(auto-fit, minmax(150px, 1fr))">
        <label>
          Content Category
          <select bind:value={category}>
            {#each CONTENT_CATEGORIES as c}
              <option value={c.id}>{c.label}</option>
            {/each}
          </select>
        </label>
        <label>Max Reels (Quality first)<input type="number" min="1" max="20" bind:value={count} /></label>
        <label>Min Duration (s)<input type="number" min="15" max="180" bind:value={minSec} /></label>
        <label>Max Duration (s)<input type="number" min="30" max="300" bind:value={maxSec} /></label>
      </div>
      <textarea
        rows="2"
        style="width:100%;margin-top:8px"
        bind:value={promptExtra}
        placeholder="Editorial direction (optional, e.g. focus on practical Q&A explanations, stories with clear lessons, avoid tangential intros)…"
      ></textarea>
      <div class="bar" style="margin-top:8px;margin-bottom:2px;flex-wrap:wrap">
        <button type="button" class="pri" disabled={busy} onclick={runAiClips}>
          {busy ? 'Analyzing Lecture…' : 'Analyze Lecture & Generate Reels'}
        </button>
        <button type="button" onclick={() => (studio.apiModalOpen = true)}>AI API Settings</button>
        <button type="button" onclick={batchExport}>Batch Export Approved ({clips.filter((c) => c.approved).length})</button>
        <button
          type="button"
          onclick={() => saveBlob(new Blob([JSON.stringify({ lectureMeta, topics, clips }, null, 2)], { type: 'application/json' }), 'lecture-reels.json')}
        >
          Export Clips JSON
        </button>
        <span class="hint" style="margin:0">{status}</span>
      </div>
      {#if lectureMeta.main_subject}
        <div class="sub-card rt" style="margin-top:8px;justify-content:space-between;flex-wrap:wrap;gap:6px">
          <span style="font-size:12px"><b>Lecture Thesis:</b> {lectureMeta.main_subject}</span>
          <div class="rt" style="gap:4px">
            <span class="badge pri">{lectureMeta.detected_category.replace(/_/g, ' ')}</span>
            {#if lectureMeta.fromCache}<span class="badge ok">Cached Analysis</span>{/if}
          </div>
        </div>
      {/if}
    </CategoryBlock>

    <!-- Honest, Evidence-Backed Editorial Intelligence Dashboard -->
    <CategoryBlock title="Editorial Intelligence (Hybrid 4-Layer Learning Architecture)" icon="sliders" open={true}>
      <div class="rt" style="justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px">
        <div class="rt" style="gap:8px;flex-wrap:wrap">
          <span class="badge" class:ok={trainer.learningEnabled} class:warn={!trainer.learningEnabled}>
            {trainer.learningEnabled ? 'Learning Enabled' : 'Learning Paused'}
          </span>
          <span class="badge mono">Profile v{trainer.profileVersion}</span>
          <span class="badge mono">{trainer.daysTrained} active day(s)</span>
          {#if trainer.categoryCount > 0}
            <span class="badge mono">{trainer.categoryCount} category profiles</span>
          {/if}
        </div>
        <button type="button" class="xs" onclick={toggleLearningEnabled}>
          {trainer.learningEnabled ? 'Pause Learning' : 'Resume Learning'}
        </button>
      </div>

      <div class="stats-row">
        <div class="stat-pill"><span class="hint">Clips Reviewed</span><b class="mono">{trainer.reviewed}</b></div>
        <div class="stat-pill"><span class="hint">Approved</span><b class="mono">{trainer.approved}</b></div>
        <div class="stat-pill"><span class="hint">Manual Corrections</span><b class="mono">{trainer.trimCorrected}</b></div>
        <div class="stat-pill"><span class="hint">Rejections Logged</span><b class="mono">{trainer.rejected}</b></div>
        <div class="stat-pill">
          <span class="hint">Acceptance Rate</span>
          <b class="mono">{trainer.acceptanceRate !== null ? `${trainer.acceptanceRate}%` : '—'}</b>
        </div>
        <div class="stat-pill">
          <span class="hint">Avg Boundary Shift</span>
          <b class="mono">{trainer.avgDeltaStartSec}s / {trainer.avgDeltaEndSec}s</b>
        </div>
      </div>

      {#if trainer.learnedPreferences.length}
        <div style="margin-top:10px">
          <div class="hint" style="margin:0 0 6px">Learned Preferences (derived strictly from recorded feedback):</div>
          <div style="display:flex;flex-direction:column;gap:5px">
            {#each trainer.learnedPreferences as lp (lp.id)}
              <div class="sub-card rt" style="margin:0;padding:7px 10px;justify-content:space-between;gap:8px">
                <span style="font-size:12px">{lp.text}</span>
                <div class="rt" style="gap:6px;flex-shrink:0">
                  <span class="badge mono">{Math.round((lp.confidence || 0) * 100)}% conf</span>
                  <button type="button" class="xs" onclick={() => disableLearnedPreference(lp.id)} title="Override / disable this preference">✕</button>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <div class="bar" style="margin:12px 0 8px;flex-wrap:wrap">
        <button
          type="button"
          class="pri sm"
          disabled={busy || trainer.exampleCount === 0}
          onclick={trainCoachNow}
        >
          Reflect Feedback into Rules ({trainer.pendingSignals} new signals)
        </button>
        <button type="button" class="sm" disabled={trainer.exampleCount < 2} onclick={runBenchmarkNow}>
          Evaluate Ranker Benchmark
        </button>
        <button
          type="button"
          class="sm"
          onclick={() => saveBlob(new Blob([exportTrainerJson(profile)], { type: 'application/json' }), 'editorial-intelligence.json')}
        >
          Export Profile JSON
        </button>
        <button type="button" class="sm" onclick={() => importInput?.click()}>Import Profile</button>
        <input bind:this={importInput} type="file" accept=".json" style="display:none" onchange={onImportProfile} />
        <button type="button" class="sm" style="margin-left:auto" onclick={handleResetTrainer}>Reset Profile</button>
      </div>

      {#if benchmarkReport}
        <div class="sub-card" style="margin:6px 0">
          <div class="rt" style="justify-content:space-between">
            <b style="font-size:12px">Layer 3 Benchmark vs. Historical Examples</b>
            <span class="badge pri mono">
              {benchmarkReport.pairwiseAccuracy !== null ? `${benchmarkReport.pairwiseAccuracy}% Pairwise Accuracy` : 'Need both + and - examples'}
            </span>
          </div>
          <div class="hint" style="margin:4px 0 0">
            Tested {benchmarkReport.benchmarkPairs} positive-vs-rejected candidate pairs ({benchmarkReport.positiveSamples} accepted/corrected · {benchmarkReport.negativeSamples} rejected).
          </div>
        </div>
      {/if}

      <!-- Layer 4 Honest Fine-Tuning Readiness -->
      <div class="sub-card" style="margin:8px 0">
        <div class="rt" style="justify-content:space-between;flex-wrap:wrap;gap:6px">
          <b style="font-size:12px">Layer 4: Optional External Fine-Tuning Dataset</b>
          <div class="rt" style="gap:6px">
            <span class="badge" class:ok={fineTuneInfo.readyForExternalFineTune}>
              {fineTuneInfo.trainCount} train / {fineTuneInfo.evalCount} eval clean
            </span>
            {#if fineTuneInfo.totalClean > 0}
              <button
                type="button"
                class="xs"
                onclick={() => {
                  saveBlob(new Blob([fineTuneInfo.trainJsonl], { type: 'application/jsonl' }), 'lecture-reels-train.jsonl');
                  if (fineTuneInfo.evalJsonl) saveBlob(new Blob([fineTuneInfo.evalJsonl], { type: 'application/jsonl' }), 'lecture-reels-eval.jsonl');
                  studio.toast('Exported clean JSONL training/eval splits');
                }}
              >
                Export .JSONL
              </button>
            {/if}
          </div>
        </div>
        <div class="hint" style="margin:4px 0 0">{fineTuneInfo.reason} No lecture data is ever sent to external model training automatically.</div>
      </div>

      <details style="margin-top:8px">
        <summary class="hint" style="cursor:pointer;margin:0">View &amp; Edit Active Prompt Rules ({profile.learnedRules.length})</summary>
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
          {#each profile.learnedRules as rule, idx}
            <div class="sub-card" style="display:flex;align-items:center;gap:8px;padding:7px 10px;margin:0">
              <span class="badge mono">{idx + 1}</span>
              <span style="flex:1;font-size:12px">{rule}</span>
              <button type="button" class="xs" onclick={() => removeRule(idx)} title="Remove rule">✕</button>
            </div>
          {/each}
          <div class="bar" style="margin-top:4px">
            <input type="text" style="flex:1" placeholder="Add manual rule (e.g. Always keep scholar's concluding advice…)" bind:value={newRule} />
            <button type="button" class="sm pri" onclick={addCustomRule}>Add Rule</button>
          </div>
        </div>
      </details>
    </CategoryBlock>

    {#if clips.length}
      <div class="clip-grid">
        {#each clips as c}
          <div class="style-category-block" style="padding:12px;margin:0;opacity:{c.rejected ? 0.52 : 1}">
            <div class="rt" style="justify-content:space-between;gap:6px">
              <b>{c.title}</b>
              <span class="badge pri mono">{Math.round(c.end_seconds - c.start_seconds)}s · {c.rank_score ?? c.quality_score}/100</span>
            </div>
            <div class="hint mono" style="margin:4px 0">
              {fmt(c.start_seconds)} – {fmt(c.end_seconds)} · {c.moment_type || 'reel'} · {c.hook_grade || 'Natural'}
            </div>
            {#if c.critical_scores}
              <div class="rt" style="gap:4px;flex-wrap:wrap;margin:4px 0">
                <span class="badge">Open {c.critical_scores.natural_beginning}</span>
                <span class="badge">Thought {c.critical_scores.complete_thought}</span>
                <span class="badge">Context {c.critical_scores.standalone_context}</span>
                <span class="badge">End {c.critical_scores.natural_ending}</span>
              </div>
            {/if}
            {#if c.opening_text}
              <div class="hint" style="margin:3px 0;color:var(--text-primary)">Start: “{c.opening_text.slice(0, 100)}{c.opening_text.length > 100 ? '…' : ''}”</div>
            {/if}
            {#if c.closing_text}
              <div class="hint" style="margin:2px 0">End: “{c.closing_text.slice(0, 100)}{c.closing_text.length > 100 ? '…' : ''}”</div>
            {/if}
            <p style="margin:6px 0;font-size:12.3px">{c.critic_note || c.summary || ''}</p>
            <div class="rt" style="flex-wrap:wrap;gap:6px">
              <button type="button" class="sm pri" onclick={() => loadIntoTimeline(c)}>Use in Editor</button>
              <button type="button" class="sm" onclick={() => ((rejectMenuId = rejectMenuId === c.id ? null : c.id), (approveMenuId = null))}>
                {c.rejected ? 'Rejected' : 'Reject Why?'}
              </button>
              <label class="chk-lbl" style="margin-left:auto">
                <input type="checkbox" checked={c.approved} onchange={(e) => approveClip(c, e.currentTarget.checked)} /> Approved
              </label>
            </div>

            {#if approveMenuId === c.id && c.approved}
              <div class="sub-card" style="margin:8px 0 0;padding:7px">
                <div class="hint" style="margin:0 0 4px;font-size:10.5px">Optional positive tags (what worked well?):</div>
                <div class="bar" style="gap:4px;margin:0">
                  {#each APPROVE_TAGS as tag}
                    <button
                      type="button"
                      class="xs"
                      class:pri={c.positiveTags?.includes(tag.id)}
                      onclick={() => approveClip(c, true, tag.id)}
                    >
                      {tag.label}
                    </button>
                  {/each}
                </div>
              </div>
            {/if}

            {#if rejectMenuId === c.id}
              <div class="sub-card" style="margin:8px 0 0;padding:7px">
                <div class="hint" style="margin:0 0 4px;font-size:10.5px">Why reject? (teaches Editorial Intelligence):</div>
                <div class="bar" style="gap:4px;margin:0">
                  {#each REJECT_REASONS as rr}
                    <button type="button" class="xs" onclick={() => rejectClip(c, rr.id)}>{rr.label}</button>
                  {/each}
                </div>
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
    grid-column: 1 / -1;
    grid-row: 2 / -1;
    overflow: auto;
    padding: 20px 16px calc(24px + var(--sab, 0px));
    background: var(--bg-primary);
  }
  .clip-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(295px, 1fr));
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
    grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
    gap: 8px;
  }
  .stat-pill {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 10px;
    border: 1px solid var(--bd, var(--border-color));
    border-radius: var(--radius-md, 7px);
    background: var(--bg-input);
    font-size: 12px;
  }
</style>
