import { expect, test } from 'vitest'

import { LocalFile } from '../src/browser.ts'

// the browser build swaps in a LocalFile stub; it has to stay constructible
// with the same argument as the real one, or `new LocalFile(path)` fails to
// compile in any bundle resolving the `browser` export condition
test('browser LocalFile stub takes a path and rejects every method', async () => {
  const f = new LocalFile('/some/file/path.txt')

  await expect(f.read()).rejects.toThrow(/unimplemented/)
  await expect(f.readFile()).rejects.toThrow(/path\.txt/)
  await expect(f.stat()).rejects.toThrow(/unimplemented/)
  await expect(f.close()).rejects.toThrow(/unimplemented/)
})
