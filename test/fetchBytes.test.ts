import { expect, test, vi } from 'vitest'

import { rangeMockFetch, toString } from './helpers.ts'
import { RemoteFile } from '../src/index.ts'

import type { FilehandleOptions } from '../src/index.ts'

/**
 * A subclass that serves bytes from memory, which is the shape this seam
 * exists for — a cache holds bytes, and should not have to build a Response
 * for `read` to take apart again.
 */
class MemoryBackedFile extends RemoteFile {
  public fetchBytesCalls: { length: number; position: number }[] = []
  private contents: Uint8Array
  constructor(
    url: string,
    contents: Uint8Array,
    opts?: ConstructorParameters<typeof RemoteFile>[1],
  ) {
    super(url, opts)
    this.contents = contents
  }
  // eslint-disable-next-line @typescript-eslint/require-await
  protected override async fetchBytes(
    length: number,
    position: number,
    _opts: FilehandleOptions,
  ) {
    this.fetchBytesCalls.push({ length, position })
    return this.contents.slice(position, position + length)
  }
}

const CONTENTS = new TextEncoder().encode('abcdefghijklmnopqrstuvwxyz')

test('read() routes through fetchBytes, and an override serves bytes with no fetch', async () => {
  const fetch = vi.fn()
  const file = new MemoryBackedFile('http://fakehost/x', CONTENTS, { fetch })
  const buf = await file.read(5, 3)
  expect(toString(buf)).toEqual('defgh')
  expect(file.fetchBytesCalls).toEqual([{ length: 5, position: 3 }])
  // the whole point: no Response was built, so no fetch happened
  expect(fetch).not.toHaveBeenCalled()
})

test('read() keeps its argument validation in front of the seam', async () => {
  const file = new MemoryBackedFile('http://fakehost/x', CONTENTS)

  // a zero-length read short-circuits without reaching the seam
  expect((await file.read(0, 0)).length).toEqual(0)
  expect(file.fetchBytesCalls).toEqual([])

  // NaN is rejected before the seam too, so an override never sees one
  await expect(file.read(Number.NaN, 0)).rejects.toThrow(TypeError)
  await expect(file.read(10, Number.NaN)).rejects.toThrow(TypeError)
  expect(file.fetchBytesCalls).toEqual([])
})

test('the default fetchBytes still goes through this.fetch, so fetch overrides keep working', async () => {
  // A subclass that wraps fetch rather than fetchBytes is the pre-existing
  // pattern and must be unaffected by the seam existing.
  const seen: string[] = []
  class FetchWrappingFile extends RemoteFile {
    override async fetch(input: RequestInfo, init: RequestInit | undefined) {
      seen.push(String(input))
      return super.fetch(input, init)
    }
  }
  const file = new FetchWrappingFile('http://fakehost/test.txt', {
    fetch: rangeMockFetch(),
  })
  const buf = await file.read(3, 0)
  expect(toString(buf)).toEqual('tes')
  expect(seen).toEqual(['http://fakehost/test.txt'])
})

test('an override receives the caller opts', async () => {
  let received: FilehandleOptions | undefined
  class OptsFile extends RemoteFile {
    // eslint-disable-next-line @typescript-eslint/require-await
    protected override async fetchBytes(
      length: number,
      position: number,
      opts: FilehandleOptions,
    ) {
      received = opts
      return CONTENTS.slice(position, position + length)
    }
  }
  const controller = new AbortController()
  const onProgress = () => undefined
  const file = new OptsFile('http://fakehost/x')
  await file.read(2, 0, { signal: controller.signal, onProgress })
  expect(received?.signal).toBe(controller.signal)
  expect(received?.onProgress).toBe(onProgress)
})

test('stat() still works over an overridden fetchBytes', async () => {
  // stat falls back to read(10, 0), which now lands on the seam
  class SizedFile extends MemoryBackedFile {
    // eslint-disable-next-line @typescript-eslint/require-await
    override async stat() {
      return { size: CONTENTS.length }
    }
  }
  const file = new SizedFile('http://fakehost/x', CONTENTS)
  expect((await file.stat()).size).toEqual(26)
})
