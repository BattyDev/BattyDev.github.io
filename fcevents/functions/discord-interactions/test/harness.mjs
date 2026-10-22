/* Test harness for the discord-interactions Edge Function.
 *
 *   node --experimental-strip-types test/harness.mjs
 *
 * Runs the REAL handler -- index.ts is loaded as written, with only Deno's
 * globals faked and the Supabase client stubbed. The signature path is
 * exercised with genuine Ed25519 keys rather than a mock, because that path is
 * the entire security model: everything else here trusts the request only
 * because it verified.
 *
 * Node is used rather than Deno because there is no Deno in this environment,
 * and Node 22 has both Ed25519 in Web Crypto and TypeScript type-stripping.
 * That makes the runtime an approximation in exactly one place -- if Supabase's
 * edge runtime ever named the algorithm differently, this would not catch it,
 * which is why importPublicKey() in index.ts tries both spellings.
 */

import { webcrypto } from 'node:crypto';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/* index.ts imports the Supabase client from jsr:, which Node cannot resolve.
   Rewrite that one line into a local stub and load the copy -- everything else
   about the module, including every code path under test, is untouched. */
const work = mkdtempSync(join(tmpdir(), 'fc-discord-'));
writeFileSync(join(work, 'supabase-stub.mjs'), `
export function createClient(url, key) {
  return {
    rpc: async (name, args) => {
      globalThis.__rpcCalls.push({ name, args, key });
      const r = globalThis.__rpcResult;
      return typeof r === 'function' ? r(args) : r;
    },
  };
}
`);
const source = readFileSync(join(HERE, '..', 'index.ts'), 'utf8');
const rewritten = source.replace(
  /^import \{ createClient \} from 'jsr:@supabase\/supabase-js@2';$/m,
  "import { createClient } from './supabase-stub.mjs';",
);
if (rewritten === source) {
  console.error('Could not rewrite the supabase-js import -- has index.ts changed?');
  process.exit(1);
}
writeFileSync(join(work, 'fn.ts'), rewritten);

/* Node 22 already exposes a global webcrypto; alias it rather than reassign,
   since globalThis.crypto is getter-only. */
const crypto = globalThis.crypto ?? webcrypto;

