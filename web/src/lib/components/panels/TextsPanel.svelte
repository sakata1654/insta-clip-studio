<script>
  import { fmt, studio } from '../../state.svelte.js';
  import CategoryBlock from '../CategoryBlock.svelte';
  import Icon from '../Icon.svelte';
  import TextStyleFields from './TextStyleFields.svelte';

  function addTextOverlay() {
    const t = studio.currentPlayhead();
    const o = {
      id: studio.nextId(),
      s: +t.toFixed(2),
      e: +Math.min(t + 4, studio.dur || t + 4).toFixed(2),
      t: 'Your custom text',
      x: 50,
      y: 28,
      size: 76,
      color: '#ffffff',
      stroke: '#000000',
      sw: 6,
      bg: '#000000',
      bga: 0,
      boxR: 14,
      padX: 24,
      padY: 14,
      font: '',
      bold: true,
      upper: false,
      align: 'center',
      shadow: true,
      shc: '#000000',
      shb: 10,
      w: 88,
      anim: 'fade',
    };
    studio.texts.push(o);
    studio.sel = o.id;
    studio.selectedOverlayId = null;
    if (!studio.file && !studio.sampleSub) studio.sampleSub = 1;
    studio.inv();
    studio.snap();
  }
</script>

<CategoryBlock title="Floating Text Overlays" icon="type" open={true}>
  <button type="button" class="pri sm" style="width:100%;margin-bottom:8px" onclick={addTextOverlay}>
    <Icon name="plus" size={13} /> Add Text at Playhead
  </button>

  {#each studio.texts as o, i (o.id)}
    <div class="sub-card" style="{studio.sel === o.id ? 'border-color:var(--accent);' : ''}{o.enabled === false ? 'opacity:0.55;' : ''}">
      <div class="rt" style="justify-content:space-between;margin-bottom:6px">
        <button
          type="button"
          class="xs ghost"
          style="padding:2px 4px;font-weight:600;max-width:160px;overflow:hidden;text-overflow:ellipsis"
          onclick={() => {
            studio.sel = o.id;
            studio.selectedOverlayId = null;
            studio.seek(o.s);
          }}
        >
          #{i + 1} · {o.t?.trim() || 'Text'}
        </button>
        <div class="rt" style="gap:3px">
          <span class="badge mono">{fmt(o.s)}</span>
          <button
            type="button"
            class="xs"
            onclick={() => {
              o.enabled = o.enabled === false;
              studio.inv();
              studio.snap();
            }}
            title={o.enabled === false ? 'Show layer' : 'Hide layer'}
          >
            <Icon name={o.enabled === false ? 'eye-off' : 'eye'} size={11} />
          </button>
          <button type="button" class="xs" onclick={() => ((studio.sel = o.id), studio.seek(o.s))} title="Select & Jump">Edit</button>
          <button
            type="button"
            class="xs danger"
            onclick={() => {
              studio.texts.splice(i, 1);
              if (studio.sel === o.id) studio.sel = null;
              studio.inv();
              studio.snap();
            }}
            title="Remove text"
          >
            <Icon name="trash" size={11} />
          </button>
        </div>
      </div>

      {#if studio.sel === o.id}
        <TextStyleFields bind:item={studio.texts[i]} />
      {:else}
        <textarea rows="2" style="width:100%" bind:value={o.t} oninput={() => studio.inv()}></textarea>
      {/if}
    </div>
  {:else}
    <div class="hint" style="margin-bottom:0">
      Add floating titles, labels, or notes — customize font, color, outline, backdrop pill, shadow, and drag right on the canvas.
    </div>
  {/each}
</CategoryBlock>
