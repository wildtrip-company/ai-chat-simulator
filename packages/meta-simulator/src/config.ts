import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Channel } from '@wildtrip-company/meta-api'
import { DEFAULT_MODEL, type PersonaConfig } from './persona.js'

/**
 * Config resuelta del simulador: archivo → variables de entorno → flags del CLI,
 * cada capa pisando a la anterior.
 *
 * Nada de esto se configura desde el código de quien usa la librería. El
 * simulador es una herramienta de desarrollo aislada, y mantenerlo fuera del
 * código de la app garantiza que no pueda terminar en el build de producción.
 */
export interface ResolvedConfig {
  webhookUrl: string
  channel: Channel
  port: number
  businessId: string | undefined
  autoStatuses: boolean
  persona: PersonaConfig | undefined
}

/** Forma del archivo `meta-simulator.json`, si existe. */
interface FileConfig {
  webhookUrl?: string
  channel?: string
  port?: number
  businessId?: string
  autoStatuses?: boolean
  persona?: {
    model?: string
    prompt?: string
    maxTurns?: number
  }
}

export const DEFAULT_CONFIG_PATH = 'meta-simulator.json'
export const DEFAULT_WEBHOOK_URL = 'http://localhost:3000/webhook'
export const DEFAULT_PORT = 4000

const CHANNELS = new Set<Channel>(['whatsapp', 'messenger', 'instagram'])

export class ConfigError extends Error {}

/**
 * Carga un archivo `.env`.
 *
 * Usa `process.loadEnvFile` de Node en vez de dotenv: hace lo mismo, es nativo
 * desde Node 20.12, y ahorra una dependencia en una herramienta de desarrollo.
 */
export function loadEnvFile(path: string | undefined): void {
  const target = resolve(path ?? '.env')
  try {
    process.loadEnvFile(target)
  } catch (error) {
    // Que no exista un `.env` es normal; cualquier otro error sí importa.
    if (path !== undefined) {
      throw new ConfigError(`No se pudo leer ${target}: ${describe(error)}`)
    }
  }
}

async function readConfigFile(path: string | undefined): Promise<FileConfig> {
  const target = resolve(path ?? DEFAULT_CONFIG_PATH)
  let raw: string
  try {
    raw = await readFile(target, 'utf8')
  } catch {
    // Sin `--config` explícito, la ausencia del archivo es lo esperado.
    if (path !== undefined) throw new ConfigError(`No se encontró el archivo de config: ${target}`)
    return {}
  }

  try {
    return JSON.parse(raw) as FileConfig
  } catch (error) {
    throw new ConfigError(`El archivo de config no es JSON válido (${target}): ${describe(error)}`)
  }
}

/** Flags ya parseadas del CLI. */
export interface CliOverrides {
  webhook?: string | undefined
  channel?: string | undefined
  port?: string | undefined
  business?: string | undefined
  statuses?: boolean | undefined
  config?: string | undefined
  env?: string | undefined
}

export async function resolveConfig(overrides: CliOverrides): Promise<ResolvedConfig> {
  loadEnvFile(overrides.env)
  const file = await readConfigFile(overrides.config)

  const channel = overrides.channel ?? process.env['META_SIM_CHANNEL'] ?? file.channel ?? 'whatsapp'
  if (!CHANNELS.has(channel as Channel)) {
    throw new ConfigError(`Canal desconocido: "${channel}". Válidos: whatsapp, messenger, instagram.`)
  }

  const rawPort = overrides.port ?? process.env['META_SIM_PORT'] ?? file.port
  const port = rawPort === undefined ? DEFAULT_PORT : Number(rawPort)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError(`Puerto inválido: "${String(rawPort)}".`)
  }

  const businessId = overrides.business ?? process.env['META_SIM_BUSINESS_ID'] ?? file.businessId

  return {
    webhookUrl:
      overrides.webhook ??
      process.env['META_SIM_WEBHOOK_URL'] ??
      file.webhookUrl ??
      DEFAULT_WEBHOOK_URL,
    channel: channel as Channel,
    port,
    businessId,
    // `--no-statuses` sólo puede apagarlos, nunca encenderlos.
    autoStatuses: overrides.statuses === false ? false : (file.autoStatuses ?? true),
    persona: resolvePersona(file),
  }
}

/**
 * La persona existe sólo si hay `ANTHROPIC_API_KEY`.
 *
 * La clave nunca sale del entorno: no se acepta por flag del CLI (quedaría en
 * el historial del shell) ni por el archivo de config (se commitea).
 */
function resolvePersona(file: FileConfig): PersonaConfig | undefined {
  const apiKey = process.env['ANTHROPIC_API_KEY']
  if (!apiKey) return undefined

  const maxTurns = process.env['META_SIM_PERSONA_MAX_TURNS'] ?? file.persona?.maxTurns
  const prompt = process.env['META_SIM_PERSONA_PROMPT'] ?? file.persona?.prompt

  return {
    apiKey,
    model: process.env['META_SIM_PERSONA_MODEL'] ?? file.persona?.model ?? DEFAULT_MODEL,
    ...(prompt !== undefined && { prompt }),
    ...(maxTurns !== undefined && { maxTurns: Number(maxTurns) }),
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
