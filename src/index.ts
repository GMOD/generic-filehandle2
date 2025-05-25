import LocalFile from './localFile.ts'
import RemoteFile from './remoteFile.ts'

import type { FilehandleOptions, GenericFilehandle } from './filehandle.ts'

export * from './filehandle.ts'

function fromUrl(
  source: string,
  opts: FilehandleOptions = {},
): GenericFilehandle {
  return new RemoteFile(source, opts)
}
function open(
  maybeUrl?: string,
  maybePath?: string,
  maybeFilehandle?: GenericFilehandle,
  opts: FilehandleOptions = {},
): GenericFilehandle {
  if (maybeFilehandle !== undefined) {
    return maybeFilehandle
  }
  if (maybeUrl !== undefined) {
    return fromUrl(maybeUrl, opts)
  }
  if (maybePath !== undefined) {
    return new LocalFile(maybePath, opts)
  }
  throw new Error('no url, path, or filehandle provided, cannot open')
}

export { fromUrl, open }
export { default as BlobFile } from './blobFile.ts'
export { default as RemoteFile } from './remoteFile.ts'
export { default as LocalFile } from './localFile.ts'

export { type GenericFilehandle } from './filehandle.ts'
