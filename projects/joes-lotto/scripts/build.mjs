import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, relative } from 'node:path';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}
const paths = (await walk(root)).map(path => relative(root, path).replaceAll('\\', '/'))
  .filter(path => !['sw.js', '_headers', '_redirects', 'netlify.toml'].includes(path) && !/\.(?:txt|md)$/i.test(path)).sort();
// OCR is optional and downloaded only when Joe first reads printed details.
// The app shell must remain installable without eagerly fetching every WASM variant.
const optional = paths.filter(path => path.startsWith('vendor/ocr/'));
const shell = paths.filter(path => !path.startsWith('vendor/ocr/'));
const hash = createHash('sha256');
for (const path of paths) { hash.update(path); hash.update(await readFile(resolve(root, path))); }
let sw = await readFile(resolve(root, 'sw.js'), 'utf8');
sw = sw.replace(/const CACHE_NAME=.*?;/, `const CACHE_NAME="joes-lotto-${hash.digest('hex').slice(0, 14)}";`)
  .replace(/const ASSETS=.*?;/, `const ASSETS=${JSON.stringify(shell)};`)
  .replace(/const OPTIONAL_ASSETS=.*?;/, `const OPTIONAL_ASSETS=${JSON.stringify(optional)};`);
await writeFile(resolve(root, 'sw.js'), sw);
console.log(`Updated offline app shell: ${shell.length} static assets; ${optional.length} OCR assets cached only on use. Public API requests are never cached by the service worker.`);
