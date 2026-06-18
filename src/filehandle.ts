import type { ProgressCallback } from './util.ts'

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

export interface GenericFilehandle {
  read(
    length: number,
    position: number,
    opts?: FilehandleOptions,
  ): Promise<Uint8Array<ArrayBuffer>>

  readFile(
    options?: Omit<FilehandleOptions, 'encoding'>,
  ): Promise<Uint8Array<ArrayBuffer>>
  readFile(
    options:
      | BufferEncoding
      | (Omit<FilehandleOptions, 'encoding'> & { encoding: BufferEncoding }),
  ): Promise<string>
  stat(): Promise<Stats>
  close(): Promise<void>
}
