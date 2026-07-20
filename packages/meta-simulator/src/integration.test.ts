import { afterEach, describe, expect, it } from 'vitest'
import { MetaClient, type ChatMessage, type WebhookServer } from '@wildtrip-company/meta-api'
import { MetaSimulator, type MetaSimulatorConfig } from './simulator.js'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

/**
 * Arranca el simulador en su puerto por defecto (4000).
 *
 * Es el mismo al que apunta `new MetaClient({ simulate: true })` sin más
 * configuración, así que el test recorre exactamente el camino que recorre
 * quien usa la librería, sin cablear URLs a mano.
 */
async function startSimulator(config: MetaSimulatorConfig): Promise<MetaSimulator> {
  const sim = new MetaSimulator({ logger: () => {}, ...config })
  await sim.start()
  cleanups.push(() => sim.stop())
  return sim
}

/** Levanta el webhook en un puerto libre y lo cierra al terminar el test. */
async function startWebhook(webhook: WebhookServer): Promise<WebhookServer> {
  await webhook.listen()
  cleanups.push(() => webhook.close())
  return webhook
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('se agotó el tiempo esperando la condición')
}

describe('ciclo completo: simulador ↔ app', () => {
  it('entrega el mensaje y el chat responde sin repetir ids', async () => {
    const received: ChatMessage[] = []
    const meta = new MetaClient({ simulate: true })

    const webhook = await startWebhook(
      meta.webhook({
        port: 0,
        onMessage: async (message, chat) => {
          received.push(message)
          await chat.reply(`recibí: ${message.text}`)
        },
      }),
    )

    const sim = await startSimulator({
      webhookUrl: webhook.url,
      businessId: '555000',
      autoStatuses: false,
    })

    await sim.userSends({ from: '5491100000000', text: 'hola' })
    await waitFor(() => sim.outbox.length > 0)

    expect(received[0]).toMatchObject({
      channel: 'whatsapp',
      from: '5491100000000',
      to: '555000',
      text: 'hola',
    })
    expect(sim.outbox[0]).toMatchObject({
      to: '5491100000000',
      content: { type: 'text', text: 'recibí: hola' },
    })
  })

  it('la app rechaza un webhook con firma inválida', async () => {
    const received: ChatMessage[] = []
    const meta = new MetaClient({ simulate: true })
    const webhook = await startWebhook(
      meta.webhook({ port: 0, onMessage: (m) => void received.push(m) }),
    )

    // El simulador firma con OTRO secreto: la app no debe procesar nada.
    const sim = await startSimulator({ webhookUrl: webhook.url, appSecret: 'secreto-equivocado' })
    await sim.userSends({ from: '549110', text: 'intruso' })
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(received).toHaveLength(0)
  })

  it('recibe los acuses de sent/delivered/read', async () => {
    const states: string[] = []
    const meta = new MetaClient({ simulate: true })

    const webhook = await startWebhook(
      meta.webhook({ port: 0, onStatus: (status) => void states.push(status.state) }),
    )
    await startSimulator({ webhookUrl: webhook.url })

    await meta.whatsapp('555000').sendText({ to: '549110', body: 'hola' })

    await waitFor(() => states.length >= 3)
    expect(states).toEqual(['sent', 'delivered', 'read'])
  })

  it('chat.markRead y chat.typing no ensucian el outbox', async () => {
    const meta = new MetaClient({ simulate: true })
    const webhook = await startWebhook(
      meta.webhook({
        port: 0,
        onMessage: async (_message, chat) => {
          await chat.markRead()
          await chat.typing()
          await chat.reply('listo')
        },
      }),
    )

    const sim = await startSimulator({ webhookUrl: webhook.url, autoStatuses: false })
    await sim.userSends({ from: '549110', text: 'hola' })
    await waitFor(() => sim.outbox.length > 0)

    // Acuses e indicadores no son mensajes: sólo la respuesta debe quedar.
    expect(sim.outbox).toHaveLength(1)
    expect(sim.outbox[0]?.content).toEqual({ type: 'text', text: 'listo' })
  })

  it('broadcast llega a todas las conversaciones vistas', async () => {
    const meta = new MetaClient({ simulate: true })
    const webhook = await startWebhook(meta.webhook({ port: 0 }))

    const sim = await startSimulator({
      webhookUrl: webhook.url,
      businessId: '555000',
      autoStatuses: false,
    })

    await sim.userSends({ from: '111', text: 'hola' })
    await sim.userSends({ from: '222', text: 'buenas' })
    await waitFor(() => webhook.conversations.length === 2)

    const results = await webhook.broadcast('aviso para todos')

    expect(results).toHaveLength(2)
    expect(results.every((r) => r.error === undefined)).toBe(true)
    expect(sim.outbox.map((m) => m.to).sort()).toEqual(['111', '222'])
  })
})

describe('configuración del cliente', () => {
  it('exige accessToken cuando no está simulando', () => {
    expect(() => new MetaClient({})).toThrowError(/accessToken/)
    expect(() => new MetaClient({ simulate: true })).not.toThrow()
  })

  it('apunta a graph.facebook.com en real y al simulador en simulado', () => {
    expect(new MetaClient({ accessToken: 'x' }).baseUrl).toBe('https://graph.facebook.com')
    expect(new MetaClient({ simulate: true }).baseUrl).toBe('http://localhost:4000')
    expect(new MetaClient({ simulate: true, simulatorUrl: 'http://127.0.0.1:5000/' }).baseUrl).toBe(
      'http://127.0.0.1:5000',
    )
  })

  it('pide verifyToken al crear un webhook real, pero no al simular', () => {
    expect(() => new MetaClient({ accessToken: 'x', appSecret: 'y' }).webhook()).toThrowError(
      /verifyToken/,
    )
    expect(() => new MetaClient({ simulate: true }).webhook()).not.toThrow()
  })
})

describe('handshake de verificación', () => {
  it('devuelve el challenge, rechaza el token malo y ignora otras rutas', async () => {
    const meta = new MetaClient({ accessToken: 'x', appSecret: 'y', verifyToken: 'secreto' })
    const webhook = await startWebhook(meta.webhook({ port: 0 }))

    const ok = await fetch(
      `${webhook.url}?hub.mode=subscribe&hub.verify_token=secreto&hub.challenge=12345`,
    )
    expect(ok.status).toBe(200)
    expect(await ok.text()).toBe('12345')

    const bad = await fetch(
      `${webhook.url}?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=12345`,
    )
    expect(bad.status).toBe(403)

    const otra = await fetch(`http://localhost:${webhook.port}/otra-cosa`)
    expect(otra.status).toBe(404)
  })
})
