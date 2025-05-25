import type { FilehandleOptions, GenericFilehandle, Stats } from './filehandle'

export default class LocalFile implements GenericFilehandle {
  public constructor(_source: string, _opts: FilehandleOptions = {}) {
    throw new Error('unimplemented')
  }

  read(): Promise<Uint8Array<ArrayBuffer>> {
    throw new Error('unimplemented')
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
    ? Promise<Uint8Array<ArrayBuffer>>
    : Promise<Uint8Array<ArrayBuffer> | string>
  public async readFile(
    _options: FilehandleOptions | BufferEncoding = {},
  ): Promise<Uint8Array<ArrayBuffer> | string> {
    throw new Error('unimplemented')
  }

  stat(): Promise<Stats> {
    throw new Error('unimplemented')
  }

  close(): Promise<void> {
    throw new Error('unimplemented')
  }
}
