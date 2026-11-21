/* FC Events · discord-interactions
 *
 * The HTTP endpoint Discord posts slash commands to. Deliberately NOT a gateway
 * bot: there is no always-on process here, nothing holding a websocket, and no
 * bot user in the member list. Discord makes an HTTPS request, this function
 * answers it, and that is the whole lifecycle.
 *
 * WHAT AUTHENTICATES THE CALLER
 *
 * Every other way into this project arrives with a Supabase JWT. This one never
 * will. Discord signs each request with Ed25519 over (timestamp + raw body),
 * and that signature is the ONLY thing making the caller trustworthy -- so it
 * is checked before the body is parsed, let alone acted on. A request that
 * fails the check gets 401 and touches nothing.
 *
 * That is also why this function is deployed with verify_jwt = false. It is not
 * an unauthenticated function; it authenticates differently, and Supabase's JWT
 * gate would reject Discord before our own check ever ran.
 *
 * WHY 401 SPECIFICALLY, AND WHY IT MATTERS
 *
 * When you save an Interactions Endpoint URL, Discord probes it with a
 * DELIBERATELY INVALID signature and refuses the URL unless it gets a 401. So
 * the failure path below is a feature Discord tests for, not just hygiene --
 * returning 400 or 500 there would make the endpoint unregisterable.
 *
 * WHAT IT MAY READ
 *
 * Nothing directly. It holds the service key, which bypasses RLS, so it is
 * restricted to a single RPC -- raid_discord_events() from migration 007 --
 * whose own SQL decides what a given Discord user may see. The authorisation
 * lives in the database, as it does everywhere else in this project; putting it
 * here would mean two copies of the rules in two languages, free to drift.
 *
 * The identity handed to that RPC is interaction.member.user.id, taken only
 * after the signature check. The RPC is granted to service_role alone precisely
 * because that parameter is an assertion: see the header of 007 for what would
 * go wrong if anybody else could make it.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const PAGE_URL = 'https://battydev.com/fcevents/';
const DISCORD_API = 'https://discord.com/api/v10';

/* Interaction and response types, from Discord's docs. Named rather than
   inlined as magic numbers -- `type: 5` at a call site says nothing. */
const T_PING = 1;
const T_COMMAND = 2;
const R_PONG = 1;
const R_MESSAGE = 4;
const R_DEFERRED = 5;
const EPHEMERAL = 64;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const hexToBytes = (hex: string) => {
  /* Reject anything that is not clean hex before allocating from a length we
     did not validate. A malformed signature is a 401, not an exception. */
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};

/* Deno exposes Ed25519 through Web Crypto, so there is no third-party crypto
   dependency here -- worth avoiding on the one code path whose correctness is
   the entire security model. Older runtimes named the algorithm NODE-ED25519;
   try the standard name first and fall back rather than pinning to a runtime
   version. */
async function importPublicKey(raw: Uint8Array): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
  } catch {
    return await crypto.subtle.importKey(
      'raw', raw, { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' } as unknown as AlgorithmIdentifier,
      false, ['verify'],
    );
  }
}

async function signatureValid(
  publicKeyHex: string, signatureHex: string, timestamp: string, rawBody: string,
): Promise<boolean> {
  const keyBytes = hexToBytes(publicKeyHex);
  const sigBytes = hexToBytes(signatureHex);
  if (!keyBytes || !sigBytes || keyBytes.length !== 32 || sigBytes.length !== 64) return false;
  try {
    const key = await importPublicKey(keyBytes);
    const msg = new TextEncoder().encode(timestamp + rawBody);
    return await crypto.subtle.verify({ name: (key.algorithm as { name: string }).name }, key, sigBytes, msg);
  } catch {
    return false;
  }
}

/* ---------- rendering ---------- */

type Ev = {
  id: string; title: string; status: string; mode: string;
  scheduled_at: string | null; min_level: number | null; level_rule: string | null;
  tanks_needed: number | null; healers_needed: number | null; dps_needed: number | null;
  party_size: number | null; signups: number; signed_up: boolean;
};

const comp = (e: Ev) => {
  const parts = [
    e.tanks_needed != null ? `${e.tanks_needed}T` : null,
    e.healers_needed != null ? `${e.healers_needed}H` : null,
    e.dps_needed != null ? `${e.dps_needed}D` : null,
  ].filter(Boolean);
  if (parts.length) return parts.join('/');
  return e.party_size ? `${e.party_size} spots` : 'Unlimited';
};

function line(e: Ev): string {
  const url = `${PAGE_URL}#/event/${e.id}`;
  /* <t:unix:F> renders in each reader's own timezone, which is the right answer
     for an FC spread across several -- and the reason this does not try to pick
     a zone the way the page does. */
  const when = e.scheduled_at
    ? (() => {
        const t = Math.floor(new Date(e.scheduled_at).getTime() / 1000);
        return `<t:${t}:F> · <t:${t}:R>`;
      })()
    : '*time not picked yet — add your hours*';

  const facts = [
    `${e.signups}${e.party_size ? `/${e.party_size}` : ''} signed up`,
    comp(e),
    e.min_level != null
      ? `Lv${e.min_level} ${e.level_rule === 'required' ? 'required' : 'rec.'}`
      : null,
    e.signed_up ? '✅ you\'re in' : null,
  ].filter(Boolean).join(' · ');

  return `**[${e.title.replace(/([\[\]])/g, '\\$1')}](${url})**\n${when}\n${facts}`;
}

