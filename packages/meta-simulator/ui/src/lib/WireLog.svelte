<script lang="ts">
  import type { SimEvent } from './types'

  let { events }: { events: SimEvent[] } = $props()

  const time = new Intl.DateTimeFormat('es', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  let el = $state<HTMLElement | undefined>()

  // Autoscroll sólo si ya estabas al final: si subiste a leer algo, un evento
  // nuevo no debería arrastrarte de vuelta abajo.
  $effect(() => {
    void events.length
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    if (atBottom) el.scrollTop = el.scrollHeight
  })

  function label(event: SimEvent): string {
    switch (event.type) {
      case 'inbound':
        return `POST webhook  ${event.from}`
      case 'outbound':
        return `POST /messages  ${event.to}`
      case 'status':
        return `status  ${event.state}`
      case 'webhook':
        return `${event.status || 'ERR'}  ${event.detail}`
    }
  }
</script>

<div class="log" bind:this={el}>
  {#if events.length === 0}
    <p class="empty">esperando tráfico…</p>
  {/if}

  <ol>
    {#each events as event, index (index)}
      <li class={event.type} class:bad={event.type === 'webhook' && !event.ok}>
        <time>{time.format(event.at)}</time>
        <span class="dot"></span>
        <span class="body">
          <span class="label">{label(event)}</span>
          {#if event.type === 'inbound' || event.type === 'outbound'}
            <span class="payload">{event.text}</span>
          {/if}
        </span>
      </li>
    {/each}
  </ol>
</div>

<style>
  .log {
    overflow-y: auto;
    padding: 12px 0;
  }

  ol {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: grid;
    grid-template-columns: auto 9px minmax(0, 1fr);
    gap: 10px;
    align-items: baseline;
    padding: 4px 16px;
    font-size: 11px;
    border-left: 2px solid transparent;
    animation: flash 0.5s ease-out;
  }
  /* Destello al llegar: el ojo detecta el evento nuevo sin leer la hora. */
  @keyframes flash {
    from {
      background: #ffffff0f;
    }
  }

  li:hover {
    background: #ffffff06;
  }

  time {
    color: var(--ink-faint);
    font-size: 10px;
  }

  .dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--ink-faint);
    transform: translateY(-1px);
  }
  li.inbound .dot {
    background: var(--user);
  }
  li.outbound .dot {
    background: var(--app);
  }
  li.webhook .dot {
    background: var(--ok);
  }
  li.bad .dot {
    background: var(--bad);
  }
  li.bad {
    border-left-color: var(--bad);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .label {
    color: var(--ink-dim);
    letter-spacing: 0.03em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  li.bad .label {
    color: var(--bad);
  }

  .payload {
    color: var(--ink-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    margin: 32px 0;
    text-align: center;
    color: var(--ink-faint);
  }
</style>
