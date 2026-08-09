import { copyFile, mkdir } from 'node:fs/promises';

const source = new URL('../consent-sdk/dist/', import.meta.url);
const destination = new URL('../public/consent/', import.meta.url);
const assets = [
  'meridian-consent.min.js',
  'meridian-consent.min.css',
  'meridian-consent-analytics.min.js',
];

await mkdir(destination, { recursive: true });
await Promise.all(assets.map((asset) => copyFile(new URL(asset, source), new URL(asset, destination))));
console.log(`Synced ${assets.length} Meridian Consent assets into public/consent/.`);
