// Creates the RSA key that fixes the extension ID. The private key goes to
// .keys/iris.pem (gitignored); the public key goes in the manifest's `key` field.
// An existing key is reused, so running this again never changes the ID.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const keyDir = join(import.meta.dirname, '..', '.keys');
const keyPath = join(keyDir, 'iris.pem');

if (!existsSync(keyPath)) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  mkdirSync(keyDir, { recursive: true });
  writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.log(`New private key written to ${keyPath}. Keep it safe; it fixes the extension ID.`);
}

const publicDer = createPublicKey(createPrivateKey(readFileSync(keyPath))).export({
  type: 'spki',
  format: 'der',
});
// Chrome's ID: the first 32 hex digits of the key's SHA-256, written with the letters a–p.
const id = [...createHash('sha256').update(publicDer).digest('hex').slice(0, 32)]
  .map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
  .join('');

console.log(`Manifest key: ${publicDer.toString('base64')}`);
console.log(`Extension ID: ${id}`);
