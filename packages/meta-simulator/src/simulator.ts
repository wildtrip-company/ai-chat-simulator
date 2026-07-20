import { createServer, type IncomingMessage as NodeRequest, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  DEV_APP_SECRET,
  DEV_VERIFY_TOKEN,
  type Channel,
  type DeliveryState,
  type MessageContent,
} from '@wildtrip-company/meta-api'
import { WebhookDispatcher } from './dispatcher.js'
import { buildInboundPayload, buildStatusPayload } from './payloads.js'
import { createPersona, type Persona, type PersonaConfig } from './persona.js'
import { EventHub } from './events.js'
import { serveUi } from './static.js'

/** Un mensaje que tu app envió a través de las rutas Graph del simulador. */
export interface OutboundMessage {
  id: string
  channel: Channel
  /** Destinatario: el usuario simulado. */
  to: string
  content: MessageContent
  timestamp: Date
  /** Cuerpo original que mandó tu app, tal cual llegó. */
  raw: unknown
}

/** Un mensaje que el usuario simulado envió a tu app. */
export interface InboundRecord {
  id: string
  from: string
  content: MessageContent
  timestamp: Date
}

export interface MetaSimulatorConfig {
  /** URL del webhook de tu app. A donde el simulador entrega los eventos. */
  webhookUrl: string
  /** Producto a simular. Por defecto `whatsapp`. */
  channel?: Channel
  /** ID de la cuenta de negocio simulada. Por defecto `100000000000000`. */
  businessId?: string
  /** Puerto del servidor. `0` toma uno libre. Por defecto 4000. */
  port?: number
  hostname?: string
  /**
   * Secreto con el que se firman los webhooks. Por defecto `DEV_APP_SECRET`.
   * Casi nunca hace falta cambiarlo: sirve para probar el rechazo por firma
   * inválida, mandando uno distinto del que espera tu app.
   */
  appSecret?: string
  /** Token del handshake GET. Por defecto `DEV_VERIFY_TOKEN`. */
  verifyToken?: string
  /** Emitir sent/delivered/read tras cada envío de tu app. Por defecto `true`. */
  autoStatuses?: boolean
  /** Persona de IA que responde como usuario. Si se omite, respondés a mano. */
  persona?: PersonaConfig
  /** Se llama cada vez que tu app envía un mensaje. */
  onOutbound?: (message: OutboundMessage) => void
  /** Se llama con cada mensaje del usuario simulado. */
  onInbound?: (message: InboundRecord) => void
  onError?: (error: unknown) => void
  /** Por defecto escribe en consola. Pasá `() => {}` para silenciarlo. */
  logger?: (message: string) => void
}

/**
 * Servidor de desarrollo que se hace pasar por Meta.
 *
 * Tu app le apunta con `mode: 'sandbox'` y no distingue: recibe las mismas
 * formas de request y respuesta que la Graph API real. Todo el estado vive en
 * memoria y se pierde al cortar el proceso — es una herramienta de desarrollo,
 * no una base de datos.
 *
 * ```ts
 * const sim = new MetaSimulator({ webhookUrl: 'http://localhost:3000/webhook' })
 * await sim.start()
 * await sim.userSends({ from: '5491100000000', text: 'hola' })
 * console.log(sim.outbox) // lo que respondió tu app
 * ```
 */
export class MetaSimulator {
  readonly channel: Channel
  readonly businessId: string
  /** Secreto efectivo con el que se firman los webhooks. */
  readonly appSecret: string
  /** Token efectivo del handshake de verificación. */
  readonly verifyToken: string

  #server: Server | undefined
  #port: number
  readonly #hostname: string
  readonly #config: MetaSimulatorConfig
  readonly #dispatcher: WebhookDispatcher
  readonly #persona: Persona | undefined
  readonly #log: (message: string) => void

  readonly #outbox: OutboundMessage[] = []
  readonly #inbox: InboundRecord[] = []
  readonly #events = new EventHub()
  #counter = 0

