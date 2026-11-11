<script>
  import { PROV } from '../constants.js';
  import { aiHttpWithRetry } from '../prompts.js';
  import { studio } from '../state.svelte.js';
  import { getTauri } from '../tauriBridge.js';

  let prov = $state(studio.API.prov);
  let url = $state(studio.API.url);
  let key = $state(studio.API.key);
  let model = $state(studio.API.model);
  let status = $state('');

  $effect(() => {
    if (studio.apiModalOpen) {
      prov = studio.API.prov;
      url = studio.API.url;
      key = studio.API.key;
      model = studio.API.model;
      status = '';
    }
  });

  function save() {
    studio.saveApiCfg({ prov, url: url.trim(), key: key.trim(), model: model.trim() });
    status = 'Saved ✔';
  }

  async function testConn() {
    save();
    status = 'Testing…';
    try {
      const f = getTauri()?.http?.fetch || fetch;
      const u = url.replace(/\/$/, '');
      let reply = '';
      if (prov === 'anthropic') {
        const r = await aiHttpWithRetry(() =>
          f(u + '/messages', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': key,
              'anthropic-version': '2023-06-01',
              'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({ model, max_tokens: 16, messages: [{ role: 'user', content: 'Reply OK' }] }),
          })
        );
        const j = await r.json();
        reply = j.content?.[0]?.text || '';
      } else {
        const r = await aiHttpWithRetry(() =>
          f(u + '/chat/completions', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...(key ? { authorization: 'Bearer ' + key } : {}) },
            body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply OK' }], temperature: 0 }),
          })
        );
        const j = await r.json();
        reply = j.choices?.[0]?.message?.content || '';
      }
      status = reply ? '✅ Connected' : '⚠ Empty response';
    } catch (e) {
      status = '❌ ' + (e?.message || e);
    }
  }
</script>

{#if studio.apiModalOpen}
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    onkeydown={(e) => e.key === 'Escape' && (studio.apiModalOpen = false)}
    onclick={(e) => e.target === e.currentTarget && (studio.apiModalOpen = false)}
  >
    <div class="modal-card">
      <div class="rt" style="justify-content:space-between">
        <h3 style="margin:0">AI API Settings</h3>
        <button type="button" class="sm" onclick={() => (studio.apiModalOpen = false)}>✕</button>
      </div>
      <div class="hint" style="margin:0">Stored locally on your PC. Also synced on demand to the Translation tab.</div>
      <label class="field-lbl">
        Provider
        <select
          bind:value={prov}
          onchange={() => {
            const p = PROV[prov] || ['', ''];
            url = p[0];
            model = p[1];
          }}
        >
          <option value="openai">OpenAI (ChatGPT)</option>
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="gemini">Google Gemini</option>
          <option value="groq">Groq</option>
          <option value="openrouter">OpenRouter</option>
          <option value="ollama">Ollama (local)</option>
          <option value="custom">Custom OpenAI-compatible</option>
        </select>
      </label>
      <label class="field-lbl">Base URL <input bind:value={url} /></label>
      <label class="field-lbl">API Key <input type="password" bind:value={key} placeholder="sk-…" /></label>
      <label class="field-lbl">Model <input bind:value={model} /></label>
      <div class="rt">
        <button type="button" onclick={testConn}>Test connection</button>
        <span class="hint" style="margin:0">{status}</span>
        <button type="button" class="pri" style="margin-left:auto" onclick={save}>Save</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(8px);
    display: grid;
    place-items: center;
    z-index: 70;
  }
  .modal-card {
    width: 440px;
    max-width: 94vw;
    background: var(--bg-secondary);
    border: 1px solid var(--border-strong);
    border-radius: 16px;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-shadow: var(--shadow-lg);
  }
  .field-lbl {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
    color: var(--text-thirdly);
  }
</style>
