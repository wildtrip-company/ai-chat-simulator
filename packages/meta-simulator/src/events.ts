import type { ServerResponse } from 'node:http'

/** Evento que el simulador empuja al panel web. */
export type SimEvent =
  | { type: 'inbound'; id: string; from: string; text: string; at: number }
  | { type: 'outbound'; id: string; to: string; text: string; kind: string; at: number }
  | { type: 'status'; messageId: string; state: string; at: number }
  | { type: 'webhook'; ok: boolean; status: number; detail: string; at: number }

/**
 * Hub de Server-Sent Events para el panel.
 *
 * SSE y no WebSocket a propósito: el flujo es de una sola dirección (el panel
 * manda por HTTP normal), el navegador reconecta solo, y no agrega dependencias
 * ni un handshake que mantener.
 */
export class EventHub {
  readonly #clients = new Set<ServerResponse>()

  /** Registra una respuesta HTTP como suscriptor y la deja abierta. */
  subscribe(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // Sin esto, un proxy intermedio puede bufferear el stream entero.
      'X-Accel-Buffering': 'no',
    })
    res.write(': conectado\n\n')

    this.#clients.add(res)
    res.on('close', () => this.#clients.delete(res))
  }

  publish(event: SimEvent): void {
    const frame = `data: ${JSON.stringify(event)}\n\n`
    for (const client of this.#clients) {
      // Si el cliente se fue a mitad de escritura, lo sacamos y seguimos.
      try {
        client.write(frame)
      } catch {
        this.#clients.delete(client)
      }
    }
  }

  closeAll(): void {
    for (const client of this.#clients) client.end()
    this.#clients.clear()
  }

  get size(): number {
    return this.#clients.size
  }
}
