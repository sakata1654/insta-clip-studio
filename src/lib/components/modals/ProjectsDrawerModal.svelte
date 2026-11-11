<script>
  import { activateAudioAsset, assetImage, ensureMediaNode, loadVideoPath } from '../../mediaHelpers.js';
  import { saveBlob } from '../../renderer.js';
  import { cl, studio } from '../../state.svelte.js';
  import { PROJECTS_KEY } from '../../state.svelte.js';
  import { getTauri } from '../../tauriBridge.js';

  let { open = $bindable(false) } = $props();
  let query = $state('');
  let importIn = $state(null);

  const filteredProjects = $derived(
    query.trim()
      ? studio.projects.filter((p) => (p.name || '').toLowerCase().includes(query.trim().toLowerCase()))
      : studio.projects
  );

  async function openProj(p) {
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
      for (const o of studio.mediaOverlays || []) await ensureMediaNode(o).catch(() => {});
      studio.unsaved = false;
      open = false;
      studio.toast('Opened: ' + p.name);
    } catch (e) {
      studio.toast('Load failed: ' + (e?.message || e));
    }
  }

  function exportOne(p) {
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
    studio.toast('Exported project JSON: ' + p.name);
  }

  function duplicateProj(p) {
    const copy = {
      ...JSON.parse(JSON.stringify(p)),
      id: 'p_' + Date.now(),
      name: (p.name || 'Project') + ' (Copy)',
      updated: Date.now(),
    };
    const next = [copy, ...studio.projects];
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
    studio.projects = next;
    studio.toast('Duplicated: ' + copy.name);
  }

  async function onImportFile(e) {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const stateObj = data.state && typeof data.state === 'object' ? data.state : data;
      if (!stateObj || typeof stateObj !== 'object') return studio.toast('Invalid project JSON');
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
      await openProj(rec);
    } catch (err) {
      studio.toast('Import failed: ' + (err?.message || err));
    }
  }
</script>

<input bind:this={importIn} type="file" accept=".json,application/json" hidden onchange={onImportFile} />

{#if open}
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onkeydown={(e) => e.key === 'Escape' && (open = false)}
    onclick={(e) => e.target === e.currentTarget && (open = false)}
  >
    <div class="modal-card">
      <div class="rt" style="justify-content:space-between;margin-bottom:12px">
        <div>
          <h3 style="margin:0;font-size:15.5px;letter-spacing:-0.02em">Projects &amp; Workspace</h3>
          <div class="hint" style="margin:2px 0 0;font-size:11.5px">
            Save, duplicate, or transfer full projects via portable <code>.icproj.json</code> files.
          </div>
        </div>
        <button type="button" class="xs ghost" onclick={() => (open = false)}>✕</button>
      </div>

      <div class="bar" style="margin-bottom:12px">
        <input bind:value={query} placeholder="Search projects…" style="flex:1;min-width:140px" />
        <button type="button" class="sm" onclick={() => studio.saveProjectStore()}>Save Current</button>
        <button type="button" class="sm" onclick={() => importIn?.click()}>Import .JSON</button>
        <button
          type="button"
          class="pri sm"
          onclick={async () => {
            studio.resetProject();
            studio.projectName = 'New Clip ' + new Date().toLocaleDateString();
            await studio.saveProjectStore({ quiet: true, bundle: false });
            open = false;
          }}
        >
          ＋ New
        </button>
      </div>

      <div class="proj-list">
        {#each filteredProjects as p (p.id)}
          <div class="proj-row" class:active={studio.activeProjectId === p.id}>
            <div style="min-width:0;flex:1">
              <div class="rt" style="gap:6px">
                <b class="proj-name">{p.name || 'Untitled'}</b>
                <span class="badge pri">{p.state?.aspect || '9:16'}</span>
                {#if studio.activeProjectId === p.id}
                  <span class="badge ok">Active</span>
                {/if}
              </div>
              <div class="hint" style="margin:3px 0 0;font-size:11px">
                {p.state?.subs?.length || 0} cues
                {#if p.sourceName} · {p.sourceName}{/if}
                · Updated {new Date(p.updated || Date.now()).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <div class="rt" style="gap:4px">
              <button type="button" class="xs pri" onclick={() => openProj(p)}>Open</button>
              <button type="button" class="xs" onclick={() => duplicateProj(p)} title="Duplicate project">Copy</button>
              <button type="button" class="xs" onclick={() => exportOne(p)} title="Export portable .icproj.json">.JSON</button>
              <button
                type="button"
                class="xs danger"
                onclick={() => {
                  const next = studio.projects.filter((x) => x.id !== p.id);
                  localStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
                  studio.projects = next;
                }}
                title="Delete project"
              >
                ✕
              </button>
            </div>
          </div>
        {:else}
          <div class="sub-card" style="text-align:center;padding:24px 16px">
            <div class="hint" style="margin:0">
              {query.trim() ? 'No matching projects found.' : 'No saved projects yet. Click "Save Current" or Import a .icproj.json file.'}
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(5, 7, 12, 0.78);
    backdrop-filter: blur(10px);
    display: grid;
    place-items: center;
    z-index: 80;
  }
  .modal-card {
    width: 640px;
    max-width: 94vw;
    max-height: 82vh;
    overflow: auto;
    background: var(--bg-secondary);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-xl);
    padding: 20px;
    box-shadow: var(--shadow-lg);
  }
  .proj-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .proj-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
  }
  .proj-row:hover {
    border-color: var(--border-mid);
  }
  .proj-row.active {
    border-color: color-mix(in srgb, var(--accent-primary) 50%, transparent);
  }
  .proj-name {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
