import { open, readFile, stat } from 'fs/promises'

import type { FilehandleOptions, GenericFilehandle } from './filehandle.ts'

export default class LocalFile implements GenericFilehandle {
  private filename: string

  public constructor(source: string, _opts: FilehandleOptions = {}) {
    this.filename = source
  }

  public async read(length: number, position = 0) {
    if (length === 0) {
      return new Uint8Array(0)
    }
    const arr = new Uint8Array(length)
    let fd
    try {
      fd = await open(this.filename, 'r')
      const res = await fd.read(arr, 0, length, position)
      return res.buffer.subarray(0, res.bytesRead)
    } finally {
      if (fd) {
        try {
          await fd.close()
        } catch {
          // Ignore EBADF errors - the file descriptor is already closed/invalid
          // This can happen on network filesystems like Samba
        }
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
  readFile<T extends BufferEncoding>(
    options: Omit<FilehandleOptions, 'encoding'> & { encoding: T },
  ): T extends BufferEncoding
    ? Promise<string>
    : Promise<Uint8Array<ArrayBuffer>>
  public async readFile(
    options?: FilehandleOptions | BufferEncoding,
  ): Promise<Uint8Array<ArrayBuffer> | string> {
    return readFile(this.filename, options)
  }

  public async stat() {
    return stat(this.filename)
  }

  public async close(): Promise<void> {
    /* do nothing */
  }
}
