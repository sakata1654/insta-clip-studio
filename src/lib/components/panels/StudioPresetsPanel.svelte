<script>
  import {
    applyStudioPreset,
    BUILT_IN_STUDIO_PRESETS,
    captureStudioPreset,
    exportPresetToJson,
    loadStudioPresets,
    pickAndReadJsonFile,
    saveStudioPresets,
  } from '../../studioPresets.js';
  import { studio } from '../../state.svelte.js';
  import CategoryBlock from '../CategoryBlock.svelte';

  let presets = $state(loadStudioPresets());
  let name = $state('');
  let desc = $state('');

  function saveCurrent() {
    const cleanName = name.trim();
    if (!cleanName) return studio.toast('Enter a preset name first');
    const p = captureStudioPreset(studio, cleanName, desc);
    presets = [p, ...presets];
    saveStudioPresets(presets);
    name = '';
    desc = '';
    studio.toast('Saved studio preset: ' + p.name);
  }

  async function saveAndExportCurrent() {
    const p = captureStudioPreset(studio, name.trim() || studio.projectName || 'Studio Preset', desc);
    const out = await exportPresetToJson(p);
    if (out) studio.toast('Exported preset file: ' + p.name);
  }

  function applyOne(p) {
    applyStudioPreset(studio, p);
    studio.toast('Applied studio style: ' + p.name);
  }

  function removeOne(id) {
    presets = presets.filter((x) => x.id !== id);
    saveStudioPresets(presets);
    studio.toast('Preset removed');
  }

  async function importJson() {
    const imported = await pickAndReadJsonFile();
    if (!imported) return studio.toast('Invalid or empty preset JSON file');
    presets = [imported, ...presets];
    saveStudioPresets(presets);
    applyStudioPreset(studio, imported);
    studio.toast('Imported & applied: ' + imported.name);
  }
</script>

<CategoryBlock title="Save Full Studio Preset (All Styles + Overlays)" icon="palette" open={true}>
  <p class="hint" style="margin-top:0">
    Captures Aspect Ratio, Card Frame, Subtitles, Dual Lines, Speaker &amp; News Banners, Bottom Fade/Glow, Watermark, and Overlay positions into one portable preset.
  </p>
  <div class="sg" style="grid-template-columns:1fr">
    <label>
      Preset Name
      <input bind:value={name} placeholder="e.g. Client Corporate Briefing 16:9" />
    </label>
    <label>
      Notes (optional)
      <input bind:value={desc} placeholder="Lower-third + blue ticker + 16:9" />
    </label>
  </div>
  <div class="bar" style="margin-top:9px;margin-bottom:0">
    <button type="button" class="pri sm" style="flex:1" onclick={saveCurrent}>Save Locally</button>
    <button type="button" class="sm" onclick={saveAndExportCurrent}>Export .JSON</button>
    <button type="button" class="sm" onclick={importJson}>Import .JSON</button>
  </div>
</CategoryBlock>

<CategoryBlock title="Your Saved Presets ({presets.length})" icon="folder" open={true}>
  {#if !presets.length}
    <div class="hint" style="margin:2px 0">
      No custom presets saved yet. Configure your look above or import a <code>.icpreset.json</code> file.
    </div>
  {:else}
    {#each presets as p (p.id)}
      <div class="sub-card">
        <div class="rt" style="justify-content:space-between;align-items:flex-start">
          <div style="min-width:0">
            <div class="rt" style="gap:6px">
              <b style="font-size:12.5px">{p.name}</b>
              <span class="badge pri">{p.format || p.aspect || '9:16'}</span>
            </div>
            {#if p.description}
              <div class="hint" style="margin:3px 0 0;font-size:11px">{p.description}</div>
            {/if}
            <div class="hint" style="margin:2px 0 0;font-size:10.5px">
              Saved {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : 'locally'}
              {#if p.bn?.on} · News Banner{/if}
              {#if p.spk?.on} · Speaker{/if}
              {#if p.du?.on} · Dual Subs{/if}
            </div>
          </div>
        </div>
        <div class="bar" style="margin-top:8px;margin-bottom:0">
          <button type="button" class="xs pri" onclick={() => applyOne(p)}>Apply Style</button>
          <button type="button" class="xs" onclick={() => exportPresetToJson(p)}>Share / .JSON</button>
          <button type="button" class="xs danger" style="margin-left:auto" onclick={() => removeOne(p.id)}>Delete</button>
        </div>
      </div>
    {/each}
  {/if}
</CategoryBlock>

<CategoryBlock title="Curated Client Templates" icon="sparkles" open={true}>
  {#each BUILT_IN_STUDIO_PRESETS as bp (bp.id)}
    <div class="sub-card">
      <div class="rt" style="justify-content:space-between">
        <b style="font-size:12.3px">{bp.name}</b>
        <span class="badge">{bp.format}</span>
      </div>
      <div class="hint" style="margin:3px 0 7px;font-size:11px">{bp.description}</div>
      <div class="bar" style="margin:0">
        <button type="button" class="xs pri" onclick={() => applyOne(bp)}>Apply Template</button>
        <button type="button" class="xs" onclick={() => exportPresetToJson(bp)}>Export .JSON</button>
      </div>
    </div>
  {/each}
</CategoryBlock>
