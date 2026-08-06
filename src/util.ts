import type {
  BufferEncoding,
  FilehandleOptions,
  ProgressCallback,
} from './filehandle.ts'

// Response.bytes() / Blob.bytes() is widely available but not yet in all
// lib.dom.d.ts versions, so the optional-chain check is load-bearing for older
// runtimes despite TS thinking it's always defined.
export async function toBytes(
  src: Response | Blob,
): Promise<Uint8Array<ArrayBuffer>> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return src.bytes ? src.bytes() : new Uint8Array(await src.arrayBuffer())
}

/**
 * `readFile()` takes either a bare encoding string or an options object, in
 * every implementation. Split whichever was passed into the two things callers
 * actually branch on.
 */
export function splitReadFileOptions(
  options: FilehandleOptions | BufferEncoding | undefined,
): { encoding?: BufferEncoding; opts: FilehandleOptions } {
  return typeof options === 'string'
    ? { encoding: options, opts: {} }
    : { encoding: options?.encoding, opts: options ?? {} }
}

/**
 * Total file size from a `Content-Range: bytes 0-9/1234` header, or undefined
 * if the header is absent or gives the size as `*`.
 */
export function parseContentRangeSize(
  contentRange: string | null,
): number | undefined {
  const size = /\/(\d+)$/.exec(contentRange ?? '')?.[1]
  return size === undefined ? undefined : parseInt(size, 10)
}

/**
 * Content-Length as a usable byte count. A malformed header yields undefined
 * rather than NaN, which would otherwise survive an `=== undefined` check and
 * poison every arithmetic use downstream.
 */
export function parseContentLength(res: Response): number | undefined {
  const header = res.headers.get('content-length')
  const parsed = header === null ? Number.NaN : Number(header)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}

// throttle intermediate progress ticks; a large body can yield thousands of
// chunks and the final exact count is always emitted regardless
const PROGRESS_THROTTLE_MS = 50

/**
 * Read a Response body to bytes while reporting download progress.
 *
 * When Content-Length is known the body is streamed directly into one pre-sized
 * buffer (no per-chunk array, no second copy), ticking `onProgress` as chunks
 * arrive. Without a known length there is no fraction to show, so it falls back
 * to a single one-shot read and one completion tick rather than buffering
 * chunks. Only used when a caller opts in via `onProgress`; the plain {@link
 * toBytes} fast path is unaffected.
 */
export async function toBytesWithProgress(
  res: Response,
  onProgress: ProgressCallback,
): Promise<Uint8Array<ArrayBuffer>> {
  const total = parseContentLength(res)
  const body = res.body
  if (!body || total === undefined) {
    const bytes = await toBytes(res)
    onProgress(bytes.byteLength, total ?? bytes.byteLength)
    return bytes
  }

  const reader = body.getReader()
  let out = new Uint8Array(total)
  let received = 0
  let lastTick = 0
  onProgress(0, total)
  for (
    let chunk = await reader.read();
    !chunk.done;
    chunk = await reader.read()
  ) {
    // a decoded body can exceed Content-Length (e.g. gzip transfer-encoding);
    // grow the buffer rather than throwing on out.set() overflow
    if (received + chunk.value.byteLength > out.length) {
      const grown = new Uint8Array(
        Math.max(received + chunk.value.byteLength, out.length * 2),
      )
      grown.set(out.subarray(0, received))
      out = grown
    }
    out.set(chunk.value, received)
    received += chunk.value.byteLength
    const now = Date.now()
    if (now - lastTick >= PROGRESS_THROTTLE_MS) {
      lastTick = now
      onProgress(received, total)
    }
  }

  onProgress(received, total)
  return received === out.length ? out : out.subarray(0, received)
}