  constructor(config: MetaSimulatorConfig) {
    this.#config = config
    this.channel = config.channel ?? 'whatsapp'
    this.businessId = config.businessId ?? '100000000000000'
    this.#port = config.port ?? 4000
    this.#hostname = config.hostname ?? '127.0.0.1'
    this.appSecret = config.appSecret ?? DEV_APP_SECRET
    this.verifyToken = config.verifyToken ?? DEV_VERIFY_TOKEN
    this.#log = config.logger ?? ((message) => console.log(`[meta-simulator] ${message}`))

    // Siempre firmamos: así el camino de validación de tu app se ejercita en
    // cada corrida local, sin que tengas que configurar nada para conseguirlo.
    this.#dispatcher = new WebhookDispatcher({
      url: config.webhookUrl,
      appSecret: this.appSecret,
      onError: (error) => {
        this.#log(`no se pudo entregar el webhook: ${describe(error)}`)
        config.onError?.(error)
      },
    })

    this.#persona = config.persona ? createPersona(config.persona) : undefined
  }

  /** URL base a pasarle al cliente como `sandboxUrl`. */
  get url(): string {
    return `http://${this.#hostname}:${this.#port}`
  }

  /** Mensajes que envió tu app, en orden. */
  get outbox(): readonly OutboundMessage[] {
    return this.#outbox
  }

  /** Mensajes que envió el usuario simulado, en orden. */
  get inbox(): readonly InboundRecord[] {
    return this.#inbox
  }

  async start(): Promise<void> {
    if (this.#server) return

    const server = createServer((req, res) => {
      this.#route(req, res).catch((error) => {
        this.#config.onError?.(error)
        respond(res, 500, { error: { message: describe(error) } })
      })
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.#port, this.#hostname, () => {
        // Con `port: 0` el puerto real lo asigna el SO; hay que leerlo de vuelta
        // o `url` quedaría reportando 0 y los tests no sabrían dónde conectarse.
        const address = server.address() as AddressInfo | null
        if (address) this.#port = address.port
        server.removeListener('error', reject)
        resolve()
      })
    })

    this.#server = server
    this.#log(`panel en ${this.url} — simulando ${this.channel}`)
    this.#log(`entregando webhooks a ${this.#config.webhookUrl}`)
  }

  async stop(): Promise<void> {
    const server = this.#server
    if (!server) return
    this.#server = undefined
    // Los SSE quedan abiertos por diseño; sin cerrarlos, `close()` nunca resuelve.
    this.#events.closeAll()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }

  /** Borra outbox e inbox. Útil entre tests. */
  reset(): void {
    this.#outbox.length = 0
    this.#inbox.length = 0
  }

  /**
   * El usuario simulado le manda un mensaje a tu app: construye el payload con
   * la forma real de Meta, lo firma y lo entrega al webhook.
   */
  async userSends(params: {
    from: string
    text?: string
    content?: MessageContent
    profileName?: string
  }): Promise<InboundRecord> {
    const content: MessageContent = params.content ?? { type: 'text', text: params.text ?? '' }
    const record: InboundRecord = {
      id: this.#nextId('in'),
      from: params.from,
      content,
      timestamp: new Date(),
    }
    this.#inbox.push(record)
    this.#config.onInbound?.(record)
    this.#events.publish({
      type: 'inbound',
      id: record.id,
      from: record.from,
      text: preview(content),
      at: record.timestamp.getTime(),
    })

    const delivery = await this.#dispatcher.send(
      buildInboundPayload({
        channel: this.channel,
        businessId: this.businessId,
        from: record.from,
        messageId: record.id,
        timestamp: record.timestamp,
        content,
        ...(params.profileName !== undefined && { profileName: params.profileName }),
      }),
    )

    // El panel muestra si la app contestó el webhook, que es lo primero que
    // querés saber cuando "no pasa nada" al mandar un mensaje.
    this.#events.publish({
      type: 'webhook',
      ok: delivery !== undefined && delivery.status < 400,
      status: delivery?.status ?? 0,
      detail: delivery ? delivery.body.slice(0, 120) : 'sin respuesta de la app',
      at: Date.now(),
    })

    return record
  }

  // --- HTTP -----------------------------------------------------------------

  async #route(req: NodeRequest, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url)
    const path = url.pathname

    if (path === '/_sim/events' && req.method === 'GET') {
      return this.#events.subscribe(res)
    }

    if (path === '/_sim/state' && req.method === 'GET') {
      return respond(res, 200, {
        channel: this.channel,
        businessId: this.businessId,
        webhookUrl: this.#config.webhookUrl,
        hasPersona: this.#persona !== undefined,
        outbox: this.#outbox,
        inbox: this.#inbox,
      })
    }

    if (path === '/_sim/inbound' && req.method === 'POST') {
      const body = (await readJson(req)) as { from?: string; text?: string }
      if (!body.from) return respond(res, 400, { error: { message: '`from` es obligatorio' } })
      const record = await this.userSends({ from: body.from, text: body.text ?? '' })
      return respond(res, 200, record)
    }

    if (path === '/_sim/reset' && req.method === 'POST') {
      this.reset()
      return respond(res, 200, { ok: true })
    }

    // Rutas Graph: /v21.0/{nodeId}/messages
    const match = /^\/v\d+\.\d+\/([^/]+)\/messages\/?$/.exec(path)
    if (match && req.method === 'POST') {
      return this.#handleSend(await readJson(req), res)
    }

    // Lo que no es API es el panel web. Va último para que ninguna ruta del
    // simulador quede tapada por un archivo estático con el mismo nombre.
    if (req.method === 'GET' && !path.startsWith('/_sim/') && (await serveUi(path, res))) return

    respond(res, 404, {
      error: { message: `Ruta no simulada: ${req.method} ${path}`, type: 'GraphMethodException' },
    })
  }

  /** Imita `POST /{id}/messages` para los tres productos. */
  async #handleSend(body: unknown, res: ServerResponse): Promise<void> {
    const payload = (body ?? {}) as Record<string, unknown>
    const isWhatsApp = payload['messaging_product'] === 'whatsapp'

    // Acuses de lectura e indicadores de tipeo: no son mensajes, no van al outbox.
    if (payload['status'] === 'read' || typeof payload['sender_action'] === 'string') {
      return respond(res, 200, isWhatsApp ? { success: true } : { recipient_id: '', message_id: '' })
    }

    const to = isWhatsApp
      ? String(payload['to'] ?? '')
      : String((payload['recipient'] as { id?: string } | undefined)?.id ?? '')

    if (!to) {
      return respond(res, 400, {
        error: { message: 'Falta el destinatario', type: 'OAuthException', code: 100 },
      })
    }

    const message: OutboundMessage = {
      id: this.#nextId(this.channel === 'whatsapp' ? 'wamid' : 'mid'),
      channel: this.channel,
      to,
      content: isWhatsApp ? parseWhatsAppBody(payload) : parseSendApiBody(payload),
      timestamp: new Date(),
      raw: payload,
    }
    this.#outbox.push(message)
    this.#config.onOutbound?.(message)
    this.#log(`→ ${to}: ${preview(message.content)}`)
    this.#events.publish({
      type: 'outbound',
      id: message.id,
      to: message.to,
      text: preview(message.content),
      kind: message.content.type,
      at: message.timestamp.getTime(),
    })

    // Respondemos ya, con la forma exacta de Meta. Los efectos posteriores
    // (acuses, respuesta de la persona) van después para no bloquear el envío,
    // igual que en la API real, donde llegan como webhooks separados.
    respond(
      res,
      200,
      isWhatsApp
        ? {
            messaging_product: 'whatsapp',
            contacts: [{ input: to, wa_id: to }],
            messages: [{ id: message.id }],
          }
        : { recipient_id: to, message_id: message.id },
    )

    void this.#afterSend(message)
  }

  async #afterSend(message: OutboundMessage): Promise<void> {
    try {
      if (this.#config.autoStatuses !== false) {
        for (const state of ['sent', 'delivered', 'read'] as DeliveryState[]) {
          await this.#dispatcher.send(
            buildStatusPayload({
              channel: this.channel,
              businessId: this.businessId,
              messageId: message.id,
              recipientId: message.to,
              state,
              timestamp: new Date(),
            }),
          )
          this.#events.publish({ type: 'status', messageId: message.id, state, at: Date.now() })
        }
      }

      if (this.#persona && message.content.type === 'text') {
        const reply = await this.#persona.reply({
          history: this.#historyFor(message.to),
          lastBotMessage: message.content.text,
        })
        if (reply) await this.userSends({ from: message.to, text: reply })
      }
    } catch (error) {
      this.#log(`error después del envío: ${describe(error)}`)
      this.#config.onError?.(error)
    }
  }

  /** Conversación con un usuario, ordenada cronológicamente. */
  #historyFor(user: string): { role: 'user' | 'assistant'; text: string }[] {
    const turns: { role: 'user' | 'assistant'; text: string; at: number }[] = []

    for (const m of this.#inbox) {
      if (m.from === user && m.content.type === 'text') {
        turns.push({ role: 'user', text: m.content.text, at: m.timestamp.getTime() })
      }
    }
    for (const m of this.#outbox) {
      if (m.to === user && m.content.type === 'text') {
        turns.push({ role: 'assistant', text: m.content.text, at: m.timestamp.getTime() })
      }
    }

    return turns.sort((a, b) => a.at - b.at).map(({ role, text }) => ({ role, text }))
  }

  #nextId(prefix: string): string {
    this.#counter += 1
    return `${prefix}.SIM${Date.now().toString(36)}${this.#counter}`
  }
}

