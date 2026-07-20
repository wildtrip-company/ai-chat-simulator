/** Error devuelto por la Graph API (o por el simulador imitándola). */
export class MetaApiError extends Error {
  readonly status: number
  /** Código de error de Meta, p. ej. 131030 (número no en la allow-list). */
  readonly code: number | undefined
  readonly subcode: number | undefined
  readonly traceId: string | undefined
  readonly raw: unknown

  constructor(params: {
    message: string
    status: number
    code?: number
    subcode?: number
    traceId?: string
    raw?: unknown
  }) {
    super(params.message)
    this.name = 'MetaApiError'
    this.status = params.status
    this.code = params.code
    this.subcode = params.subcode
    this.traceId = params.traceId
    this.raw = params.raw
  }

  /** `true` si reintentar tiene sentido: rate limit o fallo transitorio. */
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500
  }
}

/** La configuración pasada al cliente es inválida. */
export class MetaConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MetaConfigError'
  }
}

/** El webhook entrante no pasó la validación de firma o de forma. */
export class WebhookVerificationError extends Error {
  readonly reason: 'missing-signature' | 'bad-signature' | 'missing-secret' | 'malformed-body'

  constructor(reason: WebhookVerificationError['reason'], message: string) {
    super(message)
    this.name = 'WebhookVerificationError'
    this.reason = reason
  }
}
