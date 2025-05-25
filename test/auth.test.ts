import { TextDecoder } from 'util'

import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { RemoteFile } from '../src/'

function toString(a: Uint8Array<ArrayBuffer>) {
  return new TextDecoder('utf8').decode(a)
}

// Create a Response object from a buffer or string
function createResponse(
  body: Uint8Array<ArrayBuffer> | string,
  status: number,
  headers: Record<string, string> = {},
) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        return headers[name] || null
      },
    },
    arrayBuffer: async () => {
      if (typeof body === 'string') {
        const encoder = new TextEncoder()
        return encoder.encode(body).buffer
      }
      return body.buffer
    },
    text: async () => {
      if (typeof body === 'string') {
        return body
      }
      return toString(body)
    },
  }
}

// Mock implementation for fetch
let mockFetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>

beforeEach(() => {
  // Reset the mock fetch implementation before each test
  mockFetch = vi.fn().mockImplementation(async (url: string) => {
    throw new Error(`Unhandled fetch request to ${url}`)
  })
})

afterEach(() => {
  vi.resetAllMocks()
})

test('auth token', async () => {
  mockFetch = vi.fn().mockImplementation(async (_url: string, args: any) => {
    return args.headers.Authorization
      ? createResponse('hello world', 200)
      : createResponse('Unauthorized', 403)
  })

  const f = new RemoteFile('http://fakehost/test.txt', {
    fetch: mockFetch,
    overrides: {
      headers: {
        Authorization: 'Basic YWxhZGRpbjpvcGVuc2VzYW1l',
      },
    },
  })
  const stat = await f.readFile('utf8')
  expect(stat).toBe('hello world')
})

test('auth token with range request', async () => {
  mockFetch = vi.fn().mockImplementation(async (_url: string, args: any) => {
    if (args.headers.Authorization && args.headers.range) {
      return createResponse('hello', 206)
    } else if (!args.headers.Authorization) {
      return createResponse('Unauthorized', 403)
    } else if (!args.headers.Range) {
      return createResponse('Bad Request', 400)
    }
    return createResponse('Unknown error', 500)
  })

  const f = new RemoteFile('http://fakehost/test.txt', {
    fetch: mockFetch,
    overrides: {
      headers: {
        Authorization: 'Basic YWxhZGRpbjpvcGVuc2VzYW1l',
      },
    },
  })
  const buffer = await f.read(5, 0)
  expect(toString(buffer)).toBe('hello')
})
