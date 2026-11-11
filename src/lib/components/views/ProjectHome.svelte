<script>
  import { activateAudioAsset, assetImage, ensureMediaNode, loadVideoPath } from '../../mediaHelpers.js';
  import { cl, studio } from '../../state.svelte.js';
  import { getTauri } from '../../tauriBridge.js';

  let homeMessage = $state('');

  const shortcutLabels = {
    play: 'Play / pause',
    split: 'Split subtitle',
    undo: 'Undo',
    redo: 'Redo',
    previous: 'Seek backward',
    next: 'Seek forward',
    setStart: 'Set range start',
    setEnd: 'Set range end',
    save: 'Save project',
  };

  async function createNewProject() {
    homeMessage = '';
    if (studio.exporting) return (homeMessage = 'Wait for export to finish first.');
    if ((studio.subs.length || studio.file || studio.texts.length || studio.assetLibrary.length) && !confirm('Start a new project? Unsaved edits will be cleared.')) {
      return;
    }
    studio.resetProject();
    studio.projectName = 'Untitled project';
    await studio.saveProjectStore({ quiet: true, bundle: false });
    studio.homeOpen = false;
    studio.toast('New project created.');
  }

  async function saveCurrentProject() {
    homeMessage = '';
    try {
      await studio.saveProjectStore();
    } catch (e) {
      homeMessage = 'Save failed: ' + (e?.message || e);
    }
  }

  async function openSavedProject(p) {
    if (studio.exporting) return studio.toast('Wait for export to finish.');
    try {
      studio.resetProject();
      studio.assetLibrary = Array.isArray(p.assets) ? p.assets.map((a) => ({ ...a, file: null, img: null, url: null })) : [];
      studio.saveAssets();
      studio.activeProjectId = p.id;
      studio.projectName = p.name || '';
      const T = getTauri();
      if (p.sourcePath && T?.core) {
        try {
          await loadVideoPath(p.sourcePath);
        } catch {}
      }
      studio.projLoad(p.state || {});
      if (studio.dur > 0) {
        studio.trimS = cl(Number(studio.trimS) || 0, 0, Math.max(0, studio.dur - 0.1));
        studio.trimE = cl(Number(studio.trimE) || studio.dur, studio.trimS + 0.1, studio.dur);
      }
      if (studio.fg.mode === 'image' && studio.fg.assetPath) {
        const bg = studio.assetLibrary.find((a) => a.path === studio.fg.assetPath);
        if (bg) try { studio.fgImg = await assetImage(bg); } catch {}
      }
      if (studio.aud.track && T?.core) {
        const aa = studio.assetLibrary.find((a) => a.path === studio.aud.track);
        if (aa) await activateAudioAsset(aa);
      }
      for (const o of studio.mediaOverlays || []) {
        await ensureMediaNode(o).catch(() => {});
      }
      studio.homeOpen = false;
      studio.toast('Opened project: ' + p.name);
    } catch (e) {
      homeMessage = 'Could not restore project: ' + (e?.message || e);
    }
  }

  function deleteSavedProject(p) {
    if (!confirm(`Delete saved project “${p.name}”?`)) return;
    const next = studio.projects.filter((x) => x.id !== p.id);
    localStorage.setItem('icsProjectLibraryV1', JSON.stringify(next));
    studio.projects = next;
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

{#if studio.homeOpen}
  <div class="home-overlay">
    <div class="home-inner">
      <div class="rt" style="justify-content:space-between;margin-bottom:16px">
        <div>
          <h1 style="margin:0;font-size:24px;letter-spacing:-0.02em">
            Insta Clip Studio <span class="badge pri">v1.5.0 · SVELTE STUDIO</span>
          </h1>
          <div class="hint" style="margin:4px 0 0">
            Modern Svelte 5 studio workspace inspired by Minbar Caption · Whisper, ElevenLabs Scribe 2, Independent Dual Subtitles & AI Translation
          </div>
        </div>
        <button type="button" class="pri" onclick={createNewProject}>＋ New project</button>
      </div>

      <div class="style-category-block" style="padding:12px">
        <div class="rt">
          <input bind:value={studio.projectName} placeholder="Project name (e.g. Qasida — Burdah)" style="flex:1" />
          <button type="button" class="pri" onclick={saveCurrentProject}>Save current project</button>
          <button type="button" onclick={() => (studio.homeOpen = false)}>Enter Editor →</button>
        </div>
      </div>

      {#if homeMessage}
        <div class="sub-card" style="border-color:var(--danger-color)">{homeMessage}</div>
      {/if}

      <div class="proj-grid">
        {#each studio.projects as p (p.id)}
          <div class="style-category-block" style="display:flex;flex-direction:column;justify-content:space-between;min-height:132px;margin:0">
            <div>
              <b>{p.name || 'Untitled project'}</b>
              <div class="hint" style="margin:4px 0">
                {p.state?.subs?.length || 0} subtitles · {new Date(p.updated || Date.now()).toLocaleString()}
                {#if p.sourceName} · {p.sourceName}{/if}
              </div>
            </div>
            <div class="bar" style="margin:8px 0 0">
              <button type="button" class="sm pri" onclick={() => openSavedProject(p)}>Open</button>
              <button
                type="button"
                class="sm"
                onclick={() => {
                  studio.activeProjectId = p.id;
                  studio.projectName = p.name;
                  saveCurrentProject();
                }}
              >
                Update
              </button>
              <button type="button" class="sm" onclick={() => deleteSavedProject(p)}>Delete</button>
            </div>
          </div>
        {:else}
          <div class="hint">No saved projects yet — click <b>Enter Editor →</b> or start a <b>＋ New project</b>.</div>
        {/each}
      </div>

      <div class="style-category-block" style="margin-top:14px;padding:12px">
        <div class="rt" style="justify-content:space-between;margin-bottom:8px">
          <b>Keyboard shortcuts</b>
          <button
            type="button"
            class="xs"
            onclick={() => {
              studio.shortcuts = { play: 'Space', split: 's', undo: 'Ctrl+z', redo: 'Ctrl+Shift+z', previous: 'ArrowLeft', next: 'ArrowRight', setStart: 'i', setEnd: 'o', save: 'Ctrl+s' };
              studio.saveShortcuts();
              studio.toast('Shortcuts reset');
            }}
          >
            Reset shortcuts
          </button>
        </div>
        <div class="sg" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
          {#each Object.entries(shortcutLabels) as [k, lbl]}
            <label>
              {lbl}
              <input readonly value={studio.shortcuts[k] || ''} onclick={(e) => captureShortcut(k, e.currentTarget)} />
            </label>
          {/each}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .home-overlay {
    position: fixed;
    inset: 0;
    z-index: 45;
    background: radial-gradient(ellipse at top, #141a2b 0%, var(--bg-primary) 62%);
    overflow: auto;
    padding: 28px;
  }
  .home-inner {
    max-width: 1080px;
    margin: 0 auto;
  }
  .proj-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
    margin-top: 12px;
  }
</style>
