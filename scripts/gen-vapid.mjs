// Generates the keypair that lets the app send push notifications.
// Writes them into .dev.vars (local) and prints the commands for production.
import { webcrypto as crypto } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
const pub = Buffer.from(await crypto.subtle.exportKey('raw', kp.publicKey)).toString('base64url');
const priv = JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d });

let vars = existsSync('.dev.vars') ? readFileSync('.dev.vars', 'utf8') : '';
vars = vars.replace(/^VAPID_(PUBLIC_KEY|PRIVATE_JWK)=.*\n?/gm, '');
vars = vars.trimEnd() + `\nVAPID_PUBLIC_KEY=${pub}\nVAPID_PRIVATE_JWK=${priv}\n`;
writeFileSync('.dev.vars', vars.trimStart());

console.log('Push keys written to .dev.vars.');
console.log('Deploying? These are uploaded for you by DEPLOY.bat. Keep .dev.vars private.');
