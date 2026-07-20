<script lang="ts">
  import type { Turn } from './types'

  let { turns }: { turns: Turn[] } = $props()

  const time = new Intl.DateTimeFormat('es', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  /** El acuse más avanzado es el que importa mostrar. */
  function lastStatus(statuses: string[]): string | undefined {
    for (const state of ['read', 'delivered', 'sent']) {
      if (statuses.includes(state)) return state
    }
    return undefined
  }
</script>

{#if turns.length === 0}
  <p class="empty">
    Sin mensajes todavía.<br />
    Escribí abajo para mandar uno como el usuario.
  </p>
{/if}

<ol>
  {#each turns as turn (turn.id)}
    <li class={turn.side}>
      <div class="bubble">
        <span class="text">{turn.text}</span>
      </div>
      <div class="foot">
        <span class="who">{turn.side === 'user' ? 'usuario' : 'tu app'}</span>
        <time>{time.format(turn.at)}</time>
        {#if lastStatus(turn.statuses)}
          <span class="status">{lastStatus(turn.statuses)}</span>
        {/if}
      </div>
    </li>
  {/each}
</ol>

<style>
  ol {
    display: flex;
    flex-direction: column;
    gap: 14px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 74%;
    /* Entrada breve: el mensaje se asienta, no rebota. */
    animation: settle 0.22s cubic-bezier(0.2, 0.7, 0.3, 1);
  }
  @keyframes settle {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }

  li.user {
    align-self: flex-start;
  }
  li.app {
    align-self: flex-end;
    align-items: flex-end;
  }

  .bubble {
    padding: 9px 13px;
    border: 1px solid;
    border-radius: 3px;
    /* Sin esquinas redondeadas de app de chat: esto es un instrumento. */
    word-break: break-word;
    white-space: pre-wrap;
  }

  li.user .bubble {
    background: var(--user-glow);
    border-color: #f0a24b4d;
    border-left-width: 2px;
    border-left-color: var(--user);
  }
  li.app .bubble {
    background: var(--app-glow);
    border-color: #4fc3d94d;
    border-right-width: 2px;
    border-right-color: var(--app);
  }

  .foot {
    display: flex;
    gap: 10px;
    align-items: baseline;
    font-size: 10px;
    color: var(--ink-faint);
    letter-spacing: 0.06em;
  }

  .who {
    text-transform: uppercase;
  }
  li.user .who {
    color: #f0a24b99;
  }
  li.app .who {
    color: #4fc3d999;
  }

  .status {
    color: var(--ok);
  }

  .empty {
    margin: 48px 0;
    text-align: center;
    color: var(--ink-faint);
    line-height: 2;
  }
</style>
