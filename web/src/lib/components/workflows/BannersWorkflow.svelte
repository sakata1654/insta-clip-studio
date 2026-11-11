<script>
  import NewsBannerPanel from '../panels/NewsBannerPanel.svelte';
  import OverlaysPanel from '../panels/OverlaysPanel.svelte';
  import TextsPanel from '../panels/TextsPanel.svelte';

  let subTab = $state('text'); // 'text' | 'speaker' | 'news'
</script>

<div class="seg-pills tri">
  <button type="button" class:on={subTab === 'text'} onclick={() => (subTab = 'text')}>Floating Text</button>
  <button type="button" class:on={subTab === 'speaker'} onclick={() => (subTab = 'speaker')}>Speaker &amp; Stamp</button>
  <button type="button" class:on={subTab === 'news'} onclick={() => (subTab = 'news')}>News Ticker</button>
</div>

{#if subTab === 'text'}
  <TextsPanel />
{:else if subTab === 'speaker'}
  <OverlaysPanel />
{:else}
  <NewsBannerPanel />
{/if}
