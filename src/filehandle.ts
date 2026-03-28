// avoids needing to have @types/node as a dependency of the consuming code
export type BufferEncoding =
  | 'ascii'
  | 'utf8'
  | 'utf-8'
  | 'utf16le'
  | 'utf-16le'
  | 'ucs2'
  | 'ucs-2'
  | 'base64'
  | 'base64url'
  | 'latin1'
  | 'binary'
  | 'hex'

export type Fetcher = (
  input: RequestInfo,
  init?: RequestInit,
) => Promise<Response>

export interface FilehandleOptions {
  signal?: AbortSignal
  headers?: Record<string, string>
  overrides?: Omit<RequestInit, 'headers'>
  encoding?: BufferEncoding
  fetch?: Fetcher
  downloadCallback?: (downloaded: number, total: number) => void
}

export interface Stats {
  size: number
}

export interface GenericFilehandle {
  read(
    length: number,
    position: number,
    opts?: FilehandleOptions,
  ): Promise<Uint8Array<ArrayBuffer>>

  readFile(): Promise<Uint8Array<ArrayBuffer>>
  readFile(options: BufferEncoding): Promise<string>
  readFile<T extends undefined>(
    options:
      | Omit<FilehandleOptions, 'encoding'>
      | (Omit<FilehandleOptions, 'encoding'> & { encoding: T }),
  ): Promise<Uint8Array<ArrayBuffer>>
  readFile<T extends BufferEncoding>(
    options: Omit<FilehandleOptions, 'encoding'> & { encoding: T },
  ): Promise<string>
  readFile<T extends BufferEncoding>(
    options: Omit<FilehandleOptions, 'encoding'> & { encoding: T },
  ): T extends BufferEncoding
    ? Promise<string>
    : Promise<Uint8Array<ArrayBuffer>>
  stat(): Promise<Stats>
  close(): Promise<void>
}
