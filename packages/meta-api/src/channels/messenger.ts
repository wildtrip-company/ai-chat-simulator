import type { SendResult } from '../types.js'
import { SendApiChannel } from './send-api.js'

/** Botón de un template genérico. */
export interface MessengerButton {
  type: 'postback' | 'web_url'
  title: string
  /** Requerido si `type` es `postback`. */
  payload?: string
  /** Requerido si `type` es `web_url`. */
  url?: string
}

/** Messenger para una página de Facebook. Se obtiene de `client.messenger(pageId)`. */
export class MessengerChannel extends SendApiChannel {
  /** Tarjeta con imagen, texto y hasta 3 botones. */
  async sendButtonTemplate(params: {
    to: string
    text: string
    buttons: MessengerButton[]
  }): Promise<SendResult> {
    return this.send({
      to: params.to,
      message: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: params.text,
            buttons: params.buttons,
          },
        },
      },
    })
  }

  /**
   * Mensaje fuera de la ventana estándar de respuesta. Requiere un tag válido
   * aprobado por Meta; usarlo para promociones hace que te suspendan la página.
   */
  async sendTagged(params: { to: string; text: string; tag: string }): Promise<SendResult> {
    return this.send({
      to: params.to,
      message: { text: params.text },
      messagingType: 'MESSAGE_TAG',
      tag: params.tag,
    })
  }
}
