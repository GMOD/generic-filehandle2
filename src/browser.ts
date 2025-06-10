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
  stat() {
    throw new Error('unimplemented')
  }
  close() {
    throw new Error('unimplemented')
  }
  /* do nothing in browser */
}

export { type GenericFilehandle } from './filehandle.ts'
