/**
 * Usuario simulado con IA, sobre el AI SDK de Vercel (v7).
 *
 * Toda la configuración entra por variables de entorno o por el archivo de
 * config del CLI — nunca desde el código de quien usa la librería. El simulador
 * es una herramienta de desarrollo aislada: nada de esto existe en producción.
 */

export interface PersonaTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface PersonaConfig {
  /** Clave de la API de Anthropic. Sale de `ANTHROPIC_API_KEY`. */
  apiKey: string
  /** Id del modelo. Por defecto `claude-sonnet-5`. */
  model?: string
  /** Quién es este usuario. Cuanto más concreto, menos robótico responde. */
  prompt?: string
  /**
   * Tope de mensajes que la persona genera por conversación. Por defecto 10.
   *
   * No es opcional en la práctica: sin tope, tu bot contesta, la persona
   * contesta, y quedan hablando entre ellos gastando tokens para siempre.
   */
  maxTurns?: number
}

export interface Persona {
  reply(context: { history: PersonaTurn[]; lastBotMessage: string }): Promise<string | null>
}

/** Cambialo con `META_SIM_PERSONA_MODEL` si querés otro. */
export const DEFAULT_MODEL = 'claude-sonnet-5'

const DEFAULT_PROMPT = `Sos una persona real escribiéndole a un negocio por chat.
Escribís como se escribe en un celular: mensajes cortos, informales, a veces con
errores de tipeo o sin puntuación. No sos un asistente y no ofrecés ayuda: tenés
tu propio objetivo y lo perseguís. Nunca digas que sos una IA. Respondé sólo con
el texto del mensaje, sin comillas ni explicaciones.`

/** Formas mínimas de los paquetes del AI SDK, para no depender de sus tipos. */
interface AiModule {
  generateText(options: {
    model: unknown
    system?: string
    messages: { role: 'user' | 'assistant'; content: string }[]
  }): Promise<{ text: string }>
}

interface AnthropicModule {
  createAnthropic(options: { apiKey: string }): (modelId: string) => unknown
}

const MISSING_DEPS =
  'Configuraste una persona de IA pero faltan sus paquetes. Instalalos con: ' +
  'pnpm add -D ai @ai-sdk/anthropic'

export function createPersona(config: PersonaConfig): Persona {
  const maxTurns = config.maxTurns ?? 10
  let turnsUsed = 0

  return {
    async reply({ history, lastBotMessage }) {
      if (turnsUsed >= maxTurns) return null

      // Import dinámico: `ai` y `@ai-sdk/anthropic` son peer dependencies
      // opcionales, así que sin persona configurada no hacen falta.
      let ai: AiModule
      let anthropic: AnthropicModule
      try {
        ;[ai, anthropic] = (await Promise.all([
          import('ai'),
          import('@ai-sdk/anthropic'),
        ])) as unknown as [AiModule, AnthropicModule]
      } catch {
        throw new Error(MISSING_DEPS)
      }

      const model = anthropic.createAnthropic({ apiKey: config.apiKey })(
        config.model ?? DEFAULT_MODEL,
      )

      // Desde la óptica del modelo los papeles se invierten: él es el usuario
      // del chat, así que lo que escribió el bot le llega como `user`.
      const messages = history.map((turn) => ({
        role: (turn.role === 'user' ? 'assistant' : 'user') as 'user' | 'assistant',
        content: turn.text,
      }))

      const last = messages.at(-1)
      if (!last || last.role !== 'user' || last.content !== lastBotMessage) {
        messages.push({ role: 'user', content: lastBotMessage })
      }

      // Sin `temperature`: los modelos actuales la rechazan con un 400, y para
      // variar el tono alcanza con el prompt de la persona.
      const result = await ai.generateText({
        model,
        system: config.prompt ?? DEFAULT_PROMPT,
        messages,
      })

      turnsUsed += 1
      const text = result.text.trim()
      return text.length > 0 ? text : null
    },
  }
}
