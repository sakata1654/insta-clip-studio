<script>
  import { studio } from '../../state.svelte.js';
  import CategoryBlock from '../CategoryBlock.svelte';

  function addTextOverlay() {
    const t = studio.currentPlayhead();
    const o = { id: studio.nextId(), s: t, e: Math.min(t + 3, studio.dur || t + 3), t: 'Your text', x: 50, y: 30, size: 90, color: '#ffe600', sw: 8 };
    studio.texts.push(o);
    studio.sel = o.id;
    studio.inv();
    studio.snap();
  }
</script>

<CategoryBlock title="Floating Text Overlays" icon="type" open={true}>
  <button type="button" class="pri sm" style="width:100%;margin-bottom:8px" onclick={addTextOverlay}>
    + Add text at playhead
  </button>
  {#each studio.texts as o, i (o.id)}
    <div class="sub-card" style={studio.sel === o.id ? 'border-color:var(--accent-primary)' : ''}>
      <div class="rt" style="margin-bottom:6px">
        <input type="number" step="0.1" style="width:66px;padding:3px 6px" bind:value={o.s} oninput={() => studio.inv()} />
        <input type="number" step="0.1" style="width:66px;padding:3px 6px" bind:value={o.e} oninput={() => studio.inv()} />
        <input type="number" min="10" max="400" style="width:60px;padding:3px 6px" bind:value={o.size} oninput={() => studio.inv()} title="Size" />
        <input type="color" bind:value={o.color} oninput={() => studio.inv()} />
        <button type="button" class="xs" onclick={() => ((studio.sel = o.id), studio.seek(o.s))}>⏵</button>
        <button type="button" class="xs" onclick={() => (studio.texts.splice(i, 1), studio.inv(), studio.snap())}>✕</button>
      </div>
      <textarea rows="2" style="width:100%" bind:value={o.t} oninput={() => studio.inv()}></textarea>
    </div>
  {:else}
    <div class="hint">Add floating labels, citations, or titles and drag them directly on the canvas.</div>
  {/each}
</CategoryBlock>
