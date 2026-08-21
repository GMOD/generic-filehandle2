# generic-filehandle2

[![NPM version](https://img.shields.io/npm/v/generic-filehandle2.svg?style=flat-square)](https://npmjs.org/package/generic-filehandle2)
![Build Status](https://img.shields.io/github/actions/workflow/status/GMOD/generic-filehandle2/publish.yml?branch=main)

Provides a uniform interface for accessing binary data from local files, remote
HTTP resources, and Blob data in the browser.

## Usage

```js
import { LocalFile, RemoteFile, BlobFile } from 'generic-filehandle2'

const local = new LocalFile('/some/file/path/file.txt')
const remote = new RemoteFile('http://somesite.com/file.txt')
const blobfile = new BlobFile(new Blob([some_data], { type: 'text/plain' }))

const buf1 = await remote.read(/* length */ 10, /* position */ 10) // range request
const buf2 = await remote.readFile()
```

If you are reading a remote file through an indexed parser, put
[@gmod/range-cache-filehandle](https://github.com/GMOD/range-cache-filehandle)
underneath it. Its `RemoteFileWithRangeCache` is a drop-in replacement for
`RemoteFile` that caches byte ranges in chunks, so that a query's many small
reads turn into a few requests.

## API

Every filehandle has the same four methods:

```js
await file.read(length, position, opts) // the bytes at a byte offset
await file.readFile(opts) // the whole file, as bytes or as a string
await file.stat() // the file size, as { size }
await file.close() // close the file descriptor, if one is open
```

The options they take, the behavior they share, and the seam for extending
`RemoteFile` are all covered in [docs/api.md](docs/api.md).

`LocalFile` takes two more options in its constructor, `cacheFd` and
`fdIdleTimeoutMs`, which control how it manages its file descriptor.
[docs/local-files.md](docs/local-files.md) explains what they do and why they
default the way they do.

## Docs

- [@gmod/range-cache-filehandle](https://github.com/GMOD/range-cache-filehandle)
  is the byte-range cache to put underneath these handles when reading remote
  files, and is built on the `fetchBytes` seam described in `docs/api.md`.
- [docs/api.md](docs/api.md) documents every method, option and type, the
  behavior all three implementations share, and how to extend `RemoteFile`.
- [docs/optimizations.md](docs/optimizations.md) explains why reads, requests
  and buffers work the way they do, and what each of those choices measured.
- [docs/local-files.md](docs/local-files.md) covers the file descriptor that
  `LocalFile` keeps open: why it holds one, how it recovers when one goes stale
  on a network filesystem, and why an idle timeout closes it again.
- [docs/browser-builds.md](docs/browser-builds.md) covers the `browser` export
  condition, the `LocalFile` stub it points at, and how the packed artifact is
  tested.

## See also

The original generic-filehandle library:
https://github.com/GMOD/generic-filehandle

## Publishing

[Trusted publishing](https://docs.npmjs.com/about-trusted-publishing) via GitHub
Actions.

```bash
pnpm version patch  # or minor/major
```
