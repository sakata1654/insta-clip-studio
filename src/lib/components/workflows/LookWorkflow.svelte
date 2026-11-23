<script>
  import CameraPanel from '../panels/CameraPanel.svelte';
  import StudioPresetsPanel from '../panels/StudioPresetsPanel.svelte';
  import CanvasWorkflow from './CanvasWorkflow.svelte';
  import EffectsWorkflow from './EffectsWorkflow.svelte';
  import StyleWorkflow from './StyleWorkflow.svelte';

  let subTab = $state('subtitles'); // 'subtitles' | 'layout' | 'color' | 'presets'
</script>

<div class="seg-pills quad" style="margin-bottom:10px">
  <button type="button" class:on={subTab === 'subtitles'} onclick={() => (subTab = 'subtitles')}>Subtitles</button>
  <button type="button" class:on={subTab === 'layout'} onclick={() => (subTab = 'layout')}>Video Frame</button>
  <button type="button" class:on={subTab === 'color'} onclick={() => (subTab = 'color')}>Color &amp; FX</button>
  <button type="button" class:on={subTab === 'presets'} onclick={() => (subTab = 'presets')}>Presets</button>
</div>

{#if subTab === 'subtitles'}
  <StyleWorkflow />
{:else if subTab === 'layout'}
  <CanvasWorkflow />
{:else if subTab === 'color'}
  <EffectsWorkflow />
{:else}
  <StudioPresetsPanel />
{/if}
