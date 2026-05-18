// Browser-specific exports that exclude Node.js-only modules
export * from './filehandle.ts'

export { default as BlobFile } from './blobFile.ts'
export { default as RemoteFile } from './remoteFile.ts'

export class LocalFile {
  readFile(): Promise<never> {
    return Promise.reject(new Error('unimplemented'))
  }
  read(): Promise<never> {
    return Promise.reject(new Error('unimplemented'))
  }
  stat(): Promise<never> {
    return Promise.reject(new Error('unimplemented'))
  }
  close(): Promise<never> {
    return Promise.reject(new Error('unimplemented'))
  }
}
