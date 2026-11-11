<script>
  import { onMount } from 'svelte';
  import { PROV } from '../../constants.js';
  import { aiHttpWithRetry } from '../../prompts.js';
  import { studio } from '../../state.svelte.js';
  import { getTauri } from '../../tauriBridge.js';

  let { open = $bindable(false) } = $props();
  let tab = $state('ai'); // 'ai' | 'env' | 'keys'

  let prov = $state(studio.API.prov);
  let url = $state(studio.API.url);
  let key = $state(studio.API.key);
  let model = $state(studio.API.model);
  let apiStatus = $state('');

  let ovr = $state(studio.ovrGet());
  let envStatus = $state('');

  $effect(() => {
    if (open) {
      prov = studio.API.prov;
      url = studio.API.url;
      key = studio.API.key;
      model = studio.API.model;
      ovr = studio.ovrGet();
    }
  });

  onMount(() => {
    scanEnv();
  });

  async function scanEnv() {
    const T = getTauri();
    if (!T?.core) return;
    try {
      await T.core.invoke('set_overrides', { map: studio.ovrGet() });
      studio.env = JSON.parse(await T.core.invoke('env_check'));
    } catch {}
  }

  function saveAi() {
    studio.saveApiCfg({ prov, url: url.trim(), key: key.trim(), model: model.trim() });
    apiStatus = 'Saved ✔';
  }

  async function testAi() {
    saveAi();
    apiStatus = 'Testing…';
    try {
      const f = getTauri()?.http?.fetch || fetch;
      const r = await aiHttpWithRetry(() =>
        f(url.replace(/\/$/, '') + '/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(key ? { authorization: 'Bearer ' + key } : {}) },
          body: JSON.stringify({ model, messages: [{ role: 'user', content: 'OK' }], temperature: 0 }),
        })
      );
      apiStatus = r.ok ? 'Connected' : 'Error: HTTP ' + r.status;
    } catch (e) {
      apiStatus = 'Error: ' + (e?.message || e);
    }
  }

  async function savePaths() {
    localStorage.icsOvr = JSON.stringify(ovr);
    await scanEnv();
    envStatus = 'Saved & Re-scanned ✔';
  }
</script>

{#if open || studio.apiModalOpen}
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onkeydown={(e) => e.key === 'Escape' && ((open = false), (studio.apiModalOpen = false))}
    onclick={(e) => e.target === e.currentTarget && ((open = false), (studio.apiModalOpen = false))}
  >
    <div class="modal-card">
      <div class="rt" style="justify-content:space-between;margin-bottom:8px">
        <h3 style="margin:0">Studio Settings & API Keys</h3>
        <button type="button" class="xs" onclick={() => ((open = false), (studio.apiModalOpen = false))}>✕</button>
      </div>

      <div class="seg-pills quad">
        <button type="button" class:on={tab === 'ai'} onclick={() => (tab = 'ai')}>AI Providers</button>
        <button type="button" class:on={tab === 'env'} onclick={() => (tab = 'env')}>Binaries &amp; Keys</button>
        <button type="button" class:on={tab === 'keys'} onclick={() => (tab = 'keys')}>Shortcuts</button>
        <button type="button" class:on={tab === 'ui'} onclick={() => (tab = 'ui')}>Appearance</button>
      </div>

      {#if tab === 'ai'}
        <div class="sg" style="grid-template-columns:1fr">
          <label>
            Provider
            <select
              bind:value={prov}
              onchange={() => {
                const p = PROV[prov] || ['', ''];
                url = p[0];
                model = p[1];
              }}
            >
              <option value="openai">OpenAI</option>
              <option value="gemini">Google Gemini</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="groq">Groq</option>
              <option value="openrouter">OpenRouter</option>
              <option value="ollama">Ollama (local)</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>Base URL<input bind:value={url} /></label>
          <label>API Key<input type="password" bind:value={key} placeholder="sk-…" /></label>
          <label>Model<input bind:value={model} /></label>
        </div>
        <div class="rt" style="margin-top:10px">
          <button type="button" class="sm" onclick={testAi}>Test Connection</button>
          <span class="hint" style="margin:0">{apiStatus}</span>
          <button type="button" class="pri sm" style="margin-left:auto" onclick={saveAi}>Save AI Settings</button>
        </div>
      {:else if tab === 'env'}
        <div class="sg">
          <label>ElevenLabs Key<input type="password" bind:value={ovr.elevenlabs_key} placeholder="xi-api-key" /></label>
          <label>HF Token (Cohere)<input type="password" bind:value={ovr.hf_token} placeholder="hf_..." /></label>
          <label>FFmpeg Path<input bind:value={ovr.ffmpeg} placeholder="ffmpeg.exe" /></label>
          <label>Python Path<input bind:value={ovr.python} placeholder="python.exe" /></label>
        </div>
        <div class="rt" style="margin-top:10px">
          <button type="button" class="pri sm" onclick={savePaths}>Save & Re-scan</button>
          <span class="hint" style="margin:0">{envStatus}</span>
        </div>
      {:else if tab === 'keys'}
        <div class="sg">
          {#each Object.entries(studio.shortcuts) as [k, v]}
            <label>{k}<input readonly value={v} /></label>
          {/each}
        </div>
      {:else}
        <div class="sub-card">
          <div class="rt" style="justify-content:space-between;margin-bottom:8px">
            <b>Interface Theme</b>
            <span class="badge">{studio.uiTheme === 'light' ? 'Light' : 'Dark Graphite'}</span>
          </div>
          <div class="seg-pills">
            <button type="button" class:on={studio.uiTheme !== 'light'} onclick={() => studio.applyUiTheme('dark')}>Dark Graphite</button>
            <button type="button" class:on={studio.uiTheme === 'light'} onclick={() => studio.applyUiTheme('light')}>Clean Light</button>
          </div>
          <p class="hint" style="margin:6px 0 0">Applies cleanly across the Project Homepage, Timeline Editor, Inspector, and Translation Desk.</p>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(5, 7, 11, 0.76);
    backdrop-filter: blur(8px);
    display: grid;
    place-items: center;
    z-index: 80;
  }
  .modal-card {
    width: 480px;
    max-width: 94vw;
    background: var(--bg-secondary);
    border: 1px solid var(--border-strong);
    border-radius: 16px;
    padding: 20px;
    box-shadow: var(--shadow-lg);
  }
</style>
