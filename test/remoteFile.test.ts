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

test('warns on content-encoding: gzip range response but does not throw', async () => {
  mockFetch = vi.fn().mockImplementation(() => {
    return createResponse('hello', 206, {
      'content-range': '0-4/5',
      'content-encoding': 'gzip',
    })
  })

  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  await expect(f.read(5, 0)).resolves.toBeTruthy()
  await expect(f.read(5, 0)).resolves.toBeTruthy()
  await expect(f.read(5, 0)).resolves.toBeTruthy()
  expect(warnSpy).toHaveBeenCalledTimes(1)
  expect(warnSpy).toHaveBeenCalledWith(
    expect.stringContaining('content-encoding: gzip'),
  )
  warnSpy.mockRestore()
})

test('no warn when content-encoding absent (simulates CORS hiding the header)', async () => {
  mockFetch = vi.fn().mockImplementation(() => {
    // No content-encoding header — headers.get() returns null, matching CORS behavior
    return createResponse('hello', 206, { 'content-range': '0-4/5' })
  })

  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  const f = new RemoteFile('http://fakehost/test.txt', { fetch: mockFetch })
  await expect(f.read(5, 0)).resolves.toBeTruthy()
  expect(warnSpy).not.toHaveBeenCalled()
  warnSpy.mockRestore()
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
