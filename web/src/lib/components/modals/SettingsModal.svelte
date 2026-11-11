<script>
  import { onMount } from 'svelte';
  import { PROV } from '../../constants.js';
  import { studio } from '../../state.svelte.js';
  import { webAiCallJson } from '../../webPlatform/webAiClient.js';

  let { open = $bindable(false) } = $props();
  let tab = $state('ai'); // 'ai' | 'env' | 'keys' | 'ui'

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
    studio.refreshWebRuntime();
  });

  function saveAi() {
    studio.saveApiCfg({ prov, url: url.trim(), key: key.trim(), model: model.trim() });
    apiStatus = 'Saved ✔';
  }

  async function testAi() {
    saveAi();
    apiStatus = 'Testing /api/ai…';
    try {
      const res = await webAiCallJson({ prov, url: url.trim(), key: key.trim(), model: model.trim(), temp: 0 }, 'Return JSON: {"ok":true}', 'Return JSON only.');
      apiStatus = res?.ok !== undefined ? 'Connected ✔' : 'Connected (JSON received)';
    } catch (e) {
      apiStatus = 'Error: ' + (e?.message || e);
    }
  }

  async function saveWebKeys() {
    localStorage.icsOvr = JSON.stringify(ovr);
    await studio.refreshWebRuntime();
    envStatus = 'Saved & Refreshed ✔';
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
        <h3 style="margin:0">Web Studio Settings &amp; Capabilities</h3>
        <button type="button" class="xs" onclick={() => ((open = false), (studio.apiModalOpen = false))}>✕</button>
      </div>

      <div class="seg-pills quad">
        <button type="button" class:on={tab === 'ai'} onclick={() => (tab = 'ai')}>AI Providers</button>
        <button type="button" class:on={tab === 'env'} onclick={() => (tab = 'env')}>Browser &amp; ASR</button>
        <button type="button" class:on={tab === 'keys'} onclick={() => (tab = 'keys')}>Shortcuts</button>
        <button type="button" class:on={tab === 'ui'} onclick={() => (tab = 'ui')}>Appearance</button>
      </div>

      {#if tab === 'ai'}
        <div class="hint" style="margin:0 0 8px">
          Requests route via Vercel <code>/api/ai</code>. Leave API Key blank if configured in Vercel Environment Variables.
        </div>
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
              <option value="gemini">Google Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="groq">Groq</option>
              <option value="openrouter">OpenRouter</option>
              <option value="custom">Custom HTTPS</option>
            </select>
          </label>
          <label>Base URL<input bind:value={url} /></label>
          <label>
            Optional BYOK API Key {studio.serverHealth?.providers?.[prov] ? '(Server Env Active ✔)' : ''}
            <input type="password" bind:value={key} placeholder="Leave blank to use Vercel Env Key" />
          </label>
          <label>Model<input bind:value={model} /></label>
        </div>
        <div class="rt" style="margin-top:10px">
          <button type="button" class="sm" onclick={testAi}>Test Connection</button>
          <span class="hint" style="margin:0">{apiStatus}</span>
          <button type="button" class="pri sm" style="margin-left:auto" onclick={saveAi}>Save AI Settings</button>
        </div>
      {:else if tab === 'env'}
        <div class="sub-card" style="margin-bottom:8px">
          <div class="rt" style="justify-content:space-between;margin-bottom:4px">
            <b style="font-size:12px">Browser Video Engine Capabilities</b>
            <button type="button" class="xs" onclick={() => studio.refreshWebRuntime()}>Refresh</button>
          </div>
          <div class="sg" style="gap:6px;font-size:11.5px">
            <div>WebCodecs MP4: <b>{studio.caps?.webcodecsH264 ? 'Yes (Hardware)' : 'Fallback'}</b></div>
            <div>OffscreenCanvas: <b>{studio.caps?.hasOffscreenCanvas ? 'Yes' : 'No'}</b></div>
            <div>IndexedDB: <b>{studio.caps?.hasIndexedDb ? 'Ready' : 'No'}</b></div>
            <div>File Access API: <b>{studio.caps?.hasFileSystemAccess ? 'Supported' : 'Standard'}</b></div>
            <div>COOP/COEP Isolated: <b>{studio.caps?.crossOriginIsolated ? 'Yes' : 'No'}</b></div>
            <div>Storage Used: <b>{studio.storageStats?.usedMb ?? 0} MB</b></div>
          </div>
        </div>
        <div class="sg">
          <label>
            ElevenLabs Key (Optional BYOK)
            <input type="password" bind:value={ovr.elevenlabs_key} placeholder={studio.serverHealth?.providers?.elevenlabs ? 'Server Env Active ✔' : 'xi-api-key'} />
          </label>
          <label>
            OpenAI Whisper Key (Optional BYOK)
            <input type="password" bind:value={ovr.openai_key} placeholder={studio.serverHealth?.providers?.openai ? 'Server Env Active ✔' : 'sk-...'} />
          </label>
        </div>
        <div class="rt" style="margin-top:10px">
          <button type="button" class="pri sm" onclick={saveWebKeys}>Save &amp; Check Server</button>
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
    width: 490px;
    max-width: 94vw;
    background: var(--bg-secondary);
    border: 1px solid var(--border-strong);
    border-radius: 16px;
    padding: 20px;
    box-shadow: var(--shadow-lg);
  }
</style>
