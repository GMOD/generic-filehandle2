import { expect, test, vi } from 'vitest'

import { RemoteFile } from '../src/index.ts'

const URL = 'http://fakehost/test.txt'

class AuthNeededError extends Error {
  name = 'AuthNeededError'
}

test('a network failure gains the URL and keeps the original as its cause', async () => {
  const failure = new TypeError('fetch failed')
  const f = new RemoteFile(URL, { fetch: vi.fn().mockRejectedValue(failure) })
  await expect(f.read(10, 0)).rejects.toMatchObject({
    message: `fetch failed fetching ${URL}`,
    cause: failure,
  })
})

test('an error the fetch implementation throws reaches the caller as thrown', async () => {
  const thrown = new AuthNeededError('needs a login')
  const f = new RemoteFile(URL, { fetch: vi.fn().mockRejectedValue(thrown) })
  await expect(f.read(10, 0)).rejects.toBe(thrown)
  await expect(f.readFile()).rejects.toBe(thrown)
  await expect(f.stat()).rejects.toBe(thrown)
})

test("an abort reaches the caller as the signal's own reason", async () => {
  const fetch = (_url: RequestInfo, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        reject(init.signal?.reason)
      })
    })
  const f = new RemoteFile(URL, { fetch })

  const plain = new AbortController()
  const plainRead = f.read(10, 0, { signal: plain.signal })
  plain.abort()
  await expect(plainRead).rejects.toBe(plain.signal.reason)
  expect((plain.signal.reason as Error).name).toBe('AbortError')

  const reasoned = new AbortController()
  const reason = new Error('superseded by a newer view')
  const reasonedRead = f.read(10, 0, { signal: reasoned.signal })
  reasoned.abort(reason)
  await expect(reasonedRead).rejects.toBe(reason)
})

test('a fetch that reports its cancellation as a TypeError is not dressed up as a network failure', async () => {
  const cancelled = new TypeError('cancelled')
  const controller = new AbortController()
  controller.abort()
  const f = new RemoteFile(URL, { fetch: vi.fn().mockRejectedValue(cancelled) })
  await expect(f.read(10, 0, { signal: controller.signal })).rejects.toBe(
    cancelled,
  )
})
