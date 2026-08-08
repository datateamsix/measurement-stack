import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';

await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await build({
  entryPoints: [new URL('../src/meridian-consent.js', import.meta.url).pathname],
  outfile: new URL('../dist/meridian-consent.min.js', import.meta.url).pathname,
  bundle: false,
  minify: true,
  legalComments: 'none',
  target: ['es2020'],
});
const css = await readFile(new URL('../src/meridian-consent.css', import.meta.url), 'utf8');
await writeFile(new URL('../dist/meridian-consent.min.css', import.meta.url), css.replace(/\s+/g, ' ').replace(/\s*([{}:;,])\s*/g, '$1').trim());
await copyFile(new URL('../src/meridian-consent.js', import.meta.url), new URL('../dist/meridian-consent.js', import.meta.url));
console.log('Built Meridian Consent.');
