import type { MetaClient } from '../client.js'
import type { SendResult, StatusUpdate } from '../types.js'
import { createWebhookHandler, type WebhookHandlerConfig } from './handler.js'
import { Chat, toChatMessage, type ChatMessage, type ConversationKey } from './chat.js'

export interface WebhookServerOptions {
  /** Ruta en la que escucha. Por defecto `/webhook`. */
  path?: string
  /** Puerto en el que escucha. Por defecto 3000. */
  port?: number
  hostname?: string
  /** Se llama con cada mensaje entrante, ya normalizado. */
  onMessage?: (message: ChatMessage, chat: Chat) => void | Promise<void>
  /** Acuses de los mensajes que enviaste. */
  onStatus?: (status: StatusUpdate) => void | Promise<void>
  onError?: (error: unknown) => void
}

/**
 * Webhook que se hostea solo.
 *
 * Declarás la ruta y el puerto acá y llamás a `listen()`: no hay que montar
 * nada en Express, Hono ni Next. La librería resuelve el servidor, y tu código
 * sólo escribe la lógica de conversación.
 *
 * ```ts
 * const webhook = meta.webhook({
 *   path: '/webhook',
 *   port: 3000,
 *   onMessage: async (msg, chat) => {
 *     await chat.reply(`Dijiste: ${msg.text}`)
 *   },
 * })
 *
 * await webhook.listen()
 * ```
 */
export class WebhookServer {
  readonly path: string
  readonly hostname: string
  /** Puerto efectivo. Con `port: 0` sólo se conoce después de `listen()`. */
  #port: number

  readonly #client: MetaClient
  readonly #options: WebhookServerOptions
  readonly #handle: ReturnType<typeof createWebhookHandler>
  #server: { close: (cb: (e?: Error) => void) => void } | undefined

  /**
   * Conversaciones vistas desde que arrancó, para `broadcast`.
   *
   * Es un caché en memoria, no una agenda: se pierde al reiniciar y sólo tiene
   * a quien te haya escrito en esta corrida. Meta no expone una lista de
   * contactos, así que no hay forma de reconstruirla.
   */
  readonly #seen = new Map<string, ConversationKey>()

  constructor(client: MetaClient, handlerConfig: WebhookHandlerConfig, options: WebhookServerOptions) {
    this.#client = client
    this.#options = options
    this.path = options.path ?? '/webhook'
    this.#port = options.port ?? 3000
    this.hostname = options.hostname ?? '0.0.0.0'

    this.#handle = createWebhookHandler({
      ...handlerConfig,
      onMessage: async (message) => {
        const key: ConversationKey = {
          channel: message.channel,
          businessId: message.to,
          userId: message.from,
        }
        this.#seen.set(`${key.channel}:${key.businessId}:${key.userId}`, key)

        await options.onMessage?.(
          toChatMessage(message),
          new Chat(this.#client, key, message.messageId),
        )
      },
      ...(options.onStatus !== undefined && { onStatus: options.onStatus }),
      ...(options.onError !== undefined && { onError: options.onError }),
    })
  }

  get port(): number {
    return this.#port
  }

  /** URL completa donde quedó escuchando. Es la que cargás en el panel de Meta. */
  get url(): string {
    const host = this.hostname === '0.0.0.0' ? 'localhost' : this.hostname
    return `http://${host}:${this.#port}${this.path}`
  }

  /** Conversaciones vistas desde que arrancó. */
  get conversations(): ConversationKey[] {
    return [...this.#seen.values()]
  }

  /** Arranca el servidor. */
  async listen(): Promise<this> {
    if (this.#server) return this

    // Import dinámico: así el módulo se puede cargar en runtimes sin `node:http`
    // (Workers, edge) mientras no llames a `listen()`.
    const { createServer } = await import('node:http')

    const server = createServer((req, res) => {
      void (async () => {
        const response = await this.#respond(req)
        res.writeHead(response.status, { 'Content-Type': 'text/plain' })
        res.end(await response.text())
      })()
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(this.#port, this.hostname, () => {
        // Con `port: 0` el puerto real lo asigna el SO; sin leerlo de vuelta,
        // `url` reportaría 0 y no habría forma de saber dónde quedó.
        const address = server.address()
        if (address && typeof address === 'object') this.#port = address.port
        server.removeListener('error', reject)
        resolve()
      })
    })

    this.#server = server
    return this
  }

  async close(): Promise<void> {
    const server = this.#server
    if (!server) return
    this.#server = undefined
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }

  /**
   * Manda el mismo texto a todas las conversaciones vistas.
   *
   * Devuelve un resultado por conversación; los envíos que fallan quedan como
   * `error` en vez de cortar el resto, porque una conversación fuera de la
   * ventana de 24 h no debería impedir que las demás reciban el aviso.
   */
  async broadcast(
    text: string,
  ): Promise<{ conversation: ConversationKey; result?: SendResult; error?: unknown }[]> {
    const targets = this.conversations
    return Promise.all(
      targets.map(async (conversation) => {
        try {
          const result = await new Chat(this.#client, conversation).reply(text)
          return { conversation, result }
        } catch (error) {
          this.#options.onError?.(error)
          return { conversation, error }
        }
      }),
    )
  }

  /** Obtiene el chat de alguien concreto, para escribirle sin esperar su mensaje. */
  chat(key: ConversationKey): Chat {
    return new Chat(this.#client, key)
  }

  /**
   * Handler de la Fetch API, por si preferís montarlo en tu propio servidor.
   *
   * No es el camino principal — `listen()` lo es — pero está expuesto para el
   * caso de que ya tengas un server con otras rutas y no quieras un segundo
   * proceso escuchando.
   */
  readonly fetch = async (request: Request): Promise<Response> => this.#respond(request)

  async #respond(request: Request | import('node:http').IncomingMessage): Promise<Response> {
    const isFetch = request instanceof Request

    let method: string
    let rawUrl: string
    let headers: Record<string, string | undefined> = {}
    let rawBody = ''

    if (isFetch) {
      method = request.method
      rawUrl = request.url
      request.headers.forEach((value, key) => (headers[key.toLowerCase()] = value))
      rawBody = method === 'GET' ? '' : await request.text()
    } else {
      method = request.method ?? 'GET'
      rawUrl = `http://localhost${request.url ?? '/'}`
      headers = request.headers as Record<string, string | undefined>
      const chunks: Uint8Array[] = []
      for await (const chunk of request) chunks.push(chunk as Uint8Array)
      rawBody = Buffer.concat(chunks).toString('utf8')
    }

    const url = new URL(rawUrl)
    if (url.pathname !== this.path) {
      return new Response('Not Found', { status: 404 })
    }

    const query: Record<string, string | undefined> = {}
    for (const [key, value] of url.searchParams) query[key] = value

    const result = await this.#handle({ method, query, headers, rawBody })
    return new Response(result.body, {
      status: result.status,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
}
