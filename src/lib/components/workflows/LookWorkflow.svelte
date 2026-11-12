<script>
  import CameraPanel from '../panels/CameraPanel.svelte';
  import CanvasWorkflow from './CanvasWorkflow.svelte';
  import EffectsWorkflow from './EffectsWorkflow.svelte';

  let subTab = $state('layout'); // 'layout' | 'color' | 'camera'
</script>

<div class="seg-pills" style="grid-template-columns:repeat(3,minmax(0,1fr))">
  <button type="button" class:on={subTab === 'layout'} onclick={() => (subTab = 'layout')}>Layout</button>
  <button type="button" class:on={subTab === 'color'} onclick={() => (subTab = 'color')}>Color &amp; Glow</button>
  <button type="button" class:on={subTab === 'camera'} onclick={() => (subTab = 'camera')}>Camera</button>
</div>

{#if subTab === 'layout'}
  <CanvasWorkflow />
{:else if subTab === 'color'}
  <EffectsWorkflow />
{:else}
  <CameraPanel />
{/if}
