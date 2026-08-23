import { expect, test } from 'vitest'

import BlobFile from '../src/blobFile.ts'
import LocalFile from '../src/localFile.ts'
import RemoteFile from '../src/remoteFile.ts'

import type { GenericFilehandle } from '../src/filehandle.ts'

// A caller showing a slow or stuck read to a human wants to name the file, and
// wants to say nothing rather than something useless when there is no name.

test('a remote file is its url', () => {
  expect(new RemoteFile('https://example.com/data.bam').source).toBe(
    'https://example.com/data.bam',
  )
})

test('a local file is its path', () => {
  expect(new LocalFile('/data/reads.bam').source).toBe('/data/reads.bam')
})

// bytes handed to the page: there is no address anyone could go and look at,
// and inventing one would be worse than saying nothing
test('a blob has none', () => {
  expect(new BlobFile(new Blob(['testing\n'])).source).toBeUndefined()
})

// the point of putting it on the interface: a caller holding the union does not
// have to know which implementation it got
test('reads off the interface without narrowing', () => {
  const handles: GenericFilehandle[] = [
    new RemoteFile('https://example.com/data.bam'),
    new BlobFile(new Blob(['testing\n'])),
  ]
  expect(handles.map(h => h.source)).toEqual([
    'https://example.com/data.bam',
    undefined,
  ])
})

// verbatim, so a caller putting one on screen knows it owns resolving and
// redacting it
test('is what the handle was constructed with', () => {
  expect(new RemoteFile('data.bam?X-Amz-Signature=deadbeef').source).toBe(
    'data.bam?X-Amz-Signature=deadbeef',
  )
})
