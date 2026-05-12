// Response.bytes() / Blob.bytes() is widely available but not yet in all
// lib.dom.d.ts versions, so the optional-chain check is load-bearing for older
// runtimes despite TS thinking it's always defined.
export async function toBytes(
  src: Response | Blob,
): Promise<Uint8Array<ArrayBuffer>> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  return src.bytes ? src.bytes() : new Uint8Array(await src.arrayBuffer())
}
