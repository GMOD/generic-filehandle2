#!/usr/bin/env bash
# Smoke-test the published artifact shape by packing and importing.
#
# `pnpm test` runs against src/, so it cannot see the package's shape at all:
# a missing build output or a broken export condition ships green. This packs
# the tarball, installs it into a scratch dir, and imports it three ways —
# ESM, CJS, and under the `browser` condition, which is the one a bundler
# takes and the one nothing else here exercises.

set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

cd "$PKG_DIR"
TARBALL="$(npm pack --silent --pack-destination "$SCRATCH")"
FIXTURE="$PKG_DIR/test/data/test.txt"

cd "$SCRATCH"
cat >package.json <<'JSON'
{
  "name": "generic-filehandle2-pack-test",
  "version": "0.0.0",
  "private": true,
  "type": "module"
}
JSON
npm install --silent --no-audit --no-fund "./$TARBALL" >/dev/null

cat >smoke.mjs <<JS
import { BlobFile, LocalFile, RemoteFile } from 'generic-filehandle2'
for (const [name, cls] of Object.entries({ BlobFile, LocalFile, RemoteFile })) {
  if (typeof cls !== 'function') throw new Error(\`\${name} missing from ESM entry\`)
}
const text = await new LocalFile('$FIXTURE').readFile('utf8')
if (text !== 'testing\n') throw new Error(\`esm: read \${JSON.stringify(text)}\`)
console.log('esm: ok')
JS

cat >smoke.cjs <<JS
const { BlobFile, LocalFile, RemoteFile } = require('generic-filehandle2')
;(async () => {
  for (const [name, cls] of Object.entries({ BlobFile, LocalFile, RemoteFile })) {
    if (typeof cls !== 'function') throw new Error(\`\${name} missing from CJS entry\`)
  }
  const text = await new LocalFile('$FIXTURE').readFile('utf8')
  if (text !== 'testing\n') throw new Error(\`cjs: read \${JSON.stringify(text)}\`)
  console.log('cjs: ok')
})().catch(e => { console.error(e); process.exit(1) })
JS

# The browser condition points at a build that stubs out LocalFile, the only
# class importing node's fs. Without it a Vite browser build dies on
# '"open" is not exported by "__vite-browser-external"', so the failure is a
# consumer's build rather than anything this repo's tests would notice.
cat >smoke-browser.mjs <<JS
import { BlobFile, LocalFile, RemoteFile } from 'generic-filehandle2'
for (const [name, cls] of Object.entries({ BlobFile, LocalFile, RemoteFile })) {
  if (typeof cls !== 'function') throw new Error(\`\${name} missing from browser entry\`)
}
const blob = await new BlobFile(new Blob(['testing\n'])).readFile('utf8')
if (blob !== 'testing\n') throw new Error(\`browser: read \${JSON.stringify(blob)}\`)
// the stub takes the node class's arguments and rejects rather than throwing
// at import time, which is what keeps a bundle that never reads a local file
// working
await new LocalFile('$FIXTURE').read(3, 0).then(
  () => { throw new Error('browser: LocalFile.read resolved, expected the stub') },
  e => { if (!/unimplemented/.test(e.message)) throw e },
)
console.log('browser: ok')
JS

node smoke.mjs
node smoke.cjs
node --conditions=browser smoke-browser.mjs
