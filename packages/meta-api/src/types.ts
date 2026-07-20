/** Producto de Meta sobre el que se envía o desde el que se recibe un mensaje. */
export type Channel = 'whatsapp' | 'messenger' | 'instagram'

export const GRAPH_URL = 'https://graph.facebook.com'
export const DEFAULT_API_VERSION = 'v21.0'

/**
 * Toda la configuración entra por acá. La librería nunca lee `process.env`:
 * quien la usa decide de dónde salen los valores.
 */
export interface MetaClientConfig {
  /**
   * Apunta al simulador en vez de a Meta. Con esto en `true`, `accessToken`,
   * `appSecret` y `verifyToken` toman los valores de desarrollo si no los pasás.
   */
  simulate?: boolean
  /** Dónde escucha el simulador. Por defecto `http://localhost:4000`. */
  simulatorUrl?: string
  /** Token de acceso. Obligatorio salvo que `simulate` sea `true`. */
  accessToken?: string
  /** Valida la firma de los webhooks entrantes. */
  appSecret?: string
  /** El string del handshake de suscripción que cargaste en el panel de Meta. */
  verifyToken?: string
  /** Por defecto `v21.0`. */
  apiVersion?: string
  /** Implementación de fetch a usar. Por defecto la global. */
  fetch?: typeof globalThis.fetch
  /** Corta la request pasado este tiempo. Por defecto 30000. */
  timeoutMs?: number
  /** Anula la URL base. Sólo para tests; normalmente alcanza con `simulate`. */
  baseUrl?: string
}

/** Resultado de un envío, homogéneo entre los tres productos. */
export interface SendResult {
  messageId: string
  recipientId: string
  raw: unknown
}

/** Contenido de un mensaje entrante, ya normalizado entre productos. */
export type MessageContent =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaId: string; caption?: string }
  | { type: 'audio'; mediaId: string }
  | { type: 'video'; mediaId: string; caption?: string }
  | { type: 'document'; mediaId: string; filename?: string }
  | { type: 'location'; latitude: number; longitude: number; name?: string }
  | { type: 'postback'; payload: string; title?: string }
  | { type: 'reaction'; emoji: string; targetMessageId: string }
  /** Llegó algo que todavía no modelamos. `raw` en el evento tiene el original. */
  | { type: 'unsupported'; kind: string }

/**
 * Un mensaje entrante. La misma forma para WhatsApp, Messenger e Instagram,
 * así el código de negocio no se ramifica por producto.
 */
export interface IncomingMessage {
  channel: Channel
  messageId: string
  /** Con quién estás hablando: úsalo como clave de conversación. */
  from: string
  /** La cuenta de negocio que recibió el mensaje. */
  to: string
  timestamp: Date
  content: MessageContent
  /** Payload original de Meta, por si necesitás algo que no normalizamos. */
  raw: unknown
}

export type DeliveryState = 'sent' | 'delivered' | 'read' | 'failed'

/** Acuse de recibo de un mensaje que enviaste. */
export interface StatusUpdate {
  channel: Channel
  messageId: string
  recipientId: string
  state: DeliveryState
  timestamp: Date
  error?: { code: number; title: string }
  raw: unknown
}
