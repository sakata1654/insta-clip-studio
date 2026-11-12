<script>
  import CameraPanel from '../panels/CameraPanel.svelte';
  import StudioPresetsPanel from '../panels/StudioPresetsPanel.svelte';
  import CanvasWorkflow from './CanvasWorkflow.svelte';
  import EffectsWorkflow from './EffectsWorkflow.svelte';

  let subTab = $state('layout'); // 'layout' | 'color' | 'camera' | 'presets'
</script>

<div class="seg-pills quad">
  <button type="button" class:on={subTab === 'layout'} onclick={() => (subTab = 'layout')}>Layout</button>
  <button type="button" class:on={subTab === 'color'} onclick={() => (subTab = 'color')}>Color</button>
  <button type="button" class:on={subTab === 'camera'} onclick={() => (subTab = 'camera')}>Camera</button>
  <button type="button" class:on={subTab === 'presets'} onclick={() => (subTab = 'presets')}>Presets</button>
</div>

{#if subTab === 'layout'}
  <CanvasWorkflow />
{:else if subTab === 'color'}
  <EffectsWorkflow />
{:else if subTab === 'camera'}
  <CameraPanel />
{:else}
  <StudioPresetsPanel />
{/if}
