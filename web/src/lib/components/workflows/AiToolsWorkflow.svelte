<script>
  import {
    APPROVE_TAGS,
    CONTENT_CATEGORIES,
    REJECT_REASONS,
    findSmartClips,
    getTrainerSummary,
    loadTrainerProfile,
    recordClipFeedback,
    recordTrimAdjustment,
    runSelfTrainingReflection,
  } from '../../aiClipTrainer.js';
  import { fmt, studio } from '../../state.svelte.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import Icon from '../Icon.svelte';

  let aiCategory = $state('auto');
  let aiCount = $state(6);
  let aiMax = $state(120);
  let aiFocus = $state('');
  let aiBusy = $state(false);
  let aiStatus = $state('');
  let aiClips = $state([]);
  let rejectMenuId = $state(null);
  let approveMenuId = $state(null);
  let showMemory = $state(false);
  let trainer = $state(getTrainerSummary(loadTrainerProfile()));

  function refreshTrainer() {
    trainer = getTrainerSummary(loadTrainerProfile());
  }

  async function findViralClips() {
    if (!studio.subs.length) return studio.toast('Generate subtitles first in the Subtitles tab.');
    if (!studio.hasAiAccess()) {
      studio.apiModalOpen = true;
      return;
    }
    aiBusy = true;
    aiClips = [];
    rejectMenuId = null;
    approveMenuId = null;
    try {
      const res = await findSmartClips({
        subs: studio.subs,
        totalDur: studio.dur || 0,
        apiCfg: studio.API,
        count: aiCount,
        minSec: 45,
        maxSec: aiMax,
        category: aiCategory,
        extraPrompt: aiFocus.trim(),
        onProgress: (m) => (aiStatus = m),
      });
      aiClips = res.clips || [];
      refreshTrainer();
      aiStatus = `Found ${aiClips.length} standalone reels (${(res.detected_category || 'lecture').replace(/_/g, ' ')}).`;
    } catch (e) {
      aiStatus = 'Error: ' + (e?.message || e);
    } finally {
      aiBusy = false;
    }
  }

  function applyAiClip(c) {
    studio.trimS = +c.start_seconds;
    studio.trimE = +c.end_seconds;
    studio.activeAiClip = { ...c };
    studio.seek(+c.start_seconds);
    recordClipFeedback(c, 'preview_open', { category: c.category });
    refreshTrainer();
    studio.toast('Clip loaded — manual trims or exports teach Editorial Intelligence!');
  }

  function markClipFeedback(c, action, reasonOrTag = '') {
    if (action === 'approve') {
      recordClipFeedback(c, 'approve', {
        category: c.category,
        positiveTags: reasonOrTag ? [reasonOrTag] : [],
      });
      c.feedback = 'approve';
      approveMenuId = c.id;
      rejectMenuId = null;
    } else {
      recordClipFeedback(c, 'reject', { reason: reasonOrTag, category: c.category });
      c.feedback = 'reject';
      rejectMenuId = null;
      approveMenuId = null;
    }
    refreshTrainer();
    studio.toast(action === 'approve' ? 'Approved! Editorial Intelligence updated.' : 'Rejection logged — AI will adapt.');
  }

  function saveCurrentTrimAsExample() {
    if (!(studio.trimE > studio.trimS)) return studio.toast('Set a valid trim range on the timeline first.');
    if (studio.activeAiClip) {
      recordTrimAdjustment(studio.activeAiClip, studio.trimS, studio.trimE, studio.subs);
      studio.activeAiClip = { ...studio.activeAiClip, start_seconds: studio.trimS, end_seconds: studio.trimE };
    } else {
      recordClipFeedback(
        {
          id: `manual_${Math.round(studio.trimS * 10)}_${Math.round(studio.trimE * 10)}`,
          title: studio.projectName?.trim() || 'Manual Good Clip',
          start_seconds: studio.trimS,
          end_seconds: studio.trimE,
          quality_score: 95,
        },
        'approve',
        { cues: studio.subs.map((x) => ({ s: +x.s, e: +x.e, text: String(x.orig ?? x.t ?? '') })) }
      );
    }
    refreshTrainer();
    studio.toast('Timeline range saved to AI training memory!');
  }

  async function trainAiCoachNow() {
    if (!studio.hasAiAccess()) {
      studio.apiModalOpen = true;
      return;
    }
    aiBusy = true;
    try {
      await runSelfTrainingReflection(studio.API, (m) => (aiStatus = m));
      refreshTrainer();
      aiStatus = `Self-training complete (${trainer.ruleCount} active rules, ${trainer.daysTrained || 1} day(s)).`;
      studio.toast('AI Clip Coach updated its rules!');
    } catch (e) {
      aiStatus = 'Training error: ' + (e?.message || e);
    } finally {
      aiBusy = false;
    }
  }
</script>