// --- parseo de lo que manda tu app ------------------------------------------

function parseWhatsAppBody(payload: Record<string, unknown>): MessageContent {
  const type = String(payload['type'] ?? 'text')
  switch (type) {
    case 'text':
      return { type: 'text', text: String((payload['text'] as { body?: string })?.body ?? '') }
    case 'image': {
      const image = payload['image'] as { id?: string; link?: string; caption?: string } | undefined
      return {
        type: 'image',
        mediaId: image?.id ?? image?.link ?? '',
        ...(image?.caption !== undefined && { caption: image.caption }),
      }
    }
    case 'template': {
      // Las plantillas no traen texto plano; dejamos el nombre para poder afirmar
      // sobre él en tests sin tener que hurgar en `raw`.
      const template = payload['template'] as { name?: string } | undefined
      return { type: 'text', text: `[template:${template?.name ?? 'unknown'}]` }
    }
    default:
      return { type: 'unsupported', kind: type }
  }
}

function parseSendApiBody(payload: Record<string, unknown>): MessageContent {
  const message = (payload['message'] ?? {}) as Record<string, unknown>
  if (typeof message['text'] === 'string') return { type: 'text', text: message['text'] }

  const attachment = message['attachment'] as
    | { type?: string; payload?: { url?: string; template_type?: string; text?: string } }
    | undefined

  if (attachment?.type === 'template') {
    return { type: 'text', text: attachment.payload?.text ?? '[template]' }
  }
  if (attachment?.type === 'image') return { type: 'image', mediaId: attachment.payload?.url ?? '' }
  if (attachment?.type === 'audio') return { type: 'audio', mediaId: attachment.payload?.url ?? '' }
  if (attachment?.type === 'video') return { type: 'video', mediaId: attachment.payload?.url ?? '' }
  if (attachment?.type === 'file') return { type: 'document', mediaId: attachment.payload?.url ?? '' }

  return { type: 'unsupported', kind: attachment?.type ?? 'empty' }
}

// --- helpers ----------------------------------------------------------------

async function readJson(req: NodeRequest): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

function respond(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(text),
  })
  res.end(text)
}

function preview(content: MessageContent): string {
  if (content.type === 'text') {
    return content.text.length > 60 ? `${content.text.slice(0, 57)}…` : content.text
  }
  return `[${content.type}]`
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
