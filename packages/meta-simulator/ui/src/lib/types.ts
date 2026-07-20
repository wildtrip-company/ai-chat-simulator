export type SimEvent =
  | { type: 'inbound'; id: string; from: string; text: string; at: number }
  | { type: 'outbound'; id: string; to: string; text: string; kind: string; at: number }
  | { type: 'status'; messageId: string; state: string; at: number }
  | { type: 'webhook'; ok: boolean; status: number; detail: string; at: number }

export interface SimMessage {
  id: string
  timestamp: string
  content: { type: string; text?: string }
}

export interface SimState {
  channel: string
  businessId: string
  webhookUrl: string
  hasPersona: boolean
  inbox: SimMessage[]
  outbox: SimMessage[]
}

/** Un mensaje ya ubicado de un lado u otro de la conversación. */
export interface Turn {
  id: string
  side: 'user' | 'app'
  text: string
  at: number
  /** Acuses acumulados: sent, delivered, read. */
  statuses: string[]
}
