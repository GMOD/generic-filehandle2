import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { createResponse, rangeMockFetch, toString } from './helpers.ts'
import { LocalFile, RemoteFile } from '../src/index.ts'

const getFile = (url: string) =>
  new LocalFile(require.resolve(url.replace('http://fakehost/', './data/')))

// Mock implementation for fetch
let mockFetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>

beforeEach(() => {
  // Reset the mock fetch implementation before each test
  mockFetch = vi.fn().mockImplementation((url: string) => {
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

  // @ts-expect-error passing invalid encoding to test runtime error
  await expect(f.readFile('fakeEncoding')).rejects.toThrow(
    /unsupported encoding/,
  )
})

test('reads remote partially', async () => {
  mockFetch = rangeMockFetch()
  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const buf = await f.read(3, 0)
  expect(toString(buf)).toEqual('tes')
})

test('reads remote clipped at the end', async () => {
  mockFetch = rangeMockFetch()
  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const buf = await f.read(3, 6)
  expect(toString(buf).replace('\0', '')).toEqual('g\n')
})

test('throws error', async () => {
  mockFetch = vi.fn().mockImplementation(() => {
    return createResponse('', 500)
  })

  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const res = f.read(10, 0)
  await expect(res).rejects.toThrow(/HTTP 500/)
})

test('throws error if file missing', async () => {
  mockFetch = vi.fn().mockImplementation(() => {
    return createResponse('Not Found', 404)
  })

  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const res = f.read(10, 0)
  await expect(res).rejects.toThrow(/HTTP 404/)
})

test('throws on NaN length or position', async () => {
  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  await expect(f.read(NaN, 0)).rejects.toThrow(/NaN length or position/)
  await expect(f.read(10, NaN)).rejects.toThrow(/NaN length or position/)
})

test('zero read', async () => {
  mockFetch = rangeMockFetch()
  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const buf = toString(await f.read(0, 0))
  expect(buf).toBe('')
})

test('stat', async () => {
  mockFetch = rangeMockFetch()
  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const stat = await f.stat()
  expect(stat.size).toEqual(8)
})

test('stat falls back to body length when server returns 200 without content-range', async () => {
  mockFetch = vi.fn().mockImplementation(() => createResponse('hello!', 200))
  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const stat = await f.stat()
  expect(stat.size).toEqual(6)
})

test('readFile reports streaming download progress', async () => {
  const payload = new TextEncoder().encode('testing\n')
  mockFetch = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(payload, {
        status: 200,
        headers: { 'content-length': `${payload.byteLength}` },
      }),
    ),
  )

  const ticks: [number, number | undefined][] = []
  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const b = await f.readFile({
    onProgress: (received, total) => {
      ticks.push([received, total])
    },
  })

  expect(toString(b)).toEqual('testing\n')
  // starts at 0 with the known total, ends fully received
  expect(ticks[0]).toEqual([0, payload.byteLength])
  expect(ticks.at(-1)).toEqual([payload.byteLength, payload.byteLength])
})

test('read reports progress, falling back to a final tick without a stream', async () => {
  mockFetch = rangeMockFetch()
  const ticks: [number, number | undefined][] = []
  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const b = await f.read(8, 0, {
    onProgress: (received, total) => {
      ticks.push([received, total])
    },
  })

  expect(toString(b)).toEqual('testing\n')
  // mocked response has no streamable body, so we still get a completion tick
  expect(ticks.at(-1)?.[0]).toEqual(8)
})

test('readFile progress grows past an understated content-length', async () => {
  const payload = new TextEncoder().encode('testing\n')
  mockFetch = vi.fn().mockImplementation(() =>
    // content-length understates the actual body (mimics gzip transfer-encoding
    // where the header is the compressed size)
    Promise.resolve(
      new Response(payload, {
        status: 200,
        headers: { 'content-length': '2' },
      }),
    ),
  )

  const ticks: [number, number | undefined][] = []
  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const b = await f.readFile({
    onProgress: (received, total) => {
      ticks.push([received, total])
    },
  })

  expect(toString(b)).toEqual('testing\n')
  expect(ticks.at(-1)?.[0]).toEqual(payload.byteLength)
})
