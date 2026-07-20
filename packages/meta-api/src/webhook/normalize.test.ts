import { describe, expect, it } from 'vitest'
import { normalizeWebhook } from './normalize.js'
import { signPayload, verifySignature } from '../signature.js'

describe('firma', () => {
  it('valida una firma que produjo signPayload', async () => {
    const body = JSON.stringify({ object: 'page', entry: [] })
    const signature = await signPayload('secreto', body)

    await expect(
      verifySignature({ appSecret: 'secreto', rawBody: body, signatureHeader: signature }),
    ).resolves.toBe(true)
  })

  it('rechaza si el cuerpo cambió aunque sea un carácter', async () => {
    const signature = await signPayload('secreto', '{"a":1}')

    await expect(
      verifySignature({ appSecret: 'secreto', rawBody: '{"a":2}', signatureHeader: signature }),
    ).resolves.toBe(false)
  })

  it('rechaza si falta el header', async () => {
    await expect(
      verifySignature({ appSecret: 'secreto', rawBody: '{}', signatureHeader: undefined }),
    ).resolves.toBe(false)
  })
})

describe('normalizeWebhook / whatsapp', () => {
  it('extrae un mensaje de texto', () => {
    const { messages } = normalizeWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'WABA',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '555000' },
                messages: [
                  {
                    from: '5491100000000',
                    id: 'wamid.ABC',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'hola' },
                  },
                ],
              },
            },
          ],
        },
      ],
    })

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      channel: 'whatsapp',
      from: '5491100000000',
      to: '555000',
      content: { type: 'text', text: 'hola' },
    })
    // El epoch de WhatsApp viene en segundos: si lo tratáramos como ms,
    // la fecha caería en 1970.
    expect(messages[0]?.timestamp.getUTCFullYear()).toBe(2023)
  })

  it('trata las respuestas interactivas como postback', () => {
    const { messages } = normalizeWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '555000' },
                messages: [
                  {
                    from: '549110',
                    id: 'wamid.X',
                    timestamp: '1700000000',
                    type: 'interactive',
                    interactive: { type: 'button_reply', button_reply: { id: 'SI', title: 'Sí' } },
                  },
                ],
              },
            },
          ],
        },
      ],
    })

    expect(messages[0]?.content).toEqual({ type: 'postback', payload: 'SI', title: 'Sí' })
  })

  it('junta mensajes de varias entries en un solo POST', () => {
    const entry = (id: string) => ({
      changes: [
        {
          value: {
            metadata: { phone_number_id: '555000' },
            messages: [
              { from: '1', id, timestamp: '1700000000', type: 'text', text: { body: id } },
            ],
          },
        },
      ],
    })

    const { messages } = normalizeWebhook({
      object: 'whatsapp_business_account',
      entry: [entry('a'), entry('b')],
    })

    expect(messages.map((m) => m.messageId)).toEqual(['a', 'b'])
  })

  it('lee los acuses de entrega', () => {
    const { statuses } = normalizeWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '555000' },
                statuses: [
                  {
                    id: 'wamid.ABC',
                    status: 'delivered',
                    timestamp: '1700000000',
                    recipient_id: '549110',
                  },
                ],
              },
            },
          ],
        },
      ],
    })

    expect(statuses[0]).toMatchObject({ state: 'delivered', messageId: 'wamid.ABC' })
  })
})

describe('normalizeWebhook / messenger', () => {
  it('extrae texto y quick replies', () => {
    const { messages } = normalizeWebhook({
      object: 'page',
      entry: [
        {
          id: 'PAGE',
          messaging: [
            {
              sender: { id: 'USER' },
              recipient: { id: 'PAGE' },
              timestamp: 1700000000000,
              message: { mid: 'm.1', text: 'Sí quiero', quick_reply: { payload: 'CONFIRMAR' } },
            },
          ],
        },
      ],
    })

    expect(messages[0]).toMatchObject({
      channel: 'messenger',
      from: 'USER',
      to: 'PAGE',
      content: { type: 'postback', payload: 'CONFIRMAR', title: 'Sí quiero' },
    })
  })

  it('descarta los echoes para que el bot no se responda a sí mismo', () => {
    const { messages } = normalizeWebhook({
      object: 'page',
      entry: [
        {
          id: 'PAGE',
          messaging: [
            {
              sender: { id: 'PAGE' },
              recipient: { id: 'USER' },
              timestamp: 1700000000000,
              message: { mid: 'm.echo', text: 'mensaje del bot', is_echo: true },
            },
          ],
        },
      ],
    })

    expect(messages).toHaveLength(0)
  })

  it('marca instagram según el object', () => {
    const { messages } = normalizeWebhook({
      object: 'instagram',
      entry: [
        {
          id: 'IG',
          messaging: [
            {
              sender: { id: 'U' },
              recipient: { id: 'IG' },
              timestamp: 1700000000000,
              message: { mid: 'm.1', text: 'hola' },
            },
          ],
        },
      ],
    })

    expect(messages[0]?.channel).toBe('instagram')
  })
})
