export { MetaClient, type WebhookOptions } from './client.js'
export { MetaApiError, MetaConfigError, WebhookVerificationError } from './errors.js'
export { signPayload, verifySignature } from './signature.js'
export { DEV_APP_SECRET, DEV_SIMULATOR_URL, DEV_VERIFY_TOKEN } from './dev.js'

export { WhatsAppChannel, type TemplateComponent } from './channels/whatsapp.js'
export { MessengerChannel, type MessengerButton } from './channels/messenger.js'
export { InstagramChannel } from './channels/instagram.js'
export { SendApiChannel, type QuickReply } from './channels/send-api.js'

export { WebhookServer, type WebhookServerOptions } from './webhook/server.js'
export { Chat, toChatMessage, type ChatMessage, type ConversationKey } from './webhook/chat.js'
export {
  createWebhookHandler,
  type WebhookHandlerConfig,
  type WebhookRequest,
  type WebhookResponse,
} from './webhook/handler.js'
export {
  normalizeWebhook,
  type NormalizedBatch,
  type WebhookPayload,
} from './webhook/normalize.js'

export {
  DEFAULT_API_VERSION,
  GRAPH_URL,
  type Channel,
  type DeliveryState,
  type IncomingMessage,
  type MessageContent,
  type MetaClientConfig,
  type SendResult,
  type StatusUpdate,
} from './types.js'
