import { TextDecoder } from 'util'

export function toString(a: Uint8Array<ArrayBuffer>) {
  return new TextDecoder('utf8').decode(a)
}

export function createResponse(
  body: Uint8Array<ArrayBuffer> | string,
  status: number,
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        return headers[name] ?? null
      },
    },
    arrayBuffer: () => {
      if (typeof body === 'string') {
        const encoder = new TextEncoder()
        return Promise.resolve(encoder.encode(body).buffer)
      }
      return Promise.resolve(body.buffer)
    },
    text: () => {
      if (typeof body === 'string') {
        return Promise.resolve(body)
      }
      return Promise.resolve(toString(body))
    },
  }
}
