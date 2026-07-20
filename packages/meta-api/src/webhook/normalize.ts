import type { Channel, DeliveryState, IncomingMessage, MessageContent, StatusUpdate } from '../types.js'

/** Lo que Meta manda en el body del webhook, en su forma cruda. */
export interface WebhookPayload {
  object?: string
  entry?: WebhookEntry[]
}

interface WebhookEntry {
  id?: string
  time?: number
  /** WhatsApp mete todo acá. */
  changes?: { field?: string; value?: Record<string, unknown> }[]
  /** Messenger e Instagram usan este otro carril. */
  messaging?: Record<string, unknown>[]
}

export interface NormalizedBatch {
  messages: IncomingMessage[]
  statuses: StatusUpdate[]
}

/**
 * Aplana el payload de Meta a eventos planos.
 *
 * Un solo POST puede traer varias entries, cada una con varios mensajes, así que
 * esto siempre devuelve arrays: tratar sólo `entry[0].changes[0]` es el bug
 * clásico que hace perder mensajes bajo carga.
 */
export function normalizeWebhook(payload: WebhookPayload): NormalizedBatch {
  const messages: IncomingMessage[] = []
  const statuses: StatusUpdate[] = []

  const channel = channelFromObject(payload.object)

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      collectWhatsApp(change.value ?? {}, messages, statuses)
    }
    for (const event of entry.messaging ?? []) {
      collectSendApi(event, entry.id ?? '', channel === 'whatsapp' ? 'messenger' : channel, messages, statuses)
    }
  }

  return { messages, statuses }
}

function channelFromObject(object: string | undefined): Channel {
  if (object === 'whatsapp_business_account') return 'whatsapp'
  if (object === 'instagram') return 'instagram'
  return 'messenger'
}

// --- WhatsApp -------------------------------------------------------------

function collectWhatsApp(
  value: Record<string, unknown>,
  messages: IncomingMessage[],
  statuses: StatusUpdate[],
): void {
  const metadata = value['metadata'] as { phone_number_id?: string } | undefined
  const businessId = metadata?.phone_number_id ?? ''

  for (const raw of asArray(value['messages'])) {
    const msg = raw as Record<string, unknown>
    messages.push({
      channel: 'whatsapp',
      messageId: str(msg['id']),
      from: str(msg['from']),
      to: businessId,
      timestamp: fromSeconds(msg['timestamp']),
      content: whatsAppContent(msg),
      raw: msg,
    })
  }

  for (const raw of asArray(value['statuses'])) {
    const st = raw as Record<string, unknown>
    const errors = asArray(st['errors'])[0] as { code?: number; title?: string } | undefined
    statuses.push({
      channel: 'whatsapp',
      messageId: str(st['id']),
      recipientId: str(st['recipient_id']),
      state: deliveryState(str(st['status'])),
      timestamp: fromSeconds(st['timestamp']),
      ...(errors && { error: { code: errors.code ?? 0, title: errors.title ?? 'unknown' } }),
      raw: st,
    })
  }
}

function whatsAppContent(msg: Record<string, unknown>): MessageContent {
  const type = str(msg['type'])

  switch (type) {
    case 'text':
      return { type: 'text', text: str((msg['text'] as { body?: string } | undefined)?.body) }

    case 'image':
    case 'video': {
      const media = msg[type] as { id?: string; caption?: string } | undefined
      return {
        type,
        mediaId: str(media?.id),
        ...(media?.caption !== undefined && { caption: media.caption }),
      }
    }

    case 'audio':
      return { type: 'audio', mediaId: str((msg['audio'] as { id?: string } | undefined)?.id) }

    case 'document': {
      const doc = msg['document'] as { id?: string; filename?: string } | undefined
      return {
        type: 'document',
        mediaId: str(doc?.id),
        ...(doc?.filename !== undefined && { filename: doc.filename }),
      }
    }

    case 'location': {
      const loc = msg['location'] as { latitude?: number; longitude?: number; name?: string } | undefined
      return {
        type: 'location',
        latitude: loc?.latitude ?? 0,
        longitude: loc?.longitude ?? 0,
        ...(loc?.name !== undefined && { name: loc.name }),
      }
    }

    case 'reaction': {
      const re = msg['reaction'] as { emoji?: string; message_id?: string } | undefined
      return { type: 'reaction', emoji: str(re?.emoji), targetMessageId: str(re?.message_id) }
    }

    case 'button': {
      // Respuesta a un botón de plantilla: la tratamos como postback.
      const btn = msg['button'] as { payload?: string; text?: string } | undefined
      return {
        type: 'postback',
        payload: str(btn?.payload),
        ...(btn?.text !== undefined && { title: btn.text }),
      }
    }

    case 'interactive': {
      // Botones y listas interactivas comparten forma con los postbacks.
      const inter = msg['interactive'] as Record<string, unknown> | undefined
      const reply = (inter?.['button_reply'] ?? inter?.['list_reply']) as
        | { id?: string; title?: string }
        | undefined
      return {
        type: 'postback',
        payload: str(reply?.id),
        ...(reply?.title !== undefined && { title: reply.title }),
      }
    }

    default:
      return { type: 'unsupported', kind: type || 'unknown' }
  }
}

