import type { MetaClient } from '../client.js'
import type { Channel, IncomingMessage, SendResult } from '../types.js'

/** Identifica una conversación sin ambigüedad entre productos y cuentas. */
export interface ConversationKey {
  channel: Channel
  /** La cuenta de negocio que recibió el mensaje. */
  businessId: string
  /** La persona del otro lado. */
  userId: string
}

/**
 * La conversación en curso, ya resuelta.
 *
 * Existe para que responder no exija repetir ids ni saber de qué producto vino
 * el mensaje: `chat.reply(...)` hace lo correcto en WhatsApp, Messenger e
 * Instagram, que tienen APIs de envío distintas.
 */
export class Chat implements ConversationKey {
  readonly channel: Channel
  readonly businessId: string
  readonly userId: string
  /** Id del mensaje entrante que originó este chat, si lo hubo. */
  readonly messageId: string | undefined

  readonly #client: MetaClient

  constructor(client: MetaClient, key: ConversationKey, messageId?: string) {
    this.#client = client
    this.channel = key.channel
    this.businessId = key.businessId
    this.userId = key.userId
    this.messageId = messageId
  }

  /** Responde con texto. */
  async reply(text: string): Promise<SendResult> {
    if (this.channel === 'whatsapp') {
      return this.#client.whatsapp(this.businessId).sendText({ to: this.userId, body: text })
    }
    return this.#sendApi().sendText({ to: this.userId, text })
  }

  /** Envía una imagen por URL pública. */
  async image(url: string, caption?: string): Promise<SendResult> {
    if (this.channel === 'whatsapp') {
      return this.#client.whatsapp(this.businessId).sendImage({
        to: this.userId,
        link: url,
        ...(caption !== undefined && { caption }),
      })
    }
    return this.#sendApi().sendAttachment({ to: this.userId, type: 'image', url })
  }

  /**
   * Muestra el indicador de "escribiendo…".
   *
   * En WhatsApp va atado a marcar como leído un mensaje concreto, así que si el
   * chat no nació de un mensaje entrante no hay nada que mostrar y no hace nada.
   */
  async typing(): Promise<void> {
    if (this.channel === 'whatsapp') {
      if (!this.messageId) return
      await this.#client.whatsapp(this.businessId).setTyping(this.messageId)
      return
    }
    await this.#sendApi().sendAction({ to: this.userId, action: 'typing_on' })
  }

  /** Marca el mensaje entrante como leído. */
  async markRead(): Promise<void> {
    if (this.channel === 'whatsapp') {
      if (!this.messageId) return
      await this.#client.whatsapp(this.businessId).markAsRead(this.messageId)
      return
    }
    await this.#sendApi().sendAction({ to: this.userId, action: 'mark_seen' })
  }

  #sendApi() {
    return this.channel === 'instagram'
      ? this.#client.instagram(this.businessId)
      : this.#client.messenger(this.businessId)
  }
}

/** Mensaje entrante con el texto ya plano, para no ramificar en cada callback. */
export interface ChatMessage extends IncomingMessage {
  /** El texto si es un mensaje de texto; string vacío en cualquier otro caso. */
  text: string
}

export function toChatMessage(message: IncomingMessage): ChatMessage {
  return {
    ...message,
    text: message.content.type === 'text' ? message.content.text : '',
  }
}
