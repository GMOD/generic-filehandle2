// Response.bytes() / Blob.bytes() is widely available but not yet in all
// lib.dom.d.ts versions, so the optional-chain check is load-bearing for older
// runtimes despite TS thinking it's always defined.
export async function toBytes(
  src: Response | Blob,
): Promise<Uint8Array<ArrayBuffer>> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return src.bytes ? src.bytes() : new Uint8Array(await src.arrayBuffer())
}

/** Reports bytes downloaded for a single fetch; `total` from Content-Length. */
export type ProgressCallback = (bytesReceived: number, total?: number) => void

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
  const lengthHeader = res.headers.get('content-length')
  const total = lengthHeader ? parseInt(lengthHeader, 10) : undefined
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
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
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
