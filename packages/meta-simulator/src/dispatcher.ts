import { signPayload } from '@wildtrip-company/meta-api'

export interface DispatchResult {
  status: number
  body: string
}

/**
 * Entrega webhooks a la app que estás desarrollando, firmados igual que Meta.
 *
 * Firmar de verdad (en vez de mandar sin firma) es deliberado: así el camino de
 * validación de tu app se ejercita en cada corrida local, y un bug de firma
 * aparece acá y no el día que conectás producción.
 */
export class WebhookDispatcher {
  constructor(
    private readonly options: {
      url: string
      appSecret?: string
      fetch?: typeof globalThis.fetch
      onError?: (error: unknown) => void
    },
  ) {}

  async send(payload: unknown): Promise<DispatchResult | undefined> {
    // Serializamos una sola vez y firmamos exactamente este string. Volver a
    // serializar para el body produciría otro texto y la firma no validaría.
    const rawBody = JSON.stringify(payload)

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (this.options.appSecret) {
      headers['X-Hub-Signature-256'] = await signPayload(this.options.appSecret, rawBody)
    }

    const fetchImpl = this.options.fetch ?? globalThis.fetch
    try {
      const response = await fetchImpl(this.options.url, {
        method: 'POST',
        headers,
        body: rawBody,
        signal: AbortSignal.timeout(15_000),
      })
      return { status: response.status, body: await response.text() }
    } catch (error) {
      // Que la app esté caída no debe tumbar el simulador: reportamos y seguimos.
      this.options.onError?.(error)
      return undefined
    }
  }
}
