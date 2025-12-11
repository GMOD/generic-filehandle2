import { TextDecoder } from 'util'

import rangeParser from 'range-parser'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { LocalFile, RemoteFile } from '../src/index.ts'

function toString(a: Uint8Array<ArrayBuffer>) {
  return new TextDecoder('utf8').decode(a)
}

const getFile = (url: string) =>
  new LocalFile(require.resolve(url.replace('http://fakehost/', './data/')))

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

test('reads file', async () => {
  mockFetch = vi.fn().mockImplementation(async (url: string) => {
    const file = getFile(url)
    const content = await file.readFile()
    return createResponse(content, 200)
  })

  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const b = await f.readFile()
  expect(toString(b)).toEqual('testing\n')
})

test('reads file with response buffer method disabled', async () => {
  mockFetch = vi.fn().mockImplementation(async (url: string) => {
    const file = getFile(url)
    const content = await file.readFile()
    const response = createResponse(content, 200)

    // Simulate a response without buffer method
    return response
  })

  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const b = await f.readFile()
  expect(toString(b)).toEqual('testing\n')
})

test('reads file with encoding', async () => {
  mockFetch = vi.fn().mockImplementation(async (url: string) => {
    const file = getFile(url)
    const content = await file.readFile()
    return createResponse(content, 200)
  })

  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const fileText = await f.readFile('utf8')
  expect(fileText).toEqual('testing\n')
  const fileText2 = await f.readFile({ encoding: 'utf8' })
  expect(fileText2).toEqual('testing\n')

  // @ts-expect-error
  await expect(f.readFile('fakeEncoding')).rejects.toThrow(
    /unsupported encoding/,
  )
})

test('reads remote partially', async () => {
  mockFetch = vi.fn().mockImplementation(async (url: string, args: any) => {
    const file = getFile(url)
    const range = rangeParser(10000, args.headers.range)
    const { start, end } = range[0]
    const len = end - start + 1
    const buf = await file.read(len, start)
    const stat = await file.stat()

    return createResponse(buf, 206, {
      'content-range': `${start}-${end}/${stat.size}`,
    })
  })

  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const buf = await f.read(3, 0)
  expect(toString(buf)).toEqual('tes')
})

test('reads remote clipped at the end', async () => {
  mockFetch = vi.fn().mockImplementation(async (url: string, args: any) => {
    const file = getFile(url)
    const range = rangeParser(10000, args.headers.range)
    const { start, end } = range[0]
    const len = end - start + 1
    const buf = await file.read(len, start)
    const stat = await file.stat()

    return createResponse(buf, 206, {
      'content-range': `${start}-${end}/${stat.size}`,
    })
  })

  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const buf = await f.read(3, 6)
  expect(toString(buf).replace('\0', '')).toEqual('g\n')
})

test('throws error', async () => {
  mockFetch = vi.fn().mockImplementation(async () => {
    return createResponse('', 500)
  })

  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const res = f.read(0, 0)
  await expect(res).rejects.toThrow(/HTTP 500/)
})

test('throws error if file missing', async () => {
  mockFetch = vi.fn().mockImplementation(async () => {
    return createResponse('Not Found', 404)
  })

  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const res = f.read(0, 0)
  await expect(res).rejects.toThrow(/HTTP 404/)
})

test('zero read', async () => {
  mockFetch = vi.fn().mockImplementation(async (url: string, args: any) => {
    const file = getFile(url)
    const range = rangeParser(10000, args.headers.range)
    const { start, end } = range[0]
    const len = end - start + 1
    const buf = await file.read(len, start)
    const stat = await file.stat()

    return createResponse(buf, 206, {
      'content-range': `${start}-${end}/${stat.size}`,
    })
  })

  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const buf = toString(await f.read(0, 0))
  expect(buf).toBe('')
})

test('stat', async () => {
  mockFetch = vi.fn().mockImplementation(async (url: string, args: any) => {
    const file = getFile(url)
    const range = rangeParser(10000, args.headers.range)
    const { start, end } = range[0]
    const len = end - start + 1
    const buf = await file.read(len, start)
    const stat = await file.stat()

    return createResponse(buf, 206, {
      'content-range': `${start}-${end}/${stat.size}`,
    })
  })

  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const stat = await f.stat()
  expect(stat.size).toEqual(8)
})
