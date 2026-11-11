<script>
  import Icon from './Icon.svelte';

  let {
    title = '',
    icon = 'sparkles',
    open = $bindable(true),
    toggleChecked = undefined,
    onToggle = undefined,
    children,
  } = $props();
</script>

<div class="style-category-block" class:collapsed={!open || toggleChecked === false}>
  <div
    class="style-category-heading"
    role="button"
    tabindex="0"
    onclick={() => (open = !open)}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open = !open;
      }
    }}
  >
    <span style="color:var(--accent-primary);display:flex">
      <Icon name={icon} size={15} />
    </span>
    <h4>{title}</h4>
    {#if onToggle}
      <div role="presentation" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={!!toggleChecked}
          onchange={(e) => onToggle(e.currentTarget.checked)}
        />
      </div>
    {:else}
      <span
        style="color:var(--text-thirdly);transition:transform .16s;transform:{open ? 'rotate(0deg)' : 'rotate(-90deg)'}"
      >
        <Icon name="chev" size={14} />
      </span>
    {/if}
  </div>

  {#if open && toggleChecked !== false}
    <div style="padding-top:2px">
      {@render children?.()}
    </div>
  {/if}
</div>
