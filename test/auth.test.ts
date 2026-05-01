import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import { createResponse, toString } from './helpers.ts'
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

test('auth token', async () => {
  mockFetch = vi
    .fn()
    .mockImplementation(
      (_url: string, args: { headers: Record<string, string> }) => {
        return args.headers.Authorization
          ? createResponse('hello world', 200)
          : createResponse('Unauthorized', 403)
      },
    )

  const f = new RemoteFile('http://fakehost/test.txt', {
    fetch: mockFetch,
    headers: {
      Authorization: 'Basic YWxhZGRpbjpvcGVuc2VzYW1l',
    },
  })
  const stat = await f.readFile('utf8')
  expect(stat).toBe('hello world')
})

test('auth token with range request', async () => {
  mockFetch = vi
    .fn()
    .mockImplementation(
      (_url: string, args: { headers: Record<string, string> }) => {
        if (args.headers.Authorization && args.headers.range) {
          return createResponse('hello', 206)
        } else if (!args.headers.Authorization) {
          return createResponse('Unauthorized', 403)
        } else if (!args.headers.Range) {
          return createResponse('Bad Request', 400)
        }
        return createResponse('Unknown error', 500)
      },
    )

  const f = new RemoteFile('http://fakehost/test.txt', {
    fetch: mockFetch,
    headers: {
      Authorization: 'Basic YWxhZGRpbjpvcGVuc2VzYW1l',
    },
  })
  const buffer = await f.read(5, 0)
  expect(toString(buffer)).toBe('hello')
})
