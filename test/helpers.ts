import { TextDecoder } from 'util'

import rangeParser from 'range-parser'
import { vi } from 'vitest'

import { LocalFile } from '../src/index.ts'

export function toString(a: Uint8Array<ArrayBuffer>) {
  return new TextDecoder('utf8').decode(a)
}

// mock fetch that resolves http://fakehost/* to local test/data files and
// honors range requests via the request's range header
export function rangeMockFetch() {
  return vi
    .fn()
    .mockImplementation(
      async (url: string, args: { headers: Record<string, string> }) => {
        const file = new LocalFile(
          require.resolve(url.replace('http://fakehost/', './data/')),
        )
        const range = rangeParser(10000, args.headers.range ?? '')
        if (!Array.isArray(range)) {
          throw new Error('unexpected invalid range')
        }
        const first = range[0]
        if (!first) {
          throw new Error('unexpected empty range')
        }
        const { start, end } = first
        const buf = await file.read(end - start + 1, start)
        const stat = await file.stat()
        return createResponse(buf, 206, {
          'content-range': `${start}-${end}/${stat.size}`,
        })
      },
    )
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