// --- Messenger / Instagram ------------------------------------------------

function collectSendApi(
  event: Record<string, unknown>,
  businessId: string,
  channel: Channel,
  messages: IncomingMessage[],
  statuses: StatusUpdate[],
): void {
  const from = str((event['sender'] as { id?: string } | undefined)?.id)
  const to = str((event['recipient'] as { id?: string } | undefined)?.id) || businessId
  const timestamp = fromMillis(event['timestamp'])

  const message = event['message'] as Record<string, unknown> | undefined
  if (message) {
    // Los echoes son mensajes que enviaste vos; reinyectarlos al bot lo hace
    // responderse a sí mismo, así que los descartamos.
    if (message['is_echo'] !== true) {
      messages.push({
        channel,
        messageId: str(message['mid']),
        from,
        to,
        timestamp,
        content: sendApiContent(message),
        raw: event,
      })
    }
  }

  const postback = event['postback'] as { payload?: string; title?: string } | undefined
  if (postback) {
    messages.push({
      channel,
      messageId: str(event['mid']) || `postback:${timestamp.getTime()}`,
      from,
      to,
      timestamp,
      content: {
        type: 'postback',
        payload: str(postback.payload),
        ...(postback.title !== undefined && { title: postback.title }),
      },
      raw: event,
    })
  }

  const delivery = event['delivery'] as { mids?: string[] } | undefined
  for (const mid of delivery?.mids ?? []) {
    statuses.push({ channel, messageId: mid, recipientId: from, state: 'delivered', timestamp, raw: event })
  }

  if (event['read']) {
    // Messenger marca leído por watermark, no por mensaje: no hay message id.
    statuses.push({ channel, messageId: '', recipientId: from, state: 'read', timestamp, raw: event })
  }
}

function sendApiContent(message: Record<string, unknown>): MessageContent {
  const quickReply = message['quick_reply'] as { payload?: string } | undefined
  if (quickReply) {
    return {
      type: 'postback',
      payload: str(quickReply.payload),
      ...(typeof message['text'] === 'string' && { title: message['text'] }),
    }
  }

  const reaction = message['reaction'] as { emoji?: string; mid?: string } | undefined
  if (reaction) {
    return { type: 'reaction', emoji: str(reaction.emoji), targetMessageId: str(reaction.mid) }
  }

  const attachment = asArray(message['attachments'])[0] as
    | { type?: string; payload?: { url?: string; coordinates?: { lat?: number; long?: number } } }
    | undefined

  if (attachment) {
    const url = str(attachment.payload?.url)
    switch (attachment.type) {
      case 'image':
        return { type: 'image', mediaId: url }
      case 'audio':
        return { type: 'audio', mediaId: url }
      case 'video':
        return { type: 'video', mediaId: url }
      case 'file':
        return { type: 'document', mediaId: url }
      case 'location': {
        const c = attachment.payload?.coordinates
        return { type: 'location', latitude: c?.lat ?? 0, longitude: c?.long ?? 0 }
      }
      default:
        return { type: 'unsupported', kind: attachment.type ?? 'attachment' }
    }
  }

  if (typeof message['text'] === 'string') return { type: 'text', text: message['text'] }
  return { type: 'unsupported', kind: 'empty' }
}

// --- helpers --------------------------------------------------------------

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function deliveryState(status: string): DeliveryState {
  switch (status) {
    case 'sent':
    case 'delivered':
    case 'read':
    case 'failed':
      return status
    default:
      return 'sent'
  }
}

/** WhatsApp manda epoch en segundos, como string. */
function fromSeconds(value: unknown): Date {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date()
}

/** La Send API manda epoch en milisegundos, como número. */
function fromMillis(value: unknown): Date {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? new Date(n) : new Date()
}
