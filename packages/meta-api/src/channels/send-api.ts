import type { MetaClient } from '../client.js'
import type { SendResult } from '../types.js'

interface SendApiResponse {
  message_id?: string
  recipient_id?: string
}

/** Respuesta rápida: botón que aparece bajo el mensaje y desaparece al tocarlo. */
export interface QuickReply {
  title: string
  payload: string
  imageUrl?: string
}

/**
 * Base compartida por Messenger e Instagram: ambos usan la misma Send API
 * (`POST /{id}/messages` con `{ recipient, message }`), sólo cambian los
 * subconjuntos que cada producto soporta.
 */
export abstract class SendApiChannel {
  constructor(
    protected readonly client: MetaClient,
    protected readonly nodeId: string,
  ) {}

  async sendText(params: {
    to: string
    text: string
    quickReplies?: QuickReply[]
  }): Promise<SendResult> {
    return this.send({
      to: params.to,
      message: {
        text: params.text,
        ...(params.quickReplies?.length && {
          quick_replies: params.quickReplies.map((qr) => ({
            content_type: 'text',
            title: qr.title,
            payload: qr.payload,
            ...(qr.imageUrl !== undefined && { image_url: qr.imageUrl }),
          })),
        }),
      },
    })
  }

  /** Adjunto por URL. `type` según el medio. */
  async sendAttachment(params: {
    to: string
    type: 'image' | 'audio' | 'video' | 'file'
    url: string
    reusable?: boolean
  }): Promise<SendResult> {
    return this.send({
      to: params.to,
      message: {
        attachment: {
          type: params.type,
          payload: { url: params.url, is_reusable: params.reusable ?? false },
        },
      },
    })
  }

  /** Indicador de "escribiendo…" o acuse de lectura. */
  async sendAction(params: {
    to: string
    action: 'mark_seen' | 'typing_on' | 'typing_off'
  }): Promise<void> {
    await this.client.request(`${this.nodeId}/messages`, {
      body: { recipient: { id: params.to }, sender_action: params.action },
    })
  }

  protected async send(params: {
    to: string
    message: Record<string, unknown>
    messagingType?: string
    /** Obligatorio cuando `messagingType` es `MESSAGE_TAG`. */
    tag?: string
  }): Promise<SendResult> {
    const response = await this.client.request<SendApiResponse>(`${this.nodeId}/messages`, {
      body: {
        recipient: { id: params.to },
        messaging_type: params.messagingType ?? 'RESPONSE',
        ...(params.tag !== undefined && { tag: params.tag }),
        message: params.message,
      },
    })
    return {
      messageId: response.message_id ?? '',
      recipientId: response.recipient_id ?? params.to,
      raw: response,
    }
  }
}
