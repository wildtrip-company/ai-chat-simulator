import type { IncomingMessage, StatusUpdate } from '../types.js'
import { verifySignature } from '../signature.js'
import { normalizeWebhook, type WebhookPayload } from './normalize.js'

/** Request entrante, reducida a lo que el handler necesita. */
export interface WebhookRequest {
  method: string
  /** Parámetros de query, ya parseados. */
  query: Record<string, string | undefined>
  /** Headers en minúscula. */
  headers: Record<string, string | undefined>
  /** Cuerpo **sin parsear**. Reserializar rompe la firma. */
  rawBody: string
}

export interface WebhookResponse {
  status: number
  body: string
}

export interface WebhookHandlerConfig {
  /** El mismo string que cargaste en el panel de Meta al suscribir el webhook. */
  verifyToken: string
  /**
   * App secret. Si se omite, **no se valida la firma**: sólo aceptable contra
   * el simulador en local. En producción, siempre pasalo.
   */
  appSecret?: string
  onMessage?: (message: IncomingMessage) => void | Promise<void>
  onStatus?: (status: StatusUpdate) => void | Promise<void>
  /** Se llama con cualquier error lanzado por tus handlers. */
  onError?: (error: unknown) => void
}

/**
 * Construye un handler de webhooks independiente del framework.
 *
 * No sabe nada de Hono ni de Next: recibe una forma mínima y devuelve
 * status y body. Los adapters de cada framework son envoltorios de pocas líneas
 * sobre esto, y en tests lo llamás directo sin levantar un servidor.
 */
export function createWebhookHandler(
  config: WebhookHandlerConfig,
): (request: WebhookRequest) => Promise<WebhookResponse> {
  return async function handle(request: WebhookRequest): Promise<WebhookResponse> {
    if (request.method === 'GET') return handleVerification(request, config.verifyToken)
    if (request.method !== 'POST') return { status: 405, body: 'Method Not Allowed' }

    if (config.appSecret) {
      const valid = await verifySignature({
        appSecret: config.appSecret,
        rawBody: request.rawBody,
        signatureHeader: request.headers['x-hub-signature-256'],
      })
      if (!valid) return { status: 401, body: 'Invalid signature' }
    }

    let payload: WebhookPayload
    try {
      payload = JSON.parse(request.rawBody) as WebhookPayload
    } catch {
      return { status: 400, body: 'Malformed JSON' }
    }

    const { messages, statuses } = normalizeWebhook(payload)

    // Meta reintenta el envío ante cualquier respuesta que no sea 200, y tras
    // varios fallos deshabilita la suscripción. Un error en tu lógica de negocio
    // no debe provocar eso: lo reportamos por `onError` y confirmamos igual.
    for (const message of messages) {
      try {
        await config.onMessage?.(message)
      } catch (error) {
        config.onError?.(error)
      }
    }
    for (const status of statuses) {
      try {
        await config.onStatus?.(status)
      } catch (error) {
        config.onError?.(error)
      }
    }

    return { status: 200, body: 'EVENT_RECEIVED' }
  }
}

/** Handshake de suscripción: Meta pide un GET y espera el challenge de vuelta. */
function handleVerification(request: WebhookRequest, verifyToken: string): WebhookResponse {
  const mode = request.query['hub.mode']
  const token = request.query['hub.verify_token']
  const challenge = request.query['hub.challenge']

  if (mode === 'subscribe' && token === verifyToken && challenge) {
    return { status: 200, body: challenge }
  }
  return { status: 403, body: 'Forbidden' }
}
