import { open, readFile, stat } from 'fs/promises'

import type { FilehandleOptions, GenericFilehandle } from './filehandle.ts'

export default class LocalFile implements GenericFilehandle {
  private filename: string

  public constructor(source: string, _opts: FilehandleOptions = {}) {
    this.filename = source
  }

  public async read(length: number, position = 0) {
    const arr = new Uint8Array(length)
    let fd // Declare fd outside the try block so it's accessible in finally
    try {
      fd = await open(this.filename, 'r')
      const res = await fd.read(arr, 0, length, position)
      return res.buffer.subarray(0, res.bytesRead)
    } finally {
      // This block will always execute, regardless of success or error
      if (fd) {
        // Only close if the fd was successfully opened
        await fd.close()
      }
    }
  }

  public async readFile(): Promise<Uint8Array<ArrayBuffer>>
  public async readFile(options: BufferEncoding): Promise<string>
  public async readFile<T extends undefined>(
    options:
      | Omit<FilehandleOptions, 'encoding'>
      | (Omit<FilehandleOptions, 'encoding'> & { encoding: T }),
  ): Promise<Uint8Array<ArrayBuffer>>
  public async readFile<T extends BufferEncoding>(
    options: Omit<FilehandleOptions, 'encoding'> & { encoding: T },
  ): Promise<string>
  public async readFile(
    options?: FilehandleOptions | BufferEncoding,
  ): Promise<Uint8Array<ArrayBuffer> | string> {
    const res = await readFile(this.filename, options)
    return typeof res === 'string' ? res : new Uint8Array(res)
  }

  public async stat() {
    return stat(this.filename)
  }

  public async close(): Promise<void> {
    /* do nothing */
  }
}
