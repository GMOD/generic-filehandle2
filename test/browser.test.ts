import { expect, test } from 'vitest'

import { LocalFile } from '../src/browser.ts'

// the browser build swaps in a LocalFile stub; every call written against the
// node class has to keep compiling in a bundle resolving the `browser` export
// condition, so the calls below are typechecked as much as run
test('browser LocalFile stub takes a path and rejects every method', async () => {
  const f = new LocalFile('/some/file/path.txt', { cacheFd: false })

  await expect(f.read(10, 0)).rejects.toThrow(/unimplemented/)
  await expect(f.readFile('utf8')).rejects.toThrow(/path\.txt/)
  await expect(f.readFile()).rejects.toThrow(/path\.txt/)
  await expect(f.stat()).rejects.toThrow(/unimplemented/)
  await expect(f.close()).rejects.toThrow(/unimplemented/)
})
