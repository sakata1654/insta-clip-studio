<script>
  import { activateAudioAsset, assetImage, ensureMediaNode, openVideoFile, pickAndOpenVideo } from '../../mediaHelpers.js';
  import { saveBlob } from '../../renderer.js';
  import { cl, PROJECTS_KEY, studio } from '../../state.svelte.js';
  import { applyStudioPreset, BUILT_IN_STUDIO_PRESETS } from '../../studioPresets.js';
  import { loadMediaFromIdb } from '../../webPlatform/webStorage.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import Icon from '../Icon.svelte';

  let { onOpenSettings = () => {} } = $props();

  let searchQuery = $state('');
  let sortBy = $state('updated'); // 'updated' | 'name' | 'cues'
  let homeMessage = $state('');
  let vidIn = $state(null);
  let importIn = $state(null);

  const shortcutLabels = {
    play: 'Play / Pause',
    split: 'Split Subtitle at Playhead',
    undo: 'Undo',
    redo: 'Redo',
    delete: 'Delete Selected Subtitle',
    save: 'Save Project',
    previous: 'Previous Frame',
    next: 'Next Frame',
  };

  const visibleProjects = $derived.by(() => {
    const q = searchQuery.trim().toLowerCase();
    let list = q
      ? studio.projects.filter(
          (p) =>
            (p.name || '').toLowerCase().includes(q) ||
            (p.sourceName || '').toLowerCase().includes(q)
        )
      : [...studio.projects];

    if (sortBy === 'name') {
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else if (sortBy === 'cues') {
      list.sort((a, b) => (b.state?.subs?.length || 0) - (a.state?.subs?.length || 0));
    } else {
      list.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    }
    return list;
  });

  async function createNewProject(preset = null) {
    homeMessage = '';
    if (studio.unsaved && (studio.subs.length || studio.file || studio.texts.length)) {
      const ok = await studio.confirm({
        title: 'Create New Project?',
        message: 'You have unsaved edits in the current project. Save changes first or discard them to start fresh.',
        confirmText: 'Start New Project',
        danger: true,
      });
      if (!ok) return;
    }
    studio.resetProject();
    studio.projectName = preset ? preset.name : 'Untitled Project';
    if (preset) {
      applyStudioPreset(studio, preset);
      studio.sampleSub = 1;
    }
    studio.leftTab = preset?.bn?.on ? 'banners' : 'media';
    await studio.saveProjectStore({ quiet: true, bundle: false });
    studio.homeOpen = false;
    studio.toast(preset ? `Created from template: ${preset.name}` : 'New project created');
  }

  async function pickVideoAndEdit() {
    try {
      const ok = await pickAndOpenVideo();
      if (ok) studio.homeOpen = false;
    } catch (e) {
      homeMessage = String(e);
    }
  }

  async function openSavedProject(p) {
    try {
      studio.resetProject();
      studio.assetLibrary = Array.isArray(p.assets) ? p.assets.map((a) => ({ ...a, file: null, img: null, url: null, status: 'pending' })) : [];
      studio.saveAssets();
      studio.activeProjectId = p.id;
      studio.projectName = p.name || '';
      studio.projLoad(p.state || {});

      // Hydrate source video from IndexedDB or FileSystemFileHandle
      const vidRec = await loadMediaFromIdb(p.id, '__source__');
      if (vidRec?.file) {
        await openVideoFile(vidRec.file, { handle: vidRec.handle, skipIdbSave: true, preserveTrim: true, quiet: true });
      } else if (p.sourceName || p.sourcePath) {
        studio.mediaStatus = vidRec?.status === 'permission-needed' ? 'permission-needed' : 'missing';
      }

      if (studio.dur > 0) {
        studio.trimS = cl(Number(studio.trimS) || 0, 0, Math.max(0, studio.dur - 0.1));
        studio.trimE = cl(Number(studio.trimE) || studio.dur, studio.trimS + 0.1, studio.dur);
      }

      if (studio.fg.mode === 'image' && studio.fg.assetPath) {
        const bg = studio.assetLibrary.find((a) => a.path === studio.fg.assetPath || a.name === studio.fg.assetPath);
        if (bg) try { studio.fgImg = await assetImage(bg); } catch {}
      }
      if (studio.aud.track) {
        const aa = studio.assetLibrary.find((a) => a.path === studio.aud.track || a.name === studio.aud.trackName);
        if (aa) await activateAudioAsset(aa).catch(() => {});
      }

      const missing = [];
      for (const o of studio.mediaOverlays || []) {
        await ensureMediaNode(o).catch(() => missing.push(o.assetId || o.id));
      }
      studio.missingAssets = missing;
      studio.unsaved = false;
      studio.homeOpen = false;
      if (studio.mediaStatus === 'missing' || missing.length) {
        studio.toast(`Opened "${p.name}" — relink missing local media to render video.`);
      } else {
        studio.toast('Opened project: ' + p.name);
      }
    } catch (e) {
      homeMessage = 'Could not restore project: ' + (e?.message || e);
    }
  }

  function duplicateSavedProject(p) {
    const copy = {
      ...JSON.parse(JSON.stringify(p)),
      id: 'p_' + Date.now(),
      name: (p.name || 'Project') + ' (Copy)',
      updated: Date.now(),
    };
    const next = [copy, ...studio.projects];
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
    studio.projects = next;
    studio.toast('Duplicated project');
  }

  function exportProjectJson(p) {
    saveBlob(
      new Blob(
        [
          JSON.stringify(
            {
              schema: 'insta-clip-studio-project',
              version: 2,
              projectName: p.name || 'Untitled Project',
              savedAt: new Date(p.updated || Date.now()).toISOString(),
              assets: p.assets || [],
              state: p.state || {},
            },
            null,
            2
          ),
        ],
        { type: 'application/json' }
      ),
      ((p.name || 'project').replace(/[^a-z0-9-_]+/gi, '_')) + '.icproj.json'
    );
    studio.toast('Exported project JSON');
  }

  async function deleteSavedProject(p) {
    const ok = await studio.confirm({
      title: `Delete "${p.name || 'Untitled'}"?`,
      message: 'This removes the saved project and its cached browser media blobs from IndexedDB.',
      confirmText: 'Delete Project',
      danger: true,
    });
    if (!ok) return;
    await studio.deleteProject(p.id);
    studio.toast('Project deleted from browser library');
  }

  async function onImportProjectFile(e) {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const stateObj = data.state && typeof data.state === 'object' ? data.state : data;
      const rec = {
        id: 'p_' + Date.now(),
        name: data.projectName || data.name || f.name.replace(/\.(icproj\.)?json$/i, ''),
        updated: Date.now(),
        sourcePath: data.sourcePath || null,
        sourceName: data.sourceName || '',
        assets: Array.isArray(data.assets) ? data.assets : [],
        state: stateObj,
      };
      const next = [rec, ...studio.projects];
      localStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
      studio.projects = next;
      await openSavedProject(rec);
    } catch (err) {
      homeMessage = 'Invalid project JSON file: ' + (err?.message || err);
    }
  }

  function captureShortcut(k, inputEl) {
    inputEl.value = 'Press keys…';
    const handler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const a = [];
      if (e.ctrlKey || e.metaKey) a.push('Ctrl');
      if (e.altKey) a.push('Alt');
      if (e.shiftKey) a.push('Shift');
      let key = e.key;
      if (key === ' ') key = 'Space';
      else if (key.length === 1) key = key.toLowerCase();
      if (!['Control', 'Meta', 'Alt', 'Shift'].includes(key)) a.push(key);
      const val = a.join('+');
      if (val) {
        studio.shortcuts[k] = val;
        studio.saveShortcuts();
        inputEl.value = val;
      }
      window.removeEventListener('keydown', handler, true);
    };
    window.addEventListener('keydown', handler, true);
  }