function embedFor(payload: { linked: boolean; display_name: string | null; events: Ev[] }) {
  if (!payload.linked) {
    return {
      color: 0xd4722a,
      title: 'Not linked yet',
      description:
        `Sign in with Discord at [battydev.com/fcevents](${PAGE_URL}) once, and this ` +
        'command will know who you are. Nothing else to set up — it is the same Discord account.',
    };
  }
  if (!payload.events.length) {
    return {
      color: 0xc6a664,
      title: 'Nothing on the calendar',
      description: `No upcoming events. [Create one](${PAGE_URL}) — it takes about a minute.`,
    };
  }
  const body = payload.events.map(line).join('\n\n');
  return {
    color: 0xc6a664,
    title: `Upcoming FC events (${payload.events.length})`,
    /* Discord caps a description at 4096 characters. Ten events cannot get near
       that, but the limit is on the whole POST -- truncate on a whole entry
       rather than let Discord reject the lot. */
    description: body.length <= 3900 ? body : `${body.slice(0, 3900)}\n\n…`,
    footer: { text: 'Only you can see this · battydev.com/fcevents' },
  };
}

/* ---------- the deferred half ---------- */

/* Discord gives a slash command three seconds to reply. A cold start plus a
   database round trip can lose that race, and losing it shows the user "the
   application did not respond" with no way to retry cleanly. So every command
   defers immediately and edits its own reply here, which has a fifteen-minute
   window instead of three seconds. */
async function completeEvents(interaction: {
  application_id: string; token: string;
  member?: { user?: { id?: string } }; user?: { id?: string };
}) {
  const edit = (body: unknown) =>
    fetch(
      `${DISCORD_API}/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

  try {
    /* member.user for a command used in a server, user for a DM. */
    const discordId = interaction.member?.user?.id ?? interaction.user?.id;
    if (!discordId) {
      await edit({ content: 'Could not read your Discord user id from that interaction.' });
      return;
    }

    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) {
      await edit({ content: 'This command is not configured: the project URL or service key is missing.' });
      return;
    }

    const db = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await db.rpc('raid_discord_events', {
      p_discord_id: discordId,
      p_limit: 10,
    });
    if (error) {
      await edit({ content: `Could not read the events: ${error.message}` });
      return;
    }

    await edit({ embeds: [embedFor(data)] });
  } catch (err) {
    await edit({ content: `Something went wrong: ${err instanceof Error ? err.message : String(err)}` })
      .catch(() => { /* the interaction token may have expired; nothing left to do */ });
  }
}

/* ---------- entrypoint ---------- */

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const publicKey = Deno.env.get('DISCORD_PUBLIC_KEY');
  if (!publicKey) {
    /* Said plainly, matching announce-event: this is configuration, not a bug.
       Not a 401 -- Discord would read that as a signature failure and the
       message would never be seen. */
    return json({
      error: 'not_configured',
      message: 'DISCORD_PUBLIC_KEY is not set. Add it under Edge Functions → Secrets.',
    }, 503);
  }

  const signature = req.headers.get('x-signature-ed25519');
  const timestamp = req.headers.get('x-signature-timestamp');
  /* Read the body as TEXT before parsing: the signature covers the exact bytes
     Discord sent, and a JSON round trip would not reproduce them. */
  const rawBody = await req.text();

  if (!signature || !timestamp ||
      !(await signatureValid(publicKey, signature, timestamp, rawBody))) {
    return new Response('invalid request signature', { status: 401 });
  }

  let interaction: Record<string, unknown>;
  try {
    interaction = JSON.parse(rawBody);
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  if (interaction.type === T_PING) return json({ type: R_PONG });

  if (interaction.type === T_COMMAND) {
    const name = (interaction.data as { name?: string } | undefined)?.name;
    if (name === 'events') {
      /* Answer within the three-second window, then finish the work after the
         response has gone out. waitUntil keeps the isolate alive for it;
         without it the runtime may tear us down mid-fetch. */
      const work = completeEvents(interaction as Parameters<typeof completeEvents>[0]);
      const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(work);
      return json({ type: R_DEFERRED, data: { flags: EPHEMERAL } });
    }
    return json({
      type: R_MESSAGE,
      data: { content: `Unknown command: \`/${name ?? '?'}\``, flags: EPHEMERAL },
    });
  }

  /* Buttons and select menus arrive as other types. Nothing registers them yet,
     so answer rather than 500 -- an unhandled type is a bug in registration,
     and a silent failure would be harder to spot than this. */
  return json({
    type: R_MESSAGE,
    data: { content: 'That interaction type is not handled yet.', flags: EPHEMERAL },
  });
});
