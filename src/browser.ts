// Browser-specific exports that exclude Node.js-only modules
import type {
  FilehandleOptions,
  GenericFilehandle,
  ReadFileOptions,
  ReadFileTextOptions,
} from './filehandle.ts'
import type { LocalFileOptions } from './localFile.ts'

export * from './filehandle.ts'
export type { LocalFileOptions } from './localFile.ts'

export { default as BlobFile } from './blobFile.ts'
export { default as RemoteFile } from './remoteFile.ts'

/**
 * Stub standing in for the Node.js LocalFile in browser builds. Every member
 * carries the same signature as the real one — otherwise code written against
 * the node class fails to compile in any bundle that resolves the `browser`
 * export condition, which is the one thing this stub exists to prevent.
 * `implements GenericFilehandle` keeps drift from the interface a compile
 * error rather than a runtime one.
 *
 * The parameters go unread: every call rejects. They are here to be typed, so
 * a bundle only discovers that a local file is unavailable in the browser at
 * the point it actually tries to read one.
 */
export class LocalFile implements GenericFilehandle {
  private source: string

  // takes the options argument too, for the same reason it takes `source`: a
  // bundle resolving the `browser` condition must still typecheck a call
  // written against the node class, options and all
  public constructor(source: string, _opts: LocalFileOptions = {}) {
    this.source = source
  }

  private unimplemented(): Promise<never> {
    return Promise.reject(
      new Error(`LocalFile is unimplemented in the browser (${this.source})`),
    )
  }

  readFile(options?: ReadFileOptions): Promise<Uint8Array<ArrayBuffer>>
  readFile(options: ReadFileTextOptions): Promise<string>
  readFile(_options?: unknown): Promise<never> {
    return this.unimplemented()
  }
  read(
    _length: number,
    _position?: number,
    _opts?: FilehandleOptions,
  ): Promise<never> {
    return this.unimplemented()
  }
  stat(): Promise<never> {
    return this.unimplemented()
  }
  close(): Promise<never> {
    return this.unimplemented()
  }
}
