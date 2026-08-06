/** Reports bytes downloaded for a single fetch; `total` from Content-Length. */
export type ProgressCallback = (bytesReceived: number, total?: number) => void

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
  /**
   * Opt-in download-progress reporting. When set, the response body is streamed
   * and this is called with the running byte count (and Content-Length total
   * when available) as chunks arrive. Omitting it keeps the faster
   * non-streaming read.
   */
  onProgress?: ProgressCallback
}

export interface Stats {
  size: number
}

/** `readFile()` arguments for the byte-returning call. */
export type ReadFileOptions = Omit<FilehandleOptions, 'encoding'>

/** `readFile()` arguments for the string-returning call. */
export type ReadFileTextOptions =
  | BufferEncoding
  | (ReadFileOptions & { encoding: BufferEncoding })

export interface GenericFilehandle {
  read(
    length: number,
    position: number,
    opts?: FilehandleOptions,
  ): Promise<Uint8Array<ArrayBuffer>>

  readFile(options?: ReadFileOptions): Promise<Uint8Array<ArrayBuffer>>
  readFile(options: ReadFileTextOptions): Promise<string>
  stat(): Promise<Stats>
  close(): Promise<void>
}
