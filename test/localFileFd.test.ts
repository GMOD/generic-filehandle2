import { expect, test } from 'vitest'

import { toString } from './helpers.ts'
import { LocalFile } from '../src/index.ts'

import type { FileHandle } from 'fs/promises'

const FIXTURE = require.resolve('./data/test.txt')

function fileWithHeldHandle() {
  const file = new LocalFile(FIXTURE)
  // reach the private field to simulate the descriptor dying underneath us,
  // which is the whole point of the exercise and cannot be provoked from
  // outside on a local disk
  return {
    file,
    async killHandle() {
      const held = (file as unknown as { fh: FileHandle | undefined }).fh
      if (!held) {
        throw new Error('expected a held descriptor to kill')
      }
      await held.close()
    },
  }
}

test('a held descriptor gives the same bytes as opening per read', async () => {
  const cached = new LocalFile(FIXTURE)
  const perRead = new LocalFile(FIXTURE, { cacheFd: false })
  const cases: [number, number][] = [
    [3, 0],
    [2, 6],
    [8, 0],
    [100, 0],
  ]
  for (const [len, pos] of cases) {
    const a = await cached.read(len, pos)
    const b = await perRead.read(len, pos)
    expect(toString(a)).toEqual(toString(b))
  }
  await cached.close()
})

test('cacheFd: false restores open-per-read', async () => {
  const file = new LocalFile(FIXTURE, { cacheFd: false })
  expect(toString(await file.read(3, 0))).toEqual('tes')
  // nothing is retained between reads
  expect((file as unknown as { fh: unknown }).fh).toBeUndefined()
})

test('a stale descriptor is reopened rather than surfacing as an error', async () => {
  // The Samba/NFS hazard: EBADF/ESTALE on a descriptor held across reads.
  const held = fileWithHeldHandle()
  const { file } = held
  expect(toString(await file.read(3, 0))).toEqual('tes')
  await held.killHandle()
  expect(toString(await file.read(3, 0))).toEqual('tes')
  await file.close()
})

test('repeated descriptor death is survivable', async () => {
  const held = fileWithHeldHandle()
  const { file } = held
  for (let i = 0; i < 5; i++) {
    expect(toString(await file.read(3, 0))).toEqual('tes')
    await held.killHandle()
  }
  expect(toString(await file.read(3, 0))).toEqual('tes')
  await file.close()
})

test('a genuinely unreadable file still throws its real error', async () => {
  // the retry must not turn a real failure into an infinite reopen loop, nor
  // mask the errno the caller needs
  const file = new LocalFile('/nonexistent/nope.txt')
  await expect(file.read(10, 0)).rejects.toThrow(
    expect.objectContaining({ code: 'ENOENT' }),
  )
})

test('concurrent reads share a single open()', async () => {
  const file = new LocalFile(FIXTURE)
  // Fire six reads without awaiting, the way an indexed reader does, then look
  // at the in-flight open before any of them settle: there must be exactly one
  // shared promise rather than six racing opens.
  const reads = [
    file.read(3, 0),
    file.read(2, 6),
    file.read(8, 0),
    file.read(3, 0),
    file.read(2, 6),
    file.read(1, 1),
  ]
  const inFlight = (file as unknown as { opening: Promise<unknown> }).opening
  expect(inFlight).toBeDefined()
  expect((file as unknown as { fh: unknown }).fh).toBeUndefined()

  const results = await Promise.all(reads)
  expect(results.map(r => toString(r))).toEqual([
    'tes',
    'g\n',
    'testing\n',
    'tes',
    'g\n',
    'e',
  ])
  // and they all ended up on the one descriptor that open resolved to
  expect((file as unknown as { fh: unknown }).fh).toBe(await inFlight)
  await file.close()
})

test('close() releases the descriptor and reading again reopens', async () => {
  const file = new LocalFile(FIXTURE)
  await file.read(3, 0)
  expect((file as unknown as { fh: unknown }).fh).toBeDefined()
  await file.close()
  expect((file as unknown as { fh: unknown }).fh).toBeUndefined()
  // still usable: close is a hint, not a teardown
  expect(toString(await file.read(3, 0))).toEqual('tes')
  await file.close()
})

test('read honors an aborted signal', async () => {
  const file = new LocalFile(FIXTURE)
  const controller = new AbortController()
  controller.abort()
  await expect(file.read(3, 0, { signal: controller.signal })).rejects.toThrow()
  // a zero-length read is answered before the signal check, as elsewhere
  expect((await file.read(0, 0, { signal: controller.signal })).length).toBe(0)
  await file.close()
})

test('an aborted read does not reopen and retry', async () => {
  // The retry exists for stale descriptors. A cancellation must not spend a
  // reopen and a second read on its way to throwing.
  const file = new LocalFile(FIXTURE)
  await file.read(3, 0)
  const held = (file as unknown as { fh: unknown }).fh
  const controller = new AbortController()
  const reading = file.read(3, 0, { signal: controller.signal })
  controller.abort()
  await expect(reading).rejects.toThrow()
  // the descriptor was dropped rather than reopened behind a second attempt
  expect((file as unknown as { fh: unknown }).fh).not.toBe(held)
  await file.close()
})

test('the idle timer releases a descriptor nothing is reading', async () => {
  const file = new LocalFile(FIXTURE, { fdIdleTimeoutMs: 20 })
  await file.read(3, 0)
  expect((file as unknown as { fh: unknown }).fh).toBeDefined()
  await new Promise(r => setTimeout(r, 60))
  expect((file as unknown as { fh: unknown }).fh).toBeUndefined()
  // and the file still works afterwards
  expect(toString(await file.read(3, 0))).toEqual('tes')
  await file.close()
})

test('reads keep the descriptor alive; the clock is since the last read', async () => {
  const file = new LocalFile(FIXTURE, { fdIdleTimeoutMs: 60 })
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 20))
    await file.read(3, 0)
    expect((file as unknown as { fh: unknown }).fh).toBeDefined()
  }
  await file.close()
})

test('fdIdleTimeoutMs: 0 holds the descriptor until close', async () => {
  const file = new LocalFile(FIXTURE, { fdIdleTimeoutMs: 0 })
  await file.read(3, 0)
  await new Promise(r => setTimeout(r, 50))
  expect((file as unknown as { fh: unknown }).fh).toBeDefined()
  await file.close()
  expect((file as unknown as { fh: unknown }).fh).toBeUndefined()
})

// Electron's renderer, and anything else that resolves the node entry while
// keeping DOM timers: `fs/promises` is real so this is the right class, but
// `setTimeout` returns a number, which has no `unref`. Reaching for it threw
// out of the read itself — in JBrowse Desktop that surfaced as a text search
// adapter failing, with nothing naming a timer.
test('a read succeeds where setTimeout returns a number, as in a DOM context', async () => {
  const realSetTimeout = globalThis.setTimeout
  const timers: unknown[] = []
  // the DOM signature: an opaque numeric handle, no unref
  globalThis.setTimeout = ((fn: () => void, ms?: number) => {
    timers.push(realSetTimeout(fn, ms))
    return timers.length as unknown as ReturnType<typeof setTimeout>
  }) as typeof globalThis.setTimeout
  try {
    const file = new LocalFile(FIXTURE)
    expect(toString(await file.read(3, 0))).toEqual('tes')
    // and the second read, which is the one that clears the previous timer
    expect(toString(await file.read(2, 4))).toEqual('in')
    await file.close()
  } finally {
    globalThis.setTimeout = realSetTimeout
    for (const t of timers) {
      clearTimeout(t as ReturnType<typeof setTimeout>)
    }
  }
})
