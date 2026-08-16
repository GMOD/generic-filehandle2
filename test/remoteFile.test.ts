import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import {
  capturingMockFetch,
  constantMockFetch,
  createResponse,
  rangeMockFetch,
  toString,
  wholeFileMockFetch,
} from './helpers.ts'
import { RemoteFile } from '../src/index.ts'

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
  mockFetch = wholeFileMockFetch()
  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const b = await f.readFile()
  expect(toString(b)).toEqual('testing\n')
})

test('reads file with response buffer method disabled', async () => {
  // createResponse has no .bytes(), so this exercises the arrayBuffer fallback
  mockFetch = wholeFileMockFetch()
  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const b = await f.readFile()
  expect(toString(b)).toEqual('testing\n')
})

test('reads file with encoding', async () => {
  mockFetch = wholeFileMockFetch()
  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const fileText = await f.readFile('utf8')
  expect(fileText).toEqual('testing\n')
  const fileText2 = await f.readFile({ encoding: 'utf8' })
  expect(fileText2).toEqual('testing\n')
  // node's readFile takes either spelling, so LocalFile does; the other
  // handles have to agree or the encoding depends on which one you hold
  expect(await f.readFile('utf-8')).toEqual('testing\n')

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
  mockFetch = constantMockFetch('', 500)
  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const res = f.read(10, 0)
  await expect(res).rejects.toThrow(/HTTP 500/)
})

test('throws error if file missing', async () => {
  mockFetch = constantMockFetch('Not Found', 404)
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
  mockFetch = constantMockFetch('hello!', 200)
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

test('readFile progress tolerates a malformed content-length', async () => {
  const payload = new TextEncoder().encode('testing\n')
  mockFetch = vi.fn().mockImplementation(() =>
    Promise.resolve(
      new Response(payload, {
        status: 200,
        headers: { 'content-length': 'not-a-number' },
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
  // an unusable header means no total to report, never a NaN one
  expect(ticks.every(([, total]) => total === undefined || !isNaN(total))).toBe(
    true,
  )
  expect(ticks.at(-1)?.[0]).toEqual(payload.byteLength)
})

test('overrides can set fetch params that the defaults would clobber', async () => {
  const { fetch, inits } = capturingMockFetch(() =>
    createResponse('hello', 206, { 'content-range': 'bytes 0-4/5' }),
  )

  const f = new RemoteFile('http://fakehost/test.txt', {
    fetch,
    overrides: { mode: 'no-cors', redirect: 'manual', credentials: 'include' },
  })
  await f.read(5, 0)

  expect(inits[0]?.mode).toBe('no-cors')
  expect(inits[0]?.redirect).toBe('manual')
  expect(inits[0]?.credentials).toBe('include')
  // still defaulted when the caller didn't ask for anything else
  expect(inits[0]?.method).toBe('GET')
})

test('signal is taken from the constructor, per-call opts, or overrides', async () => {
  const { fetch, inits } = capturingMockFetch(() =>
    createResponse('hello', 206, { 'content-range': 'bytes 0-4/5' }),
  )

  const viaOverrides = new AbortController()
  const f1 = new RemoteFile('http://fakehost/test.txt', {
    fetch,
    overrides: { signal: viaOverrides.signal },
  })
  await f1.read(5, 0)
  expect(inits[0]?.signal).toBe(viaOverrides.signal)

  const viaConstructor = new AbortController()
  const f2 = new RemoteFile('http://fakehost/test.txt', {
    fetch,
    signal: viaConstructor.signal,
  })
  await f2.read(5, 0)
  expect(inits[1]?.signal).toBe(viaConstructor.signal)

  // a per-call signal wins over both
  const viaCall = new AbortController()
  await f2.read(5, 0, { signal: viaCall.signal })
  expect(inits[2]?.signal).toBe(viaCall.signal)
})

test('read does not retain the whole body when the server ignores range', async () => {
  mockFetch = constantMockFetch(new Uint8Array(100_000), 200)

  const f = new RemoteFile('http://fakehost/big.bin', { fetch: mockFetch })
  const buf = await f.read(10, 0)

  expect(buf.byteLength).toBe(10)
  // a subarray view here would keep all 100kb alive for as long as the caller
  // holds these 10 bytes
  expect(buf.buffer.byteLength).toBe(10)
})

test('readFile records the size so a later stat does not refetch', async () => {
  mockFetch = constantMockFetch('hello!', 200)

  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  await f.readFile()
  const stat = await f.stat()

  expect(stat.size).toEqual(6)
  expect(mockFetch).toHaveBeenCalledTimes(1)
})

test('concurrent stat calls share a single request', async () => {
  mockFetch = constantMockFetch('hello!', 200)

  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  const [a, b] = await Promise.all([f.stat(), f.stat()])

  expect(a.size).toEqual(6)
  expect(b.size).toEqual(6)
  expect(mockFetch).toHaveBeenCalledTimes(1)
})

test('a failed stat probe does not poison later stat calls', async () => {
  mockFetch = vi
    .fn()
    .mockImplementationOnce(() => createResponse('', 500))
    .mockImplementation(() => createResponse('hello!', 200))

  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  await expect(f.stat()).rejects.toThrow(/HTTP 500/)
  expect((await f.stat()).size).toEqual(6)
})
