// Browser-specific exports that exclude Node.js-only modules
export * from './filehandle.ts'

export { default as BlobFile } from './blobFile.ts'
export { default as RemoteFile } from './remoteFile.ts'

export class LocalFile {
  readFile() {
    throw new Error('unimplemented')
  }
  read() {
    throw new Error('unimplemented')
  }
  close() {
    throw new Error('unimplemented')
  }
}

export { type GenericFilehandle } from './filehandle.ts'
