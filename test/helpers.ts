import fs from 'fs'
import { TextDecoder } from 'util'

import rangeParser from 'range-parser'
import { vi } from 'vitest'

import { BlobFile, LocalFile } from '../src/index.ts'

import type { Mock } from 'vitest'

export function toString(a: Uint8Array<ArrayBuffer>) {
  return new TextDecoder('utf8').decode(a)
}

/** The shared fixture, as each of the filehandle flavors that can hold it. */
export function testLocalFile(file = './data/test.txt') {
  return new LocalFile(require.resolve(file))
}

export function testBlobFile(file = './data/test.txt') {
  const contents = fs.readFileSync(require.resolve(file))
  return new BlobFile(new Blob([contents], { type: 'text/plain' }))
}

/** Maps the fake URLs the mock fetches use back onto test/data files. */
export function fileForUrl(url: string) {
  return testLocalFile(url.replace('http://fakehost/', './data/'))
}

// Return types below are named explicitly: the inferred ones reach into
// @vitest/spy's `Procedure`, which tsc cannot write down portably from here.

// mock fetch that resolves http://fakehost/* to local test/data files and
// honors range requests via the request's range header
export function rangeMockFetch(): Mock {
  return vi
    .fn()
    .mockImplementation(
      async (url: string, args: { headers: Record<string, string> }) => {
        const file = fileForUrl(url)
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

/** mock fetch that ignores range headers and serves the whole file with a 200 */
export function wholeFileMockFetch(): Mock {
  return vi.fn().mockImplementation(async (url: string) => {
    const content = await fileForUrl(url).readFile()
    return createResponse(content, 200)
  })
}

/** mock fetch that answers every request with the same canned response */
export function constantMockFetch(
  body: Uint8Array<ArrayBuffer> | string,
  status: number,
  headers: Record<string, string> = {},
): Mock {
  return vi.fn().mockImplementation(() => createResponse(body, status, headers))
}

/**
 * mock fetch that records the RequestInit it was handed, so tests can assert on
 * how the request was assembled rather than only on what came back.
 */
export function capturingMockFetch(
  respond: (url: string, init: RequestInit) => unknown,
): { fetch: Mock; inits: RequestInit[] } {
  const inits: RequestInit[] = []
  const fetch = vi.fn().mockImplementation((url: string, init: RequestInit) => {
    inits.push(init)
    return respond(url, init)
  })
  return { fetch, inits }
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
