import { readFile } from 'node:fs/promises'
import { extname, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ServerResponse } from 'node:http'

/**
 * Sirve el panel web ya compilado por Vite.
 *
 * `import.meta.url` apunta a `dist/static.js` una vez construido, así que el
 * panel queda en `dist/ui/` al lado. Resolverlo así y no desde `process.cwd()`
 * hace que funcione igual instalado en `node_modules` de otro proyecto.
 */
const UI_ROOT = fileURLToPath(new URL('./ui/', import.meta.url))

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
}

const MISSING_UI =
  'El panel web no está compilado. Corré `pnpm build` en @wildtrip-company/meta-simulator ' +
  '(o `pnpm --filter @wildtrip-company/meta-simulator build:ui`).'

/**
 * Devuelve `true` si atendió la request.
 *
 * Cualquier ruta que no sea un archivo cae en `index.html`, para que el panel
 * pueda usar rutas del lado del cliente sin romperse al recargar.
 */
export async function serveUi(pathname: string, res: ServerResponse): Promise<boolean> {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')

  // `normalize` resuelve los `..`; si sigue habiendo uno, el pedido intentaba
  // salir del directorio del panel y no lo servimos.
  const safe = normalize(relative)
  if (safe.startsWith('..') || safe.startsWith(sep)) {
    res.writeHead(403).end('Forbidden')
    return true
  }

  const file = await tryRead(UI_ROOT + safe)
  if (file) {
    res.writeHead(200, { 'Content-Type': MIME[extname(safe)] ?? 'application/octet-stream' })
    res.end(file)
    return true
  }

  // Fallback a index.html sólo para navegaciones, no para assets faltantes:
  // devolver HTML donde se esperaba un .js produce errores desconcertantes.
  if (extname(safe)) return false

  const index = await tryRead(UI_ROOT + 'index.html')
  if (!index) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }).end(MISSING_UI)
    return true
  }

  res.writeHead(200, { 'Content-Type': MIME['.html']! })
  res.end(index)
  return true
}

async function tryRead(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path)
  } catch {
    return undefined
  }
}
