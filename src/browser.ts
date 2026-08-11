// Browser-specific exports that exclude Node.js-only modules
import type { GenericFilehandle } from './filehandle.ts'
import type { LocalFileOptions } from './localFile.ts'

export * from './filehandle.ts'
export type { LocalFileOptions } from './localFile.ts'

export { default as BlobFile } from './blobFile.ts'
export { default as RemoteFile } from './remoteFile.ts'

/**
 * Stub standing in for the Node.js LocalFile in browser builds. It takes the
 * same constructor argument as the real one — otherwise `new LocalFile(path)`
 * is a type error in any bundle that resolves the `browser` export condition —
 * and declares `implements GenericFilehandle` so drift from the real class
 * fails to compile rather than at runtime.
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

  readFile(): Promise<never> {
    return this.unimplemented()
  }
  read(): Promise<never> {
    return this.unimplemented()
  }
  stat(): Promise<never> {
    return this.unimplemented()
  }
  close(): Promise<never> {
    return this.unimplemented()
  }
}
