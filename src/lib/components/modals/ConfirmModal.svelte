<script>
  import { studio } from '../../state.svelte.js';
  import Icon from '../Icon.svelte';
</script>

{#if studio.confirmDialog.open}
  <div
    class="modal-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="confirm-title"
    tabindex="-1"
    onkeydown={(e) => e.key === 'Escape' && studio.resolveConfirm(false)}
    onclick={(e) => e.target === e.currentTarget && studio.resolveConfirm(false)}
  >
    <div class="modal-card confirm-card">
      <div class="rt" style="gap:10px;align-items:flex-start;margin-bottom:10px">
        <div class="confirm-icon" class:danger={studio.confirmDialog.danger}>
          <Icon name="alert" size={18} />
        </div>
        <div style="flex:1;min-width:0">
          <h3 id="confirm-title" style="margin:0;font-size:15px;font-weight:650">
            {studio.confirmDialog.title}
          </h3>
          {#if studio.confirmDialog.message}
            <p class="hint" style="margin:6px 0 0;font-size:12.5px;color:var(--text-secondary)">
              {studio.confirmDialog.message}
            </p>
          {/if}
        </div>
      </div>
      <div class="rt" style="justify-content:flex-end;gap:8px;margin-top:16px">
        <button type="button" class="sm" onclick={() => studio.resolveConfirm(false)}>
          {studio.confirmDialog.cancelText || 'Cancel'}
        </button>
        <button
          type="button"
          class="sm"
          class:danger={studio.confirmDialog.danger}
          class:pri={!studio.confirmDialog.danger}
          onclick={() => studio.resolveConfirm(true)}
        >
          {studio.confirmDialog.confirmText || 'Confirm'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .confirm-card {
    width: 420px;
    max-width: 92vw;
  }
  .confirm-icon {
    width: 34px;
    height: 34px;
    border-radius: var(--radius-md);
    display: grid;
    place-items: center;
    background: var(--accent-soft);
    color: var(--accent);
    flex-shrink: 0;
  }
  .confirm-icon.danger {
    background: var(--danger-soft);
    color: var(--danger-color);
  }
</style>
