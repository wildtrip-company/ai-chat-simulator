<script lang="ts">
  import { tick } from 'svelte'
  import Transcript from './lib/Transcript.svelte'
  import WireLog from './lib/WireLog.svelte'
  import type { SimEvent, SimState, Turn } from './lib/types'

  let turns = $state<Turn[]>([])
  let wire = $state<SimEvent[]>([])
  let info = $state<Partial<SimState>>({})
  let connected = $state(false)
  let draft = $state('')
  let from = $state('5491100000000')
  let sending = $state(false)
  let transcriptEl = $state<HTMLElement | undefined>()

  function addTurn(turn: Turn) {
    turns.push(turn)
    void scrollToEnd()
  }

  /**
   * Busca dentro del array reactivo, no en un índice aparte.
   *
   * Guardar las referencias en un Map no sirve: `$state` envuelve cada elemento
   * en un proxy al entrar al array, así que el objeto del Map es el original y
   * mutarlo no repinta nada.
   */
  function findTurn(id: string): Turn | undefined {
    return turns.find((turn) => turn.id === id)
  }

  async function scrollToEnd() {
    await tick()
    transcriptEl?.scrollTo({ top: transcriptEl.scrollHeight, behavior: 'smooth' })
  }

  async function loadState() {
    const response = await fetch('/_sim/state')
    const state: SimState = await response.json()
    info = state

    // Inbox y outbox son dos listas separadas; el panel las intercala por
    // tiempo para reconstruir la conversación tal como ocurrió.
    const merged: Turn[] = [
      ...state.inbox.map((m) => ({
        id: m.id,
        side: 'user' as const,
        text: describe(m.content),
        at: new Date(m.timestamp).getTime(),
        statuses: [],
      })),
      ...state.outbox.map((m) => ({
        id: m.id,
        side: 'app' as const,
        text: describe(m.content),
        at: new Date(m.timestamp).getTime(),
        statuses: [],
      })),
    ].sort((a, b) => a.at - b.at)

    turns = merged
    void scrollToEnd()
  }

  function describe(content: { type: string; text?: string }): string {
    return content.type === 'text' ? (content.text ?? '') : `[${content.type}]`
  }

  function connect() {
    const source = new EventSource('/_sim/events')

    source.onopen = () => (connected = true)
    // No cerramos ni reintentamos a mano: EventSource reconecta solo, y el
    // simulador reinicia seguido durante el desarrollo.
    source.onerror = () => (connected = false)

    source.onmessage = (message) => {
      const event: SimEvent = JSON.parse(message.data)
      wire = [...wire.slice(-199), event]

      if (event.type === 'inbound') {
        addTurn({ id: event.id, side: 'user', text: event.text, at: event.at, statuses: [] })
      } else if (event.type === 'outbound') {
        addTurn({ id: event.id, side: 'app', text: event.text, at: event.at, statuses: [] })
      } else if (event.type === 'status') {
        const turn = findTurn(event.messageId)
        if (turn && !turn.statuses.includes(event.state)) turn.statuses.push(event.state)
      }
    }

    return () => source.close()
  }

  async function send(event: SubmitEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || sending) return

    sending = true
    draft = ''
    try {
      await fetch('/_sim/inbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, text }),
      })
    } finally {
      sending = false
    }
  }

  async function reset() {
    await fetch('/_sim/reset', { method: 'POST' })
    turns = []
    wire = []
  }

  $effect(() => {
    void loadState()
    return connect()
  })
</script>