</script>

<input
  bind:this={vidIn}
  type="file"
  accept="video/*"
  hidden
  onchange={async (e) => {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (f) {
      await openVideoFile(f);
      studio.homeOpen = false;
    }
  }}
/>
<input bind:this={importIn} type="file" accept=".json,application/json" hidden onchange={onImportProjectFile} />

{#if studio.homeOpen}
  <div class="home-shell">
    <!-- Homepage Header -->
    <header class="home-topbar">
      <div class="rt" style="gap:10px">
        <div class="home-logo"><img src="/tibyan-logo.jpg" alt="Tibyan Studio" class="home-pfp" /></div>
        <div>
          <div class="rt" style="gap:8px">
            <span class="home-brand sr-only-brand">Tibyan Studio</span>
            <span class="badge pri">Web</span>
          </div>
          <span class="home-sub">Browser-Native Video &amp; Caption Workspace</span>
        </div>
      </div>

      <div class="rt" style="gap:8px;flex-wrap:wrap">
        {#if studio.exportJobs.some((j) => !j.done)}
          {@const activeJob = studio.exportJobs.find((j) => !j.done)}
          <span class="badge pri" title={activeJob?.label}>
            Exporting {activeJob?.name}: {activeJob?.pct ?? 0}%
          </span>
        {/if}
        {#if studio.storageStats?.usedMb !== null && studio.storageStats?.usedMb !== undefined}
          <span class="badge" title="Local IndexedDB browser cache usage">
            Storage: {studio.storageStats.usedMb} MB
          </span>
        {/if}
        {#if studio.caps}
          <span class="badge" class:ok={studio.caps.webcodecsH264} title={studio.caps.webcodecsH264 ? 'Hardware-accelerated WebCodecs MP4 export supported' : 'Using MediaRecorder fallback'}>
            {studio.caps.webcodecsH264 ? 'WebCodecs MP4' : 'MediaRecorder'}
          </span>
        {/if}
        <button
          type="button"
          class="sm ghost"
          onclick={() => studio.applyUiTheme(studio.uiTheme === 'light' ? 'dark' : 'light')}
          title="Toggle Dark / Light Theme"
        >
          <Icon name={studio.uiTheme === 'light' ? 'moon' : 'sun'} size={14} />
          <span>{studio.uiTheme === 'light' ? 'Dark' : 'Light'}</span>
        </button>
        <button type="button" class="sm ghost" onclick={onOpenSettings}>
          <Icon name="settings" size={14} />
          <span>Settings</span>
        </button>
        <button type="button" class="sm" onclick={() => importIn?.click()}>
          <Icon name="upload" size={14} />
          <span>Import .JSON</span>
        </button>
        <button type="button" class="sm" onclick={() => (studio.homeOpen = false)}>
          <span>Resume Editor</span>
        </button>
        <button type="button" class="sm pri" onclick={() => createNewProject(null)}>
          <Icon name="plus" size={14} />
          <span>New Project</span>
        </button>
      </div>
    </header>

    <main class="home-main">
      {#if homeMessage}
        <div class="sub-card" style="border-color:var(--danger-color);margin-bottom:16px">{homeMessage}</div>
      {/if}

      <!-- Quick Start Cards -->
      <section class="home-section">
        <h2 class="sec-title">Start Editing</h2>
        <div class="start-grid">
          <button type="button" class="start-card primary" onclick={pickVideoAndEdit}>
            <div class="sc-icon"><Icon name="upload" size={18} /></div>
            <div class="sc-body">
              <b>Open Video File</b>
              <span>Import MP4, MOV, MKV, or WebM into timeline</span>
            </div>
          </button>

          <button
            type="button"
            class="start-card"
            onclick={() => {
              studio.homeOpen = false;
              studio.leftTab = 'media';
            }}
          >
            <div class="sc-icon"><Icon name="music" size={18} /></div>
            <div class="sc-body">
              <b>Audio + Image Mode</b>
              <span>Pair MP3/WAV audio with a background image or loop</span>
            </div>
          </button>

          {#each BUILT_IN_STUDIO_PRESETS.slice(0, 2) as bp (bp.id)}
            <button type="button" class="start-card" onclick={() => createNewProject(bp)}>
              <div class="sc-icon"><Icon name={bp.bn?.on ? 'tv' : 'subtitles'} size={18} /></div>
              <div class="sc-body">
                <div class="rt" style="justify-content:space-between;width:100%">
                  <b>{bp.name}</b>
                  <span class="badge">{bp.format}</span>
                </div>
                <span>{bp.description}</span>
              </div>
            </button>
          {/each}
        </div>
      </section>

      <!-- Recent Projects Browser -->
      <section class="home-section">
        <div class="sec-header">
          <div class="rt" style="gap:8px">
            <h2 class="sec-title" style="margin:0">Recent Projects</h2>
            <span class="badge">{visibleProjects.length}</span>
          </div>
          <div class="rt" style="gap:8px">
            <div class="search-wrap">
              <Icon name="search" size={13} />
              <input bind:value={searchQuery} placeholder="Search projects…" class="search-inp" />
            </div>
            <select bind:value={sortBy} style="font-size:12px;padding:5px 24px 5px 9px">
              <option value="updated">Sort: Last Modified</option>
              <option value="name">Sort: Name (A–Z)</option>
              <option value="cues">Sort: Subtitle Count</option>
            </select>
          </div>
        </div>

        {#if visibleProjects.length}
          <div class="proj-grid">
            {#each visibleProjects as p (p.id)}
              {@const aspect = p.state?.aspect || '9:16'}
              <article class="proj-card" class:active={studio.activeProjectId === p.id}>
                <!-- Clean Wireframe Thumbnail representing saved Aspect Ratio & Layers -->
                <button type="button" class="proj-thumb" onclick={() => openSavedProject(p)} title="Open project">
                  <div
                    class="thumb-frame"
                    class:ar-16-9={aspect === '16:9'}
                    class:ar-1-1={aspect === '1:1'}
                    class:ar-4-5={aspect === '4:5'}
                  >
                    {#if p.state?.fr?.on}
                      <div class="tf-card"></div>
                    {/if}
                    {#if p.state?.bn?.on}
                      <div class="tf-banner"></div>
                    {/if}
                    {#if p.state?.du?.on || (p.state?.subs?.length || 0) > 0}
                      <div class="tf-subs"></div>
                    {/if}
                  </div>
                  <span class="badge thumb-badge">{aspect}</span>
                </button>

                <div class="proj-info">
                  <div class="rt" style="justify-content:space-between;gap:6px">
                    <b class="proj-title" title={p.name}>{p.name || 'Untitled Project'}</b>
                    {#if studio.activeProjectId === p.id}
                      <span class="badge ok">Active</span>
                    {/if}
                  </div>
                  <div class="proj-meta">
                    <span>{p.state?.subs?.length || 0} subtitles</span>
                    <span>·</span>
                    <span>{new Date(p.updated || Date.now()).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  {#if p.sourceName}
                    <div class="proj-src" title={p.sourceName}>{p.sourceName}</div>
                  {/if}
                </div>

                <div class="proj-actions">
                  <button type="button" class="xs pri" onclick={() => openSavedProject(p)}>Open</button>
                  <button type="button" class="xs ghost" onclick={() => duplicateSavedProject(p)} title="Duplicate">
                    <Icon name="copy" size={12} />
                  </button>
                  <button type="button" class="xs ghost" onclick={() => exportProjectJson(p)} title="Export .icproj.json">
                    <Icon name="download" size={12} />
                  </button>
                  <button type="button" class="xs ghost" style="margin-left:auto" onclick={() => deleteSavedProject(p)} title="Delete">
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              </article>
            {/each}
          </div>
        {:else}
          <div class="empty-state">
            <Icon name="folder" size={28} />
            <b>{searchQuery.trim() ? 'No matching projects' : 'No saved projects yet'}</b>
            <p class="hint" style="margin:2px 0 12px">
              {searchQuery.trim()
                ? 'Try a different search term or clear the filter.'
                : 'Click New Project, Open Video File, or Import a .icproj.json file to get started.'}
            </p>
            <button type="button" class="sm pri" onclick={() => createNewProject(null)}>
              <Icon name="plus" size={13} /> Create First Project
            </button>
          </div>
        {/if}
      </section>

      <!-- Keyboard Shortcuts (Progressive Disclosure) -->
      <section class="home-section" style="margin-top:24px">
        <CategoryBlock title="Keyboard Shortcuts & Controls" icon="sliders" open={false}>
          <div class="bar" style="justify-content:flex-end;margin-bottom:6px">
            <button
              type="button"
              class="xs"
              onclick={() => {
                studio.shortcuts = { play: 'Space', split: 's', undo: 'Ctrl+z', redo: 'Ctrl+Shift+z', previous: 'ArrowLeft', next: 'ArrowRight', setStart: 'i', setEnd: 'o', save: 'Ctrl+s' };
                studio.saveShortcuts();
                studio.toast('Shortcuts reset to defaults');
              }}
            >
              Reset Defaults
            </button>
          </div>
          <div class="sg" style="grid-template-columns:repeat(auto-fit,minmax(210px,1fr))">
            {#each Object.entries(shortcutLabels) as [k, lbl]}
              <label>
                {lbl}
                <input readonly value={studio.shortcuts[k] || ''} onclick={(e) => captureShortcut(k, e.currentTarget)} title="Click then press new key combo" />
              </label>
            {/each}
          </div>
        </CategoryBlock>
      </section>
    </main>
  </div>
{/if}

<style>
  .home-shell {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: var(--bg-canvas);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .home-topbar {
    height: 56px;
    padding: 0 24px;
    background: var(--bg-titlebar);
    border-bottom: 1px solid var(--border-color);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-shrink: 0;
  }

  .home-logo {
    height: 40px;
    width: auto;
    border-radius: var(--radius-md);
    background: #414127;
    border: 1px solid rgba(223, 198, 122, 0.35);
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
  }
  .home-pfp {
    height: 100%;
    width: auto;
    object-fit: cover;
    display: block;
  }
  .sr-only-brand {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
  }

  .home-brand {
    font-weight: 700;
    font-size: 14.5px;
    letter-spacing: -0.02em;
  }

  .home-sub {
    display: block;
    font-size: 11px;
    color: var(--text-thirdly);
  }

  .home-main {
    flex: 1;
    overflow-y: auto;
    padding: 28px 32px 48px;
    max-width: 1180px;
    width: 100%;
    margin: 0 auto;
  }

  .home-section {
    margin-bottom: 28px;
  }

  .sec-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 12px;
  }

  .sec-title {
    margin: 0 0 12px;
    font-size: 13px;
    font-weight: 650;
    letter-spacing: 0.01em;
    color: var(--text-secondary);
  }

  .start-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
    gap: 10px;
  }

  .start-card {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 14px;
    border-radius: var(--radius-lg);
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    text-align: left;
    justify-content: flex-start;
    white-space: normal;
  }
  .start-card:hover {
    border-color: var(--accent);
    background: var(--bg-secondary);
  }
  .start-card.primary {
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    background: var(--accent-soft);
  }
  .start-card.primary .sc-icon {
    background: var(--accent);
    color: #ffffff;
  }

  .sc-icon {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    color: var(--text-primary);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }

  .sc-body {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
    min-width: 0;
  }
  .sc-body b {
    font-size: 12.8px;
    font-weight: 620;
  }
  .sc-body span {
    font-size: 11.2px;
    color: var(--text-thirdly);
    line-height: 1.38;
  }

  .search-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 9px;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    color: var(--text-thirdly);
  }
  .search-inp {
    border: 0;
    background: transparent;
    padding: 5px 0;
    width: 180px;
    font-size: 12px;
  }
  .search-inp:focus {
    box-shadow: none;
  }

  .proj-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(245px, 1fr));
    gap: 12px;
  }

  .proj-card {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    transition: border-color var(--dur-fast) ease, box-shadow var(--dur-fast) ease;
  }
  .proj-card:hover {
    border-color: var(--border-mid);
    box-shadow: var(--shadow-sm);
  }
  .proj-card.active {
    border-color: var(--accent);
  }

  .proj-thumb {
    position: relative;
    height: 118px;
    width: 100%;
    border: 0;
    border-bottom: 1px solid var(--border-color);
    border-radius: 0;
    background: var(--bg-canvas);
    display: grid;
    place-items: center;
    padding: 12px;
  }
  .proj-thumb:hover {
    background: var(--bg-secondary);
  }

  .thumb-frame {
    width: 48px;
    height: 84px;
    border-radius: 5px;
    border: 1.5px solid var(--border-strong);
    background: var(--bg-secondary);
    position: relative;
    overflow: hidden;
  }
  .thumb-frame.ar-16-9 {
    width: 112px;
    height: 63px;
  }
  .thumb-frame.ar-1-1 {
    width: 78px;
    height: 78px;
  }
  .thumb-frame.ar-4-5 {
    width: 66px;
    height: 82px;
  }
  .tf-card {
    position: absolute;
    left: 12%;
    right: 12%;
    top: 12%;
    height: 44%;
    border-radius: 4px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-mid);
  }
  .tf-banner {
    position: absolute;
    left: 6%;
    right: 6%;
    bottom: 10%;
    height: 14%;
    border-radius: 2px;
    background: var(--accent);
    opacity: 0.75;
  }
  .tf-subs {
    position: absolute;
    left: 18%;
    right: 18%;
    bottom: 24%;
    height: 8%;
    border-radius: 99px;
    background: var(--text-thirdly);
    opacity: 0.5;
  }
  .thumb-badge {
    position: absolute;
    top: 8px;
    right: 8px;
  }

  .proj-info {
    padding: 11px 12px 6px;
    min-width: 0;
  }
  .proj-title {
    font-size: 13px;
    font-weight: 620;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .proj-meta {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--text-thirdly);
    margin-top: 3px;
  }
  .proj-src {
    font-size: 10.5px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 2px;
  }

  .proj-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 12px 10px;
    margin-top: auto;
  }

  .empty-state {
    border: 1px dashed var(--border-mid);
    border-radius: var(--radius-lg);
    padding: 36px 20px;
    text-align: center;
    color: var(--text-thirdly);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .empty-state b {
    color: var(--text-primary);
    font-size: 13.5px;
    margin-top: 4px;
  }

  @media (max-width: 780px) {
    .home-shell {
      padding-bottom: var(--sab);
    }
    .home-topbar {
      height: auto;
      padding: calc(12px + var(--sat)) calc(14px + var(--sar)) 12px calc(14px + var(--sal));
      flex-wrap: wrap;
      gap: 10px;
    }
    .home-main {
      padding: 16px calc(14px + var(--sar)) calc(28px + var(--sab)) calc(14px + var(--sal));
    }
    .sec-header {
      flex-wrap: wrap;
      gap: 10px;
    }
    .search-inp {
      width: 140px;
    }
  }
  @media (max-width: 520px) {
    .proj-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
