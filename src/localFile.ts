import { open, readFile, stat } from 'fs/promises'

import type {
  BufferEncoding,
  FilehandleOptions,
  GenericFilehandle,
  Stats,
} from './filehandle.ts'

export default class LocalFile implements GenericFilehandle {
  private filename: string

  public constructor(source: string) {
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
    return readFile(this.filename, options)
  }

  public async stat(): Promise<Stats> {
    return stat(this.filename)
  }

  public async close(): Promise<void> {
    /* do nothing */
  }
}
