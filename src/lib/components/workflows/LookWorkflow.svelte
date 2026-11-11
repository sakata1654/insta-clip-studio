<script>
  import StudioPresetsPanel from '../panels/StudioPresetsPanel.svelte';
  import CanvasWorkflow from './CanvasWorkflow.svelte';
  import EffectsWorkflow from './EffectsWorkflow.svelte';
  import StyleWorkflow from './StyleWorkflow.svelte';

  let subTab = $state('subtitles'); // 'frame' | 'subtitles' | 'color' | 'presets'
</script>

<div class="seg-pills quad">
  <button type="button" class:on={subTab === 'frame'} onclick={() => (subTab = 'frame')}>Format</button>
  <button type="button" class:on={subTab === 'subtitles'} onclick={() => (subTab = 'subtitles')}>Subtitles</button>
  <button type="button" class:on={subTab === 'color'} onclick={() => (subTab = 'color')}>Color</button>
  <button type="button" class:on={subTab === 'presets'} onclick={() => (subTab = 'presets')}>Presets</button>
</div>

{#if subTab === 'frame'}
  <CanvasWorkflow />
{:else if subTab === 'subtitles'}
  <StyleWorkflow />
{:else if subTab === 'color'}
  <EffectsWorkflow />
{:else}
  <StudioPresetsPanel />
{/if}
