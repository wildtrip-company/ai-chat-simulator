import type { MetaClient } from '../client.js'
import type { SendResult } from '../types.js'

interface WhatsAppSendResponse {
  messages?: { id: string }[]
  contacts?: { wa_id: string }[]
}

/** Parámetro de una plantilla aprobada de WhatsApp. */
export interface TemplateComponent {
  type: 'header' | 'body' | 'button'
  parameters: Record<string, unknown>[]
  sub_type?: string
  index?: string
}

/** WhatsApp Cloud API, atada a un phone number ID. Se obtiene de `client.whatsapp(id)`. */
export class WhatsAppChannel {
  constructor(
    private readonly client: MetaClient,
    private readonly phoneNumberId: string,
  ) {}

  /** Mensaje de texto. Sólo válido dentro de la ventana de 24 h; fuera de ella usá `sendTemplate`. */
  async sendText(params: { to: string; body: string; previewUrl?: boolean }): Promise<SendResult> {
    return this.#send({
      to: params.to,
      type: 'text',
      text: { body: params.body, preview_url: params.previewUrl ?? false },
    })
  }

  /** Imagen por URL pública o por media ID previamente subido. */
  async sendImage(params: {
    to: string
    link?: string
    mediaId?: string
    caption?: string
  }): Promise<SendResult> {
    return this.#send({
      to: params.to,
      type: 'image',
      image: {
        ...(params.link !== undefined && { link: params.link }),
        ...(params.mediaId !== undefined && { id: params.mediaId }),
        ...(params.caption !== undefined && { caption: params.caption }),
      },
    })
  }

  /** Plantilla aprobada. Es la única forma de iniciar conversación fuera de las 24 h. */
  async sendTemplate(params: {
    to: string
    name: string
    languageCode: string
    components?: TemplateComponent[]
  }): Promise<SendResult> {
    return this.#send({
      to: params.to,
      type: 'template',
      template: {
        name: params.name,
        language: { code: params.languageCode },
        ...(params.components !== undefined && { components: params.components }),
      },
    })
  }

  /** Marca como leído (doble tilde azul) un mensaje entrante. */
  async markAsRead(messageId: string): Promise<void> {
    await this.client.request(`${this.phoneNumberId}/messages`, {
      body: { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
    })
  }

  /**
   * Muestra el indicador de "escribiendo…".
   *
   * WhatsApp no tiene un endpoint propio: va junto con marcar como leído un
   * mensaje concreto, y por eso pide el `messageId`. Se apaga solo a los 25
   * segundos o cuando enviás el mensaje.
   */
  async setTyping(messageId: string): Promise<void> {
    await this.client.request(`${this.phoneNumberId}/messages`, {
      body: {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: { type: 'text' },
      },
    })
  }

  async #send(payload: Record<string, unknown>): Promise<SendResult> {
    const response = await this.client.request<WhatsAppSendResponse>(
      `${this.phoneNumberId}/messages`,
      { body: { messaging_product: 'whatsapp', recipient_type: 'individual', ...payload } },
    )
    return {
      messageId: response.messages?.[0]?.id ?? '',
      recipientId: response.contacts?.[0]?.wa_id ?? String(payload['to'] ?? ''),
      raw: response,
    }
  }
}
