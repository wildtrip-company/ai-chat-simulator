import type { SendResult } from '../types.js'
import { SendApiChannel } from './send-api.js'

/**
 * Instagram Messaging para una cuenta profesional.
 * Se obtiene de `client.instagram(igUserId)`.
 *
 * Comparte la Send API con Messenger pero soporta menos: no hay templates de
 * botones ni message tags, y las quick replies están limitadas a 13.
 */
export class InstagramChannel extends SendApiChannel {
  /** Reacciona con un emoji a un mensaje del usuario. */
  async react(params: { to: string; messageId: string; emoji: string }): Promise<void> {
    await this.client.request(`${this.nodeId}/messages`, {
      body: {
        recipient: { id: params.to },
        sender_action: 'react',
        payload: { message_id: params.messageId, reaction: params.emoji },
      },
    })
  }

  /** Responde a una historia en la que te mencionaron o que te contestaron. */
  async replyToStory(params: { to: string; text: string }): Promise<SendResult> {
    return this.send({ to: params.to, message: { text: params.text } })
  }
}
