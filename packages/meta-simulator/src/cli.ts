import { parseArgs } from 'node:util'
import { ConfigError, resolveConfig } from './config.js'
import { MetaSimulator } from './simulator.js'

const HELP = `
  meta-simulator — servidor de desarrollo que finge ser la API de Meta

  Uso
    $ meta-simulator [opciones]

  Opciones
    --webhook <url>    Webhook de tu app.  (por defecto http://localhost:3000/webhook)
    --channel <name>   whatsapp | messenger | instagram   (por defecto whatsapp)
    --port <n>         Puerto del panel.   (por defecto 4000)
    --business <id>    Id de la cuenta simulada.
    --config <path>    Archivo de config.  (por defecto ./meta-simulator.json)
    --env <path>       Archivo de entorno. (por defecto ./.env)
    --no-statuses      No emitir acuses de sent/delivered/read.
    --quiet            Sin logs.
    --help             Esto.

  Variables de entorno
    ANTHROPIC_API_KEY            Activa la persona de IA. Sin esto, respondés a mano.
    META_SIM_PERSONA_MODEL       Por defecto claude-sonnet-5.
    META_SIM_PERSONA_PROMPT      Quién es el usuario simulado.
    META_SIM_PERSONA_MAX_TURNS   Tope de respuestas de la persona. Por defecto 10.
    META_SIM_WEBHOOK_URL · META_SIM_CHANNEL · META_SIM_PORT · META_SIM_BUSINESS_ID

  Precedencia: flags del CLI > variables de entorno > archivo de config.

  Ejemplo
    $ meta-simulator --webhook http://localhost:3000/hooks/meta --channel instagram
`

export async function run(argv: string[] = process.argv.slice(2)): Promise<void> {
  let values: Record<string, string | boolean | undefined>
  try {
    ;({ values } = parseArgs({
      args: argv,
      options: {
        webhook: { type: 'string' },
        channel: { type: 'string' },
        port: { type: 'string' },
        business: { type: 'string' },
        config: { type: 'string' },
        env: { type: 'string' },
        statuses: { type: 'boolean', default: true },
        quiet: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    }))
  } catch (error) {
    // parseArgs lanza con banderas desconocidas; el mensaje solo no orienta.
    return fail(error instanceof Error ? error.message : String(error))
  }

  if (values['help']) {
    console.log(HELP)
    return
  }

  let config
  try {
    config = await resolveConfig({
      webhook: values['webhook'] as string | undefined,
      channel: values['channel'] as string | undefined,
      port: values['port'] as string | undefined,
      business: values['business'] as string | undefined,
      statuses: values['statuses'] as boolean | undefined,
      config: values['config'] as string | undefined,
      env: values['env'] as string | undefined,
    })
  } catch (error) {
    if (error instanceof ConfigError) return fail(error.message)
    throw error
  }

  const quiet = values['quiet'] === true
  const simulator = new MetaSimulator({
    webhookUrl: config.webhookUrl,
    channel: config.channel,
    port: config.port,
    autoStatuses: config.autoStatuses,
    ...(config.businessId !== undefined && { businessId: config.businessId }),
    ...(config.persona !== undefined && { persona: config.persona }),
    ...(quiet && { logger: () => {} }),
  })

  await simulator.start()
  if (!quiet) {
    console.log(
      config.persona
        ? `[meta-simulator] persona de IA activa (${config.persona.model})`
        : '[meta-simulator] sin persona: respondé desde el panel',
    )
  }

  // Ctrl-C tiene que cerrar el servidor, no dejar el puerto tomado por un
  // proceso zombi hasta que el SO lo libere.
  const shutdown = () => {
    void simulator.stop().then(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

function fail(message: string): void {
  console.error(`meta-simulator: ${message}`)
  console.error('Probá `meta-simulator --help`.')
  process.exitCode = 1
}