const results = [];
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) console.log(`      expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
};

/* ---- fake Deno ---- */
let ENV = {};
let waited = [];
globalThis.Deno = {
  serve: (fn) => { globalThis.__handler = fn; },
  env: { get: (k) => ENV[k] },
};
globalThis.EdgeRuntime = { waitUntil: (p) => { waited.push(p); } };

/* ---- capture outbound calls to Discord ---- */
let sent = [];
globalThis.fetch = async (url, init) => {
  sent.push({ url, method: init?.method, body: JSON.parse(init?.body || '{}') });
  return new Response('{}', { status: 200 });
};

globalThis.__rpcCalls = [];
globalThis.__rpcResult = { data: null, error: null };

await import(pathToFileURL(join(work, 'fn.ts')).href);
const handler = globalThis.__handler;

/* ---- real Ed25519 keys ---- */
const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const PUBLIC_KEY = hex(rawPub);

async function signed(bodyObj, { key = pair.privateKey, ts = String(Math.floor(Date.now() / 1000)), tamper = null } = {}) {
  const body = JSON.stringify(bodyObj);
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'Ed25519' }, key, new TextEncoder().encode(ts + body)));
  return new Request('https://x/discord-interactions', {
    method: 'POST',
    headers: {
      'x-signature-ed25519': hex(sig),
      'x-signature-timestamp': ts,
      'content-type': 'application/json',
    },
    body: tamper ?? body,
  });
}

const PING = { type: 1 };
const CMD = (name = 'events', discordId = '100000000000000002') => ({
  type: 2, application_id: 'app123', token: 'tok456',
  data: { name },
  member: { user: { id: discordId } },
});

console.log('\n=== A. configuration ===');
ENV = {};
let res = await handler(await signed(PING));
check('with no public key set it is 503, not 401', res.status, 503);
check('and says which secret is missing',
  (await res.clone().json()).message.includes('DISCORD_PUBLIC_KEY'), true);

ENV = { DISCORD_PUBLIC_KEY: PUBLIC_KEY, SUPABASE_URL: 'https://stub.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
check('a GET is refused', (await handler(new Request('https://x', { method: 'GET' }))).status, 405);

console.log('\n=== B. the signature check IS the auth ===');
res = await handler(await signed(PING));
check('a correctly signed PING gets a PONG', await res.json(), { type: 1 });

const other = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
res = await handler(await signed(PING, { key: other.privateKey }));
check('a signature from the wrong key is 401', res.status, 401);

res = await handler(await signed(PING, { tamper: JSON.stringify({ type: 2 }) }));
check('a tampered body is 401 (signature covers the bytes)', res.status, 401);

const noHeaders = new Request('https://x', { method: 'POST', body: '{"type":1}' });
check('no signature headers at all is 401', (await handler(noHeaders)).status, 401);

const badHex = new Request('https://x', {
  method: 'POST',
  headers: { 'x-signature-ed25519': 'zzzz', 'x-signature-timestamp': '1' },
  body: '{"type":1}',
});
check('a non-hex signature is 401, not a crash', (await handler(badHex)).status, 401);

const shortSig = new Request('https://x', {
  method: 'POST',
  headers: { 'x-signature-ed25519': 'ab', 'x-signature-timestamp': '1' },
  body: '{"type":1}',
});
check('a wrong-length signature is 401', (await handler(shortSig)).status, 401);

/* Discord replays the timestamp into the signed message, so a stale timestamp
   cannot be lifted onto a different body -- but an OLD signed request is still
   valid forever. Recorded as a known property, not a passing assertion. */
res = await handler(await signed(PING, { ts: '1000000000' }));
check('an old timestamp still verifies (replay is Discord\'s to bound)', res.status, 200);

console.log('\n=== C. /events defers inside the 3s window ===');
sent = []; waited = []; globalThis.__rpcCalls = [];
globalThis.__rpcResult = {
  data: {
    linked: true, display_name: 'Cedho Nalen', is_leader: false,
    events: [{
      id: 'e1', title: 'Soonest fixed', status: 'scheduled', mode: 'fixed',
      scheduled_at: '2026-09-10T23:00:00Z', min_level: 100, level_rule: 'required',
      tanks_needed: 2, healers_needed: 2, dps_needed: 4, party_size: 8,
      signups: 3, signed_up: true,
    }],
  },
  error: null,
};
res = await handler(await signed(CMD()));
check('the immediate reply is a deferred, ephemeral ack',
  await res.json(), { type: 5, data: { flags: 64 } });
check('and the work was handed to waitUntil', waited.length, 1);
await Promise.all(waited);

check('exactly one RPC was called', globalThis.__rpcCalls.map((c) => c.name), ['raid_discord_events']);
check('with the Discord id from the signed payload',
  globalThis.__rpcCalls[0].args.p_discord_id, '100000000000000002');
check('using the service key',  globalThis.__rpcCalls[0].key, 'svc');

check('it edits its own original reply', sent.length, 1);
check('by PATCH to @original', sent[0].method, 'PATCH');
check('at the app+token URL from the interaction',
  sent[0].url, 'https://discord.com/api/v10/webhooks/app123/tok456/messages/@original');

const embed = sent[0].body.embeds[0];
check('the embed counts the events', embed.title, 'Upcoming FC events (1)');
check('links straight to the event',
  embed.description.includes('https://battydev.com/fcevents/#/event/e1'), true);
check('renders the time for the reader\'s own zone',
  embed.description.includes('<t:1789081200:F>'), true);
check('shows signups against party size', embed.description.includes('3/8 signed up'), true);
check('shows the composition', embed.description.includes('2T/2H/4D'), true);
check('shows a required level', embed.description.includes('Lv100 required'), true);
check('tells the asker they are already in', embed.description.includes('you\'re in'), true);

console.log('\n=== D. the two empty cases read differently ===');
sent = []; waited = [];
globalThis.__rpcResult = { data: { linked: false, display_name: null, is_leader: false, events: [] }, error: null };
await handler(await signed(CMD('events', '999999999999999999')));
await Promise.all(waited);
check('an unlinked user is told to sign in once', sent[0].body.embeds[0].title, 'Not linked yet');
check('and given the link', sent[0].body.embeds[0].description.includes('battydev.com/fcevents'), true);

sent = []; waited = [];
globalThis.__rpcResult = { data: { linked: true, display_name: 'Cedho', is_leader: false, events: [] }, error: null };
await handler(await signed(CMD()));
await Promise.all(waited);
check('a linked user with nothing on is invited to create one',
  sent[0].body.embeds[0].title, 'Nothing on the calendar');

console.log('\n=== E. failure paths reach the user, not the log ===');
sent = []; waited = [];
globalThis.__rpcResult = { data: null, error: { message: 'permission denied' } };
await handler(await signed(CMD()));
await Promise.all(waited);
check('an RPC error is reported in the reply',
  sent[0].body.content.includes('permission denied'), true);

sent = []; waited = [];
ENV = { DISCORD_PUBLIC_KEY: PUBLIC_KEY };
globalThis.__rpcResult = { data: null, error: null };
await handler(await signed(CMD()));
await Promise.all(waited);
check('a missing service key is reported, not silent',
  sent[0].body.content.includes('service key'), true);

console.log('\n=== F. unhandled shapes ===');
ENV = { DISCORD_PUBLIC_KEY: PUBLIC_KEY, SUPABASE_URL: 'https://stub.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
res = await handler(await signed(CMD('nope')));
let b = await res.json();
check('an unregistered command says so, ephemerally', [b.type, b.data.flags], [4, 64]);
check('and names the command', b.data.content.includes('/nope'), true);

res = await handler(await signed({ type: 3, application_id: 'a', token: 't' }));
b = await res.json();
check('a button press is answered rather than 500ing', b.type, 4);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
