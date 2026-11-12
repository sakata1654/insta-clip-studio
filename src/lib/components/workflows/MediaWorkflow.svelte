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
  import { loadVideoPath, openVideoFile } from '../../mediaHelpers.js';
  import { fmt, studio } from '../../state.svelte.js';
  import { getTauri } from '../../tauriBridge.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import Icon from '../Icon.svelte';
  import AssetsPanel from '../panels/AssetsPanel.svelte';

  let subTab = $state('import'); // 'import' | 'dl' | 'assets' | 'ai'
  let vidIn = $state(null);

  // Download state
  let dlUrl = $state('');
  let dlFmt = $state('best');
  let dlBusy = $state(false);
  let dlPct = $state(0);
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
    const T = getTauri();
    if (T?.dialog) {
      try {
        const p = await T.dialog.open({ filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }] });
        if (p) await loadVideoPath(p);
      } catch (e) {
        studio.toast(String(e));
      }
    } else {
      vidIn?.click();
    }
  }

  async function downloadUrl() {
    if (!dlUrl.trim()) return;
    const T = getTauri();
    dlBusy = true;
    dlPct = 0;
    dlStatus = 'Downloading…';
    const unlisten = await T.event?.listen('ytdlp-log', (e) => {
      const m = /\[download\]\s+(\d+(?:\.\d+)?)%/.exec(String(e.payload || ''));
      if (m) dlPct = +m[1];
    });
    try {
      const dir = await T.path.downloadDir();
      const outPath = await T.core.invoke('ytdlp_download', { url: dlUrl.trim(), fmt: dlFmt, dir, start: '', end: '' });
      dlStatus = 'Downloaded ✔ Opening…';
      dlPct = 100;
      studio.meta = { link: dlUrl.trim(), title: outPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') };
      await loadVideoPath(outPath);
    } catch (e) {
      dlStatus = 'Error: ' + (e?.message || e);
    } finally {
      unlisten?.();
      dlBusy = false;
    }
  }

  async function findViralClips() {
    if (!studio.subs.length) return studio.toast('Generate subtitles first (Captions tab).');
    if (!studio.API.key && studio.API.prov !== 'ollama') {
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
    if (!studio.API.key && studio.API.prov !== 'ollama') {
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
  <CategoryBlock title="Download from URL (yt-dlp)" icon="download" open={true}>
    <input bind:value={dlUrl} placeholder="Paste YouTube / Instagram / X link…" style="width:100%;margin-bottom:8px" />
    <div class="rt">
      <select bind:value={dlFmt} style="flex:1">
        <option value="best">Best MP4</option>
        <option value="1080">1080p MP4</option>
        <option value="720">720p MP4</option>
        <option value="audio">Audio MP3 only</option>
      </select>
      <button type="button" class="pri sm" disabled={dlBusy} onclick={downloadUrl}>
        {dlBusy ? 'Downloading…' : 'Fetch Video'}
      </button>
    </div>
    <div class="pbar"><i style="width:{dlPct}%"></i></div>
    {#if dlStatus}
      <div class="hint" style="margin:2px 0 0">{dlStatus}</div>
    {/if}
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
