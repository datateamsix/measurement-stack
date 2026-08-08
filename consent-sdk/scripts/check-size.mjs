import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const budget = 12 * 1024;
const files = ['measurestack-consent.min.js', 'measurestack-consent.min.css'];
let total = 0;
for (const file of files) {
  const contents = await readFile(new URL(`../dist/${file}`, import.meta.url));
  const gzip = gzipSync(contents).byteLength;
  total += gzip;
  console.log(`${file}: ${gzip} bytes gzip`);
}
console.log(`Total: ${total} bytes gzip (budget: ${budget} bytes)`);
if (total > budget) process.exitCode = 1;
