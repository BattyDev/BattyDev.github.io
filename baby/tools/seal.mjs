#!/usr/bin/env node
/* BattyDev · Baby — seal/open the encrypted data file
 *
 * The site is static, so anything published is readable by anyone. /baby only
 * ever publishes data.enc.json: the dashboard JSON encrypted with AES-256-GCM
 * under a key stretched from a passphrase (PBKDF2-SHA256). baby.js does the same
 * derivation in the browser with WebCrypto, so the passphrase never leaves the
 * device and the plaintext never reaches the repository.
 *
 *   node baby/tools/seal.mjs open              data.enc.json -> data.json (edit this)
 *   node baby/tools/seal.mjs seal              data.json     -> data.enc.json (commit this)
 *   node baby/tools/seal.mjs seal --new-passphrase   set or change the passphrase
 *   node baby/tools/seal.mjs seal path/to/other.json   seal a different file
 *
 * data.json is gitignored. Do not commit it, and do not delete it in a hurry
 * either: it is the only plaintext copy.
 *
 * The passphrase is read from BABY_PASSPHRASE if set, otherwise prompted for.
 * Because the ciphertext is public, it can be attacked offline with no rate
 * limit: use several random words, not a PIN. */

import { readFile, writeFile, access } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { subtle } = globalThis.crypto;
const getRandomValues = (a) => globalThis.crypto.getRandomValues(a);

const BABY_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENC_PATH = join(BABY_DIR, 'data.enc.json');
const PLAIN_PATH = join(BABY_DIR, 'data.json');

/* OWASP's 2023 figure for PBKDF2-HMAC-SHA256. Takes well under a second in a
   browser; stored in the file so it can be raised later without breaking it. */
const ITERATIONS = 600000;

const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

async function deriveKey(passphrase, salt, iterations) {
  const base = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function decrypt(envelope, passphrase) {
  const key = await deriveKey(passphrase, unb64(envelope.salt), envelope.iter);
  try {
    const pt = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(envelope.iv) }, key, unb64(envelope.ct));
    return new TextDecoder().decode(pt);
  } catch {
    throw new Error('Wrong passphrase (or the file is damaged).');
  }
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

function prompt(question) {
  if (!process.stdin.isTTY) throw new Error('No terminal to prompt on; set BABY_PASSPHRASE.');
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    /* Echo nothing while the passphrase is typed. */
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => {
      rl.output.write('\n');
      rl.close();
      done(answer);
    });
  });
}

async function passphrase(question) {
  return process.env.BABY_PASSPHRASE ?? prompt(question);
}

async function open(outPath = PLAIN_PATH) {
  const envelope = JSON.parse(await readFile(ENC_PATH, 'utf8'));
  const text = await decrypt(envelope, await passphrase('Passphrase: '));
  await writeFile(outPath, text);
  console.log(`Decrypted to ${outPath}. Edit it, then run "seal".`);
}

async function seal(inPath = PLAIN_PATH, { newPassphrase = false } = {}) {
  const text = await readFile(inPath, 'utf8');
  JSON.parse(text); // refuse to encrypt something the page cannot parse

  let salt;
  let pass;
  if (newPassphrase || !(await exists(ENC_PATH))) {
    pass = await passphrase('New passphrase: ');
    if (!process.env.BABY_PASSPHRASE && pass !== await prompt('Repeat it: ')) {
      throw new Error('Passphrases did not match; nothing written.');
    }
    if (pass.length < 12) console.warn('Warning: short passphrase. The file is public and can be guessed at offline.');
    salt = getRandomValues(new Uint8Array(16));
  } else {
    /* Same passphrase as the published file: prove it decrypts first, so a typo
       cannot silently lock everyone out. Keeping the salt means a browser that
       remembered the key stays unlocked across updates. */
    const old = JSON.parse(await readFile(ENC_PATH, 'utf8'));
    pass = await passphrase('Passphrase: ');
    await decrypt(old, pass);
    salt = unb64(old.salt);
  }

  const key = await deriveKey(pass, salt, ITERATIONS);
  const iv = getRandomValues(new Uint8Array(12)); // fresh every time: never reuse an IV under GCM
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));

  const envelope = { v: 1, kdf: 'PBKDF2-SHA256', iter: ITERATIONS, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  await writeFile(ENC_PATH, `${JSON.stringify(envelope, null, 2)}\n`);
  console.log(`Sealed ${inPath} into ${ENC_PATH}. Commit that file, never data.json.`);
}

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith('--')));
const [file] = rest.filter((a) => !a.startsWith('--'));

try {
  if (cmd === 'open') await open(file && resolve(file));
  else if (cmd === 'seal') await seal(file && resolve(file), { newPassphrase: flags.has('--new-passphrase') });
  else {
    console.log('Usage: node baby/tools/seal.mjs open | seal [file] [--new-passphrase]');
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
