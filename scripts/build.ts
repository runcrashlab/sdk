// Builds @runcrashlab/sdk for npm: plain JavaScript in dist/, so it runs from node_modules
// (Node does not strip TypeScript types inside node_modules). Uses Node's built-in type stripping,
// so there is no compiler dependency. TypeScript users get types from src/index.ts.
//
//   npm run build

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const source = await readFile(path.join(pkg, 'src/index.ts'), 'utf8');

const js = stripTypeScriptTypes(source, { mode: 'strip' });
await mkdir(path.join(pkg, 'dist'), { recursive: true });
await writeFile(path.join(pkg, 'dist/index.js'), `// Built from src/index.ts by scripts/build.ts. Do not edit.\n${js}`);

// Sanity check: the built file must load as plain JavaScript and expose the public API.
const mod = await import(`${path.join(pkg, 'dist/index.js').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:')}?t=${Date.now()}`);
for (const name of ['createClient', 'createCrashlabClient', 'runAgent', 'CrashlabError']) {
  if (typeof mod[name] !== 'function') throw new Error(`dist/index.js is missing export ${name}`);
}
console.log('Built dist/index.js');
