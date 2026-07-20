import type { Channel, DeliveryState, MessageContent } from '@wildtrip-company/meta-api'

/**
 * Construcción de payloads con la forma exacta que manda Meta.
 *
 * Esto es el corazón de la fidelidad del simulador: si acá inventamos una forma
 * distinta a la real, tu código pasa los tests en local y falla en producción.
 * Cada función replica la estructura documentada del webhook de su producto.
 */

export interface InboundOptions {
  channel: Channel
  /** phone_number_id en WhatsApp, page id en Messenger, ig user id en Instagram. */
  businessId: string
  /** Quién manda el mensaje (el usuario simulado). */
  from: string
  messageId: string
  timestamp: Date
  content: MessageContent
  /** Nombre de perfil, sólo lo usa WhatsApp. */
  profileName?: string
}

export function buildInboundPayload(options: InboundOptions): unknown {
  return options.channel === 'whatsapp' ? whatsAppInbound(options) : sendApiInbound(options)
}

function whatsAppInbound(o: InboundOptions): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: o.businessId,
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: o.businessId,
                phone_number_id: o.businessId,
              },
              contacts: [
                { profile: { name: o.profileName ?? 'Usuario Simulado' }, wa_id: o.from },
              ],
              messages: [
                {
                  from: o.from,
                  id: o.messageId,
                  // WhatsApp usa epoch en segundos, como string.
                  timestamp: String(Math.floor(o.timestamp.getTime() / 1000)),
                  ...whatsAppContent(o.content),
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

function whatsAppContent(content: MessageContent): Record<string, unknown> {
  switch (content.type) {
    case 'text':
      return { type: 'text', text: { body: content.text } }
    case 'image':
      return {
        type: 'image',
        image: { id: content.mediaId, ...(content.caption && { caption: content.caption }) },
      }
    case 'audio':
      return { type: 'audio', audio: { id: content.mediaId } }
    case 'video':
      return {
        type: 'video',
        video: { id: content.mediaId, ...(content.caption && { caption: content.caption }) },
      }
    case 'document':
      return {
        type: 'document',
        document: { id: content.mediaId, ...(content.filename && { filename: content.filename }) },
      }
    case 'location':
      return {
        type: 'location',
        location: {
          latitude: content.latitude,
          longitude: content.longitude,
          ...(content.name && { name: content.name }),
        },
      }
    case 'reaction':
      return {
        type: 'reaction',
        reaction: { emoji: content.emoji, message_id: content.targetMessageId },
      }
    case 'postback':
      // En WhatsApp un "postback" llega como respuesta interactiva.
      return {
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: content.payload, title: content.title ?? content.payload },
        },
      }
    default:
      return { type: 'unknown' }
  }
}

function sendApiInbound(o: InboundOptions): unknown {
  const base = {
    sender: { id: o.from },
    recipient: { id: o.businessId },
    // La Send API usa epoch en milisegundos, como número.
    timestamp: o.timestamp.getTime(),
  }

  const event =
    o.content.type === 'postback'
      ? {
          ...base,
          postback: { payload: o.content.payload, title: o.content.title ?? o.content.payload },
        }
      : { ...base, message: { mid: o.messageId, ...sendApiContent(o.content) } }

  return {
    object: o.channel === 'instagram' ? 'instagram' : 'page',
    entry: [{ id: o.businessId, time: o.timestamp.getTime(), messaging: [event] }],
  }
}

function sendApiContent(content: MessageContent): Record<string, unknown> {
  switch (content.type) {
    case 'text':
      return { text: content.text }
    case 'image':
    case 'audio':
    case 'video':
      return { attachments: [{ type: content.type, payload: { url: content.mediaId } }] }
    case 'document':
      return { attachments: [{ type: 'file', payload: { url: content.mediaId } }] }
    case 'location':
      return {
        attachments: [
          {
            type: 'location',
            payload: { coordinates: { lat: content.latitude, long: content.longitude } },
          },
        ],
      }
    case 'reaction':
      return { reaction: { emoji: content.emoji, mid: content.targetMessageId } }
    default:
      return { text: '' }
  }
}

/** Acuse de entrega/lectura de un mensaje que envió tu app. */
export function buildStatusPayload(options: {
  channel: Channel
  businessId: string
  messageId: string
  recipientId: string
  state: DeliveryState
  timestamp: Date
}): unknown {
  const { channel, businessId, messageId, recipientId, state, timestamp } = options

  if (channel === 'whatsapp') {
    return {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: businessId,
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: businessId, phone_number_id: businessId },
                statuses: [
                  {
                    id: messageId,
                    status: state,
                    timestamp: String(Math.floor(timestamp.getTime() / 1000)),
                    recipient_id: recipientId,
                  },
                ],
              },
            },
          ],
        },
      ],
    }
  }

  // Messenger e Instagram: `delivery` lleva mids, `read` sólo un watermark.
  const inner =
    state === 'read'
      ? { read: { watermark: timestamp.getTime() } }
      : { delivery: { mids: [messageId], watermark: timestamp.getTime() } }

  return {
    object: channel === 'instagram' ? 'instagram' : 'page',
    entry: [
      {
        id: businessId,
        time: timestamp.getTime(),
        messaging: [
          {
            sender: { id: recipientId },
            recipient: { id: businessId },
            timestamp: timestamp.getTime(),
            ...inner,
          },
        ],
      },
    ],
  }
}
