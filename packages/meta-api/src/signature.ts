/**
 * Firma y verificación de webhooks (`X-Hub-Signature-256`).
 *
 * Usa WebCrypto en lugar de `node:crypto` para que el mismo código corra en
 * Node, Bun, Deno, Workers y edge runtimes sin adaptadores.
 */

const encoder = new TextEncoder()

async function hmacSha256(secret: string, payload: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return new Uint8Array(sig)
}

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

/**
 * Compara en tiempo constante. Un `===` filtra, vía tiempo de respuesta,
 * cuántos caracteres del prefijo acertó quien intenta falsificar la firma.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Produce el valor del header `X-Hub-Signature-256` para un cuerpo dado. */
export async function signPayload(appSecret: string, rawBody: string): Promise<string> {
  return `sha256=${toHex(await hmacSha256(appSecret, rawBody))}`
}

/**
 * Valida la firma de un webhook entrante.
 *
 * `rawBody` tiene que ser el cuerpo exacto tal como llegó. Si lo parseás a JSON
 * y lo volvés a serializar, el orden de claves y el espaciado cambian y la firma
 * deja de coincidir aunque el contenido sea el mismo.
 */
export async function verifySignature(params: {
  appSecret: string
  rawBody: string
  signatureHeader: string | undefined | null
}): Promise<boolean> {
  const { appSecret, rawBody, signatureHeader } = params
  if (!signatureHeader) return false
  const expected = await signPayload(appSecret, rawBody)
  return timingSafeEqual(expected, signatureHeader)
}
