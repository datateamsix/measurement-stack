function hex(buffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqualHex(left, right) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

export function parseStripeSignature(header) {
  const output = { timestamp: 0, signatures: [] };
  String(header || '').split(',').forEach((part) => {
    const [key, value] = part.split('=', 2);
    if (key === 't') output.timestamp = Number(value);
    if (key === 'v1' && value) output.signatures.push(value);
  });
  return output;
}

export async function verifyStripeSignature(rawBody, header, secret, toleranceSeconds = 300) {
  const parsed = parseStripeSignature(header);
  if (!parsed.timestamp || !parsed.signatures.length || !secret) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp) > toleranceSeconds) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${parsed.timestamp}.${rawBody}`),
  );
  const expected = hex(signature);
  return parsed.signatures.some((candidate) => timingSafeEqualHex(expected, candidate));
}
