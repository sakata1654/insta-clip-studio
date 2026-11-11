<script>
  import ExportPanel from '../panels/ExportPanel.svelte';

  let subTab = $state('exp'); // 'exp' | 'aud' | 'cap'
</script>

<div class="seg-pills tri">
  <button type="button" class:on={subTab === 'exp'} onclick={() => (subTab = 'exp')}>Render MP4</button>
  <button type="button" class:on={subTab === 'aud'} onclick={() => (subTab = 'aud')}>Audio AI</button>
  <button type="button" class:on={subTab === 'cap'} onclick={() => (subTab = 'cap')}>Caption</button>
</div>

<ExportPanel modeTab={subTab} />
