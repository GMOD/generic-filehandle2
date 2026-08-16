import { readBody, splitReadFileOptions, toBytes } from './util.ts'

import type {
  BufferEncoding,
  FilehandleOptions,
  GenericFilehandle,
  ReadFileOptions,
  ReadFileTextOptions,
  Stats,
} from './filehandle.ts'

/**
 * Blob of binary data fetched from a local file (with FileReader).
 *
 * Adapted by Robert Buels and Garrett Stevens from the BlobFetchable object in
 * the Dalliance Genome Explorer, which is copyright Thomas Down 2006-2011.
 */
export default class BlobFile implements GenericFilehandle {
  private blob: Blob

  public constructor(blob: Blob) {
    this.blob = blob
  }

  public async read(
    length: number,
    position = 0,
    opts: FilehandleOptions = {},
  ): Promise<Uint8Array<ArrayBuffer>> {
    // short-circuit a read of 0 bytes here, because browsers actually sometimes
    // crash if you try to read 0 bytes from a local file!
    if (length === 0) {
      return new Uint8Array(0)
    }

    opts.signal?.throwIfAborted()
    const bytes = await toBytes(this.blob.slice(position, position + length))
    // Blob reads are not cancellable, so the read completes either way; this
    // stops the bytes reaching a caller that has already given up, which is
    // what every other filehandle here does.
    opts.signal?.throwIfAborted()
    return bytes
  }

  public async readFile(
    options?: ReadFileOptions,
  ): Promise<Uint8Array<ArrayBuffer>>
  public async readFile(options: ReadFileTextOptions): Promise<string>
  public async readFile(
    options?: FilehandleOptions | BufferEncoding,
  ): Promise<Uint8Array<ArrayBuffer> | string> {
    const { encoding, opts } = splitReadFileOptions(options)
    opts.signal?.throwIfAborted()
    const body = await readBody(this.blob, encoding)
    // as in read(): the blob read is not cancellable, so this only keeps the
    // result from a caller that has already given up
    opts.signal?.throwIfAborted()
    return body
  }

  public stat(): Promise<Stats> {
    return Promise.resolve({ size: this.blob.size })
  }

  public close(): Promise<void> {
    return Promise.resolve()
  }
}
