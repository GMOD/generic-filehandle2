import { toBytes } from './util.ts'

import type {
  BufferEncoding,
  FilehandleOptions,
  GenericFilehandle,
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
  ): Promise<Uint8Array<ArrayBuffer>> {
    // short-circuit a read of 0 bytes here, because browsers actually sometimes
    // crash if you try to read 0 bytes from a local file!
    if (length === 0) {
      return new Uint8Array(0)
    }

    return toBytes(this.blob.slice(position, position + length))
  }

  public async readFile(
    options?: Omit<FilehandleOptions, 'encoding'>,
  ): Promise<Uint8Array<ArrayBuffer>>
  public async readFile(
    options:
      | BufferEncoding
      | (Omit<FilehandleOptions, 'encoding'> & { encoding: BufferEncoding }),
  ): Promise<string>
  public async readFile(
    options?: FilehandleOptions | BufferEncoding,
  ): Promise<Uint8Array<ArrayBuffer> | string> {
    const encoding = typeof options === 'string' ? options : options?.encoding
    if (encoding === 'utf8') {
      return this.blob.text()
    } else if (encoding) {
      throw new Error(`unsupported encoding: ${encoding}`)
    } else {
      return toBytes(this.blob)
    }
  }

  public stat(): Promise<Stats> {
    return Promise.resolve({ size: this.blob.size })
  }

  public close(): Promise<void> {
    return Promise.resolve()
  }
}