<CategoryBlock title="AI Lecture-to-Reels" icon="sparkles" open={true}>
  <div class="hint" style="margin:0 0 8px">
    Extract standalone short clips with strong hooks and clean endings from your transcript.
  </div>

  {#if !studio.subs.length}
    <div class="sub-card" style="margin-bottom:8px">
      <div class="hint" style="margin:0 0 6px;color:var(--t1)">
        Step 1: Generate subtitles first so AI can analyze the lecture transcript.
      </div>
      <button type="button" class="xs pri" onclick={() => { studio.leftTab = 'subtitles'; studio.subTab = 'gen'; }}>
        Go to Subtitles →
      </button>
    </div>
  {/if}

  <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--t2);margin-bottom:6px">
    Content Category
    <select bind:value={aiCategory}>
      {#each CONTENT_CATEGORIES as cat}
        <option value={cat.id}>{cat.label}</option>
      {/each}
    </select>
  </label>

  <div class="sg">
    <label>Max reels<input type="number" min="1" max="20" bind:value={aiCount} /></label>
    <label>Max sec<input type="number" min="30" max="300" bind:value={aiMax} /></label>
  </div>

  <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--t2);margin-top:6px">
    Topic / Hook Focus (optional)
    <input type="text" placeholder="e.g. stories, strong emotional advice, debates…" bind:value={aiFocus} />
  </label>

  <div class="bar" style="margin-top:8px">
    <button type="button" class="pri sm" style="flex:1" disabled={aiBusy} onclick={findViralClips}>
      <Icon name="sparkles" size={13} />
      {aiBusy ? 'Analyzing…' : 'Find Smart Clips'}
    </button>
    <button type="button" class="sm" onclick={() => { studio.mobileSheet = null; studio.nav = 'ai'; }} title="Open full Editorial Intelligence & Reels Studio">Full Studio</button>
  </div>

  {#if aiStatus}
    <div class="hint" style="margin-top:6px">{aiStatus}</div>
  {/if}

  <button type="button" class="adv-toggle" aria-expanded={showMemory} onclick={() => (showMemory = !showMemory)}>
    <span>Editorial Intelligence Memory (v{trainer.profileVersion} · {trainer.reviewed} reviewed)</span>
    <Icon name={showMemory ? 'chev-up' : 'chev-down'} size={13} />
  </button>

  {#if showMemory}
    <div class="adv-box">
      <div class="hint" style="margin:0 0 6px">
        Target ~{trainer.preferredDurSec}s
        {#if trainer.acceptanceRate !== null} · {trainer.acceptanceRate}% accepted{/if}
        {#if trainer.pendingSignals > 0} · {trainer.pendingSignals} new signals{/if}
      </div>
      <div class="bar" style="gap:4px">
        <button type="button" class="xs" style="flex:1" disabled={aiBusy} onclick={saveCurrentTrimAsExample} title="Save current timeline trim range as a positive training example">
          + Save Current Trim
        </button>
        <button
          type="button"
          class="xs pri"
          disabled={aiBusy || trainer.exampleCount === 0}
          onclick={trainAiCoachNow}
          title="Reflect accumulated feedback into updated editorial rules"
        >
          Reflect ({trainer.pendingSignals})
        </button>
        <button type="button" class="xs" onclick={() => (studio.apiModalOpen = true)}>AI Keys</button>
      </div>
    </div>
  {/if}

  {#each aiClips as c}
    <div class="sub-card" style="margin-top:8px">
      <div class="rt" style="justify-content:space-between;gap:6px">
        <b style="flex:1">{c.title}</b>
        <span class="badge pri mono">{Math.round(c.end_seconds - c.start_seconds)}s</span>
        <span class="badge mono">{c.quality_score ?? 85}</span>
      </div>
      <div class="hint mono" style="margin:3px 0">
        {fmt(+c.start_seconds)} – {fmt(+c.end_seconds)} · {c.hook_grade || 'Hook'} · {c.ending_grade || 'End'}
      </div>
      {#if c.opening_text}
        <div class="hint" style="margin:2px 0;color:var(--t1)">“{c.opening_text.slice(0, 78)}{c.opening_text.length > 78 ? '…' : ''}”</div>
      {/if}
      {#if c.critic_note}
        <div class="hint" style="margin:2px 0 6px">{c.critic_note}</div>
      {/if}
      <div class="bar" style="gap:4px;margin-top:6px;flex-wrap:wrap">
        <button type="button" class="xs pri" style="flex:1" onclick={() => applyAiClip(c)}>
          Load on Timeline
        </button>
        <button
          type="button"
          class="xs"
          class:pri={c.feedback === 'approve'}
          onclick={() => markClipFeedback(c, 'approve')}
          title="Approve clip (teaches AI to find more like this)"
        >
          <Icon name="check" size={12} />
        </button>
        <button
          type="button"
          class="xs"
          onclick={() => (rejectMenuId = rejectMenuId === c.id ? null : c.id)}
          title="Reject clip (tell AI what went wrong)"
        >
          <Icon name="x" size={12} />
        </button>
      </div>
      {#if approveMenuId === c.id}
        <div class="bar" style="gap:4px;margin-top:6px;flex-wrap:wrap">
          {#each APPROVE_TAGS.slice(0, 6) as tag}
            <button type="button" class="xs" onclick={() => markClipFeedback(c, 'approve', tag.id)}>
              +{tag.label}
            </button>
          {/each}
        </div>
      {/if}
      {#if rejectMenuId === c.id}
        <div class="bar" style="gap:4px;margin-top:6px;flex-wrap:wrap">
          {#each REJECT_REASONS as rr}
            <button type="button" class="xs" onclick={() => markClipFeedback(c, 'reject', rr.id)}>
              {rr.label}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</CategoryBlock>

<CategoryBlock title="AI Subtitle & Language Tools" icon="translate" open={true}>
  <div class="hint" style="margin:0 0 8px">
    Jump directly to AI-powered subtitle editing and translation tools.
  </div>
  <div style="display:flex;flex-direction:column;gap:6px">
    <button type="button" class="sm" style="justify-content:space-between;width:100%" onclick={() => { studio.leftTab = 'subtitles'; studio.subTab = 'edit'; }}>
      <span>AI Smart Segmentation & Proofread</span>
      <span class="badge">Subtitles</span>
    </button>
    <button type="button" class="sm" style="justify-content:space-between;width:100%" onclick={() => { studio.mobileSheet = null; studio.nav = 'translate'; }}>
      <span>Translation Desk (Bilingual Subtitles)</span>
      <span class="badge">Workspace</span>
    </button>
  </div>
</CategoryBlock>
