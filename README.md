# ai-chat-simulator

Dos librerías para trabajar con la API de mensajería de Meta sin depender de Meta durante el desarrollo.

| Package | Se instala como | Para qué |
| --- | --- | --- |
| `@wildtrip-company/meta-api` | `dependency` | Cliente de WhatsApp Cloud, Messenger e Instagram + recepción de webhooks |
| `@wildtrip-company/meta-simulator` | `devDependency` | Servidor local que se hace pasar por Meta |

Ninguna de las dos guarda nada en disco. `meta-api` tampoco lee `process.env` — toda su configuración entra por parámetros. El simulador es al revés: **sólo** se configura por CLI y entorno, nunca desde tu código.

## La idea

Un flag decide contra qué habla el cliente. **Nada más en tu código cambia.**

```ts
import { MetaClient } from '@wildtrip-company/meta-api'

// Desarrollo: contra el simulador. No hay credenciales que configurar.
const meta = new MetaClient({ simulate: true })

// Producción: contra Meta.
const meta = new MetaClient({ accessToken, appSecret, verifyToken })
```

El simulador expone las mismas rutas Graph y devuelve las mismas formas de respuesta, así que el cliente no distingue contra qué está hablando.

## Uso

Todo sale del cliente: no hay adapters que importar por separado.

### Enviar

```ts
await meta.whatsapp(phoneNumberId).sendText({ to, body: 'Hola' })
await meta.messenger(pageId).sendText({ to, text: 'Hola' })
await meta.instagram(igUserId).sendText({ to, text: 'Hola' })
```

### Recibir

El webhook **se hostea solo**. Declarás la ruta y el puerto al crearlo y arranca: no hay que montar nada en Express, Hono ni Next.

```ts
const webhook = meta.webhook({
  path: '/webhook',
  port: 3000,
  onMessage: async (msg, chat) => {
    await chat.reply(`Dijiste: ${msg.text}`)
  },
  onStatus: (status) => console.log(status.state), // sent | delivered | read | failed
})

await webhook.listen()
console.log(webhook.url) // la URL que cargás en el panel de Meta
```

La ruta se declara acá y no al montarlo porque es parte de cómo Meta identifica este webhook — no algo que deba poder cambiarse desde afuera.

**`chat` es la conversación ya resuelta.** No repetís ids ni te enterás de qué producto vino el mensaje: hace lo correcto en los tres.

```ts
await chat.reply('Hola')
await chat.image('https://…', 'con epígrafe')
await chat.typing()
await chat.markRead()
```

Y para escribir sin esperar que te escriban:

```ts
await webhook.broadcast('Aviso para todos')
webhook.conversations // las vistas desde que arrancó
```

> `broadcast` alcanza a quien te haya escrito **en esta corrida**: es un caché en memoria, no una agenda. Meta no expone una lista de contactos, así que no hay forma de reconstruirla tras un reinicio.

Si ya tenés un servidor con otras rutas y no querés un segundo proceso, `webhook.fetch` es un handler de la Fetch API (`(Request) => Response`) que se monta en Hono o se exporta tal cual en Next.js. No es el camino principal.

### Desarrollar sin Meta

El simulador se arranca por CLI, no desde tu código:

```bash
npx meta-simulator
# → panel en http://localhost:4000

npx meta-simulator --webhook http://localhost:3000/hooks/meta --channel instagram
```

| Opción | Por defecto |
| --- | --- |
| `--webhook <url>` | `http://localhost:3000/webhook` |
| `--channel <name>` | `whatsapp` · `messenger` · `instagram` |
| `--port <n>` | `4000` |
| `--business <id>` | generado |
| `--no-statuses` | emite acuses |
| `--quiet` | con logs |

Con `new MetaClient({ simulate: true })` del otro lado, las credenciales de ambos coinciden solas: son constantes en duro (`DEV_APP_SECRET`, `DEV_VERIFY_TOKEN`) porque el simulador nunca corre en producción, y así no hay dos valores que puedan desincronizarse.

**El simulador no expone nada importable** — es sólo un binario. No hay forma de escribir `import … from '@wildtrip-company/meta-simulator'` en tu código, así que tampoco hay forma de que termine en tu build de producción.

El simulador **firma los webhooks de verdad**, con el mismo algoritmo que Meta, así tu validación de firma se ejercita en cada corrida local en vez de estrenarse el día que conectás producción.

### El panel

Abriendo `http://localhost:4000` tenés la conversación a la izquierda y el tráfico de webhooks a la derecha, en vivo por SSE. Podés escribir como el usuario y ver qué contesta tu app, con los acuses de entrega colgados de cada mensaje.

La correlación entre ambas columnas es el punto: cuando algo no anda, ves si el webhook salió, qué status devolvió tu app y en qué paso se cortó.

También emite los acuses de `sent`/`delivered`/`read` y expone endpoints de control (`POST /_sim/inbound`, `GET /_sim/state`, `POST /_sim/reset`) para manejarlo desde fuera del proceso.

### Que el usuario simulado responda con IA

Opcional y **sólo por entorno**. Sin esto, escribís los mensajes desde el panel.

```bash
# .env
ANTHROPIC_API_KEY=sk-ant-...
META_SIM_PERSONA_PROMPT="Sos un cliente apurado que quiere devolver un producto y está molesto."
META_SIM_PERSONA_MODEL=claude-sonnet-5   # por defecto
META_SIM_PERSONA_MAX_TURNS=10            # por defecto
```

La persona se activa sola si hay `ANTHROPIC_API_KEY`. La clave **sólo** se lee del entorno: no se acepta por flag (quedaría en el historial del shell) ni por el archivo de config (se commitea).

`ai` y `@ai-sdk/anthropic` son peer dependencies **opcionales** — se importan dinámicamente y sólo si configuraste una persona.

> `META_SIM_PERSONA_MAX_TURNS` no es decorativo. Sin tope, tu bot contesta, la persona contesta, y quedan hablando entre ellos gastando tokens indefinidamente.

### Archivo de config

Para lo que no es secreto, `meta-simulator.json` en la raíz:

```json
{
  "webhookUrl": "http://localhost:3000/webhook",
  "channel": "whatsapp",
  "port": 4000,
  "persona": { "prompt": "Sos un cliente…", "maxTurns": 10 }
}
```

Precedencia: **flags del CLI > variables de entorno > archivo de config**.

## Desarrollo

```bash
pnpm install
pnpm build      # meta-simulator importa meta-api por sus exports: buildeá antes de testear
pnpm test
pnpm typecheck
```

## Publicación

Los packages van a GitHub Packages. El workflow `release.yml` publica al pushear un tag `v*`.

El token **no** va en el `.npmrc` del repo — pnpm ignora credenciales ahí a propósito, porque el archivo se commitea. En local:

```bash
pnpm config set "//npm.pkg.github.com/:_authToken" <TU_TOKEN>
```
