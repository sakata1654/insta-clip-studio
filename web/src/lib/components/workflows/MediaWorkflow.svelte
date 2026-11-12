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
  import { importVideoFromUrl, openVideoFile, pickAndOpenVideo } from '../../mediaHelpers.js';
  import { fmt, studio } from '../../state.svelte.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import Icon from '../Icon.svelte';
  import AssetsPanel from '../panels/AssetsPanel.svelte';

  let subTab = $state('import'); // 'import' | 'dl' | 'assets' | 'ai'
  let vidIn = $state(null);

  // Direct CORS video URL import state
  let dlUrl = $state('');
  let dlBusy = $state(false);
  let dlStatus = $state('');

  // AI clips & Editorial Intelligence state
  let aiCategory = $state('auto');
  let aiCount = $state(6);
  let aiMax = $state(120);
  let aiFocus = $state('');
  let aiBusy = $state(false);
  let aiStatus = $state('');
  let aiClips = $state([]);
  let rejectMenuId = $state(null);
  let approveMenuId = $state(null);
  let trainer = $state(getTrainerSummary(loadTrainerProfile()));

  function refreshTrainer() {
    trainer = getTrainerSummary(loadTrainerProfile());
  }

  async function browseLocalVideo() {
    try {
      const ok = await pickAndOpenVideo();
      if (!ok && vidIn) {
        // pickAndOpenVideo already prompts fallback if cancelled/not available
      }
    } catch (e) {
      studio.toast(String(e));
    }
  }

  async function downloadUrl() {
    if (!dlUrl.trim()) return;
    dlBusy = true;
    dlStatus = 'Fetching direct media URL in browser…';
    try {
      await importVideoFromUrl(dlUrl.trim());
      studio.meta = { ...studio.meta, link: dlUrl.trim() };
      dlStatus = 'Loaded ✔';
    } catch (e) {
      dlStatus = 'Error (CORS or unsupported URL): ' + (e?.message || e);
    } finally {
      dlBusy = false;
    }
  }

  async function findViralClips() {
    if (!studio.subs.length) return studio.toast('Generate subtitles first (Captions tab).');
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

<input
  bind:this={vidIn}
  type="file"
  accept="video/*"
  hidden
  onchange={(e) => {
    const f = e.currentTarget.files?.[0];
    if (f) openVideoFile(f);
    e.currentTarget.value = '';
  }}
/>

<div class="seg-pills" style="grid-template-columns:repeat(3,minmax(0,1fr))">
  <button type="button" class:on={subTab === 'import'} onclick={() => (subTab = 'import')}>Import</button>
  <button type="button" class:on={subTab === 'dl'} onclick={() => (subTab = 'dl')}>Link</button>
  <button type="button" class:on={subTab === 'assets'} onclick={() => (subTab = 'assets')}>Assets</button>
</div>

{#if subTab === 'import'}
  <div class="drop-card" role="button" tabindex="0" onclick={browseLocalVideo} onkeydown={(e) => e.key === 'Enter' && browseLocalVideo()}>
    <div class="drop-ic"><Icon name="upload" size={22} /></div>
    <b style="font-size:13px">Import Video or Drop File</b>
    <div class="hint" style="margin:2px 0 8px">MP4, MOV, MKV, WebM or M4V</div>
    <span class="badge pri">{studio.file ? studio.file.name : 'Choose from PC…'}</span>
  </div>

  {#if studio.file}
    <CategoryBlock title="Loaded Media" icon="film" open={true}>
      <div class="rt" style="justify-content:space-between">
        <span class="hint" style="margin:0;color:var(--text-primary)">{studio.file.name}</span>
        <span class="badge mono">{fmt(studio.dur)}</span>
      </div>
      <div class="hint" style="margin:4px 0 0">Trim: {fmt(studio.trimS)} → {fmt(studio.trimE)}</div>
    </CategoryBlock>
  {/if}
{:else if subTab === 'dl'}
  <CategoryBlock title="Direct Video URL (Browser Import)" icon="download" open={true}>
    <input bind:value={dlUrl} placeholder="https://example.com/clip.mp4 (CORS-enabled)" style="width:100%;margin-bottom:8px" />
    <div class="bar">
      <button type="button" class="pri sm" style="flex:1" disabled={dlBusy} onclick={downloadUrl}>
        {dlBusy ? 'Fetching…' : 'Load Direct MP4/WebM URL'}
      </button>
    </div>
    {#if dlStatus}
      <div class="hint" style="margin:6px 0 0">{dlStatus}</div>
    {/if}
    <div class="sub-card" style="margin-top:10px">
      <div class="rt" style="justify-content:space-between">
        <b style="font-size:11.5px">YouTube / Social Extraction (yt-dlp)</b>
        <span class="badge">Desktop Only</span>
      </div>
      <div class="hint" style="margin:4px 0 0">
        Browsers &amp; Vercel serverless functions cannot execute <code>yt-dlp</code> directly. Download on the desktop app or import local MP4/WebM files directly in the Import tab.
      </div>
    </div>
  </CategoryBlock>
{:else}
  <AssetsPanel />
{/if}

<style>
  .drop-card {
    border: 1.5px dashed var(--border-strong);
    border-radius: 14px;
    padding: 22px 16px;
    text-align: center;
    background: rgba(255, 255, 255, 0.02);
    cursor: pointer;
    margin-bottom: 10px;
    transition: border-color 160ms ease, background 160ms ease;
  }
  .drop-card:hover {
    border-color: var(--accent-primary);
    background: var(--accent-primary-soft);
  }
  .drop-ic {
    width: 42px;
    height: 42px;
    border-radius: 12px;
    background: var(--accent-primary-soft);
    color: var(--accent-primary);
    display: inline-grid;
    place-items: center;
    margin-bottom: 8px;
  }
</style>
