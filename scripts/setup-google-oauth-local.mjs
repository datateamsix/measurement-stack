import { chmod, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const credentialsPath = path.join(root, '.secrets', 'google-oauth-client.json');
const varsPath = path.join(root, '.dev.vars');

function parseVars(source) {
  const vars = new Map();
  for (const line of source.split(/\r?\n/u)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (match) vars.set(match[1], match[2]);
  }
  return vars;
}

const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'));
const web = credentials.web;
if (!web?.client_id || !web?.client_secret || !Array.isArray(web.redirect_uris)) {
  throw new Error('Expected a Google OAuth web-client credential file.');
}

const redirectUri = 'http://127.0.0.1:3000/api/integrations/google/callback';
if (!web.redirect_uris.includes(redirectUri)) {
  throw new Error(`The OAuth client must register this exact redirect URI: ${redirectUri}`);
}

let existing = '';
try {
  existing = await readFile(varsPath, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const vars = parseVars(existing);
vars.set('GOOGLE_CLIENT_ID', web.client_id);
vars.set('GOOGLE_CLIENT_SECRET', web.client_secret);
vars.set('GOOGLE_OAUTH_REDIRECT_URI', redirectUri);
vars.set('MERIDIAN_GTM_TEST_MODE', 'true');
if (!vars.has('OAUTH_SESSION_SECRET')) vars.set('OAUTH_SESSION_SECRET', randomBytes(32).toString('base64url'));
if (!vars.has('OAUTH_TOKEN_ENCRYPTION_KEY')) vars.set('OAUTH_TOKEN_ENCRYPTION_KEY', randomBytes(32).toString('base64url'));
vars.delete('GOOGLE_OAUTH_CLIENT_CONFIG_PATH');

const output = `${Array.from(vars.entries()).map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
await writeFile(varsPath, output, { mode: 0o600 });
await chmod(varsPath, 0o600);
console.log('Local Google OAuth variables are configured; secret values were not printed.');