<div class="shell">
  <header>
    <div class="brand">
      <span class="mark" class:live={connected}></span>
      <h1>META&nbsp;SIMULATOR</h1>
      <span class="channel">{info.channel ?? '—'}</span>
    </div>

    <dl class="meta">
      <div><dt>webhook</dt><dd>{info.webhookUrl ?? '—'}</dd></div>
      <div><dt>business id</dt><dd>{info.businessId ?? '—'}</dd></div>
      <div>
        <dt>persona ia</dt>
        <dd class:on={info.hasPersona}>{info.hasPersona ? 'activa' : 'manual'}</dd>
      </div>
    </dl>

    <button class="reset" onclick={reset}>limpiar</button>
  </header>

  <main>
    <section class="conversation">
      <div class="pane-label">conversación</div>

      <div class="scroll" bind:this={transcriptEl}>
        <Transcript {turns} />
      </div>

      <form onsubmit={send}>
        <input class="from" bind:value={from} aria-label="Número del usuario simulado" />
        <input
          class="draft"
          bind:value={draft}
          placeholder={info.hasPersona
            ? 'la persona responde sola — escribí para intervenir'
            : 'escribí como el usuario…'}
          aria-label="Mensaje"
          autocomplete="off"
        />
        <button type="submit" disabled={!draft.trim() || sending}>enviar</button>
      </form>
    </section>

    <section class="wire">
      <div class="pane-label">tráfico</div>
      <WireLog events={wire} />
    </section>
  </main>
</div>

<style>
  .shell {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    height: 100%;
  }

  header {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 14px 20px;
    background: linear-gradient(180deg, var(--panel-raised), var(--panel));
    border-bottom: 1px solid var(--line);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  h1 {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.16em;
  }

  /* Punto de estado: apagado hasta que el SSE conecta, y ahí late. */
  .mark {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--ink-faint);
    transition: background 0.3s;
  }
  .mark.live {
    background: var(--ok);
    box-shadow: 0 0 0 0 #6ec98a99;
    animation: pulse 2.4s ease-out infinite;
  }
  @keyframes pulse {
    70% {
      box-shadow: 0 0 0 7px #6ec98a00;
    }
    100% {
      box-shadow: 0 0 0 0 #6ec98a00;
    }
  }

  .channel {
    padding: 2px 8px;
    border: 1px solid var(--line-bright);
    border-radius: 3px;
    color: var(--user);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .meta {
    display: flex;
    gap: 28px;
    margin: 0;
    margin-left: auto;
  }
  .meta div {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  dt {
    color: var(--ink-faint);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  dd {
    margin: 0;
    color: var(--ink-dim);
    font-size: 11px;
    max-width: 34ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  dd.on {
    color: var(--ok);
  }

  .reset {
    padding: 6px 12px;
    background: transparent;
    border: 1px solid var(--line-bright);
    border-radius: 3px;
    color: var(--ink-dim);
    font-size: 11px;
    letter-spacing: 0.06em;
    transition:
      color 0.15s,
      border-color 0.15s;
  }
  .reset:hover {
    color: var(--bad);
    border-color: var(--bad);
  }

  main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(320px, 0.72fr);
    min-height: 0;
  }

  section {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-height: 0;
    background: var(--panel);
  }
  .wire {
    grid-template-rows: auto minmax(0, 1fr);
    border-left: 1px solid var(--line);
    background: #0d1113;
  }

  .pane-label {
    padding: 7px 16px;
    border-bottom: 1px solid var(--line);
    color: var(--ink-faint);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
  }

  .scroll {
    overflow-y: auto;
    padding: 20px 16px;
  }

  form {
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--line);
    background: var(--panel-raised);
  }

  input {
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 3px;
    padding: 9px 11px;
    outline: none;
    transition: border-color 0.15s;
  }
  input:focus {
    border-color: var(--user);
  }
  .from {
    width: 17ch;
    color: var(--user);
  }
  .draft {
    flex: 1;
    min-width: 0;
  }
  .draft::placeholder {
    color: var(--ink-faint);
  }

  form button {
    padding: 0 18px;
    background: var(--user);
    border: none;
    border-radius: 3px;
    color: #0a0c0d;
    font-weight: 600;
    letter-spacing: 0.06em;
    transition: opacity 0.15s;
  }
  form button:disabled {
    opacity: 0.32;
    cursor: not-allowed;
  }

  @media (max-width: 900px) {
    main {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(0, 1.4fr) minmax(0, 1fr);
    }
    .wire {
      border-left: none;
      border-top: 1px solid var(--line);
    }
    .meta {
      display: none;
    }
  }
</style>
