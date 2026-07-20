import { DEFAULT_API_VERSION, GRAPH_URL, type MetaClientConfig } from './types.js'
import { DEV_APP_SECRET, DEV_SIMULATOR_URL, DEV_VERIFY_TOKEN } from './dev.js'
import { MetaApiError, MetaConfigError } from './errors.js'
import { WhatsAppChannel } from './channels/whatsapp.js'
import { MessengerChannel } from './channels/messenger.js'
import { InstagramChannel } from './channels/instagram.js'
import { WebhookServer, type WebhookServerOptions } from './webhook/server.js'

export interface WebhookOptions extends WebhookServerOptions {
  /** Sobrescribe el `verifyToken` del cliente para este webhook. */
  verifyToken?: string
  /** Sobrescribe el `appSecret` del cliente para este webhook. */
  appSecret?: string
}

/**
 * Punto de entrada único: enviar y recibir salen de acá.
 *
 * En desarrollo:
 *
 * ```ts
 * const meta = new MetaClient({ simulate: true })
 * ```
 *
 * En producción:
 *
 * ```ts
 * const meta = new MetaClient({ accessToken, appSecret, verifyToken })
 * ```
 *
 * Nada más cambia. Enviás con `meta.whatsapp(id).sendText(...)` y recibís con
 * `meta.webhook({ onMessage })`, en los dos casos igual.
 */
export class MetaClient {
  readonly simulated: boolean
  readonly baseUrl: string
  readonly apiVersion: string
  readonly appSecret: string | undefined
  readonly verifyToken: string | undefined

  readonly #accessToken: string
  readonly #fetch: typeof globalThis.fetch
  readonly #timeoutMs: number

  constructor(config: MetaClientConfig = {}) {
    this.simulated = config.simulate ?? false

    // Contra el simulador no hay credenciales reales que configurar: los
    // valores de desarrollo están en duro y son los que el simulador espera.
    if (this.simulated) {
      this.#accessToken = config.accessToken ?? 'dev-access-token'
      this.appSecret = config.appSecret ?? DEV_APP_SECRET
      this.verifyToken = config.verifyToken ?? DEV_VERIFY_TOKEN
      this.baseUrl = trimSlashes(config.baseUrl ?? config.simulatorUrl ?? DEV_SIMULATOR_URL)
    } else {
      if (!config.accessToken) {
        throw new MetaConfigError(
          '`accessToken` es obligatorio. Para desarrollo local usá `simulate: true`.',
        )
      }
      this.#accessToken = config.accessToken
      this.appSecret = config.appSecret
      this.verifyToken = config.verifyToken
      this.baseUrl = trimSlashes(config.baseUrl ?? GRAPH_URL)
    }

    this.apiVersion = config.apiVersion ?? DEFAULT_API_VERSION
    this.#timeoutMs = config.timeoutMs ?? 30_000

    const fetchImpl = config.fetch ?? globalThis.fetch
    if (typeof fetchImpl !== 'function') {
      throw new MetaConfigError('No hay `fetch` disponible: pasá uno en `config.fetch`.')
    }
    // Bind: fetch nativo lanza "Illegal invocation" si pierde su receptor.
    this.#fetch = fetchImpl.bind(globalThis)
  }

  /**
   * Crea el webhook para recibir mensajes. Se hostea solo: `await .listen()`.
   *
   * La ruta y el puerto se declaran acá, no al montarlo, porque son parte de
   * cómo se identifica este webhook ante Meta y no algo que deba poder cambiar
   * desde afuera.
   */
  webhook(options: WebhookOptions = {}): WebhookServer {
    const verifyToken = options.verifyToken ?? this.verifyToken
    if (!verifyToken) {
      throw new MetaConfigError(
        'Falta `verifyToken`: pasalo al crear el cliente o a `webhook()`. Es el string ' +
          'que Meta te devuelve en el handshake de suscripción.',
      )
    }

    const appSecret = options.appSecret ?? this.appSecret
    // Sin `appSecret` cualquiera que conozca la URL puede inyectar mensajes
    // falsos, así que avisamos en vez de dejarlo pasar en silencio.
    if (!appSecret && !this.simulated) {
      console.warn(
        '[meta-api] webhook sin `appSecret`: no se valida la firma de los eventos entrantes.',
      )
    }

    return new WebhookServer(
      this,
      { verifyToken, ...(appSecret !== undefined && { appSecret }) },
      options,
    )
  }

  /** WhatsApp Cloud API para un phone number ID concreto. */
  whatsapp(phoneNumberId: string): WhatsAppChannel {
    return new WhatsAppChannel(this, phoneNumberId)
  }

  /** Messenger para una página de Facebook. */
  messenger(pageId: string): MessengerChannel {
    return new MessengerChannel(this, pageId)
  }

  /** Instagram Messaging para una cuenta profesional. */
  instagram(igUserId: string): InstagramChannel {
    return new InstagramChannel(this, igUserId)
  }

  /**
   * Request crudo contra la Graph API. Los canales se apoyan en esto; está
   * público para llegar a endpoints que todavía no envolvimos.
   */
  async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const url = `${this.baseUrl}/${this.apiVersion}/${path.replace(/^\/+/, '')}`

    const response = await this.#fetch(url, {
      method: init.method ?? 'POST',
      headers: {
        Authorization: `Bearer ${this.#accessToken}`,
        'Content-Type': 'application/json',
      },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(this.#timeoutMs),
    })

    const text = await response.text()
    let payload: unknown
    try {
      payload = text ? JSON.parse(text) : {}
    } catch {
      payload = { raw: text }
    }

    if (!response.ok) throw toApiError(response.status, payload)
    return payload as T
  }
}

function trimSlashes(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Traduce el sobre de error de Meta (`{ error: { ... } }`) a `MetaApiError`. */
function toApiError(status: number, payload: unknown): MetaApiError {
  const error = (payload as { error?: Record<string, unknown> } | null)?.error
  return new MetaApiError({
    message: typeof error?.message === 'string' ? error.message : `Meta respondió ${status}`,
    status,
    ...(typeof error?.code === 'number' && { code: error.code }),
    ...(typeof error?.error_subcode === 'number' && { subcode: error.error_subcode }),
    ...(typeof error?.fbtrace_id === 'string' && { traceId: error.fbtrace_id }),
    raw: payload,
  })
}
