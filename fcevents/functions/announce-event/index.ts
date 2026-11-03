/* FC Events · announce-event
 *
 * Posts an event to the FC's Discord channel through an incoming webhook.
 * Called from fcevents.js when the organiser presses "Announce to Discord".
 *
 * WHY THIS IS A FUNCTION AND NOT A fetch() FROM THE PAGE
 *
 * A Discord webhook URL is a bearer credential: anyone holding it can post to
 * the channel as often as they like, forever, with no way to tell who did. It
 * cannot go in config.js next to the publishable key, because the publishable
 * key is safe to expose (RLS decides what it can reach) and the webhook is not.
 * So it lives as a Supabase secret, readable only in here.
 *
 * AUTHORISATION IS STILL THE DATABASE'S CALL
 *
 * This function does not re-implement "who may announce". It forwards the
 * caller's own JWT to Postgres and asks raid_can_manage_event(), which is the
 * same check the UPDATE policy on raid_events uses. So the answer cannot drift
 * from the rest of the app, and a caller with no JWT gets auth.uid() = NULL,
 * which returns false. The webhook is never reachable by an anonymous request.
 *
 * ON THE ROSTER: this deliberately does NOT re-solve the seat assignment. That
 * solver lives in fcevents.js and porting it here would mean two copies of a
 * matching algorithm drifting apart, with Discord quietly disagreeing with the
 * page about who is playing. Instead this announces the facts the database
 * holds directly -- who signed up, in order, with the roles they offered and
 * any role the organiser pinned -- and links to the page for the live roster.
 *
 * ON NAMES: the page leads with the FFXIV character and shows the Discord
 * handle as a tag, dropping the tag when the two are the same. displayFor() in
 * fcevents.js is the rule; nameFor() below is the same rule, because an
 * announcement that calls somebody batty_jjk when the site calls them Cedho
 * Nalen reads as two different applications.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const ROLE_LABEL: Record<string, string> = { tank: 'Tank', healer: 'Healer', dps: 'DPS' };
/* Unicode rather than custom server emoji: a custom emoji would need uploading
   to the guild and would render as raw :shortcode: anywhere it is not installed.
   These three read at a glance and cost nothing. */
const ROLE_EMOJI: Record<string, string> = { tank: '🛡️', healer: '💚', dps: '⚔️' };
const PAGE_URL = 'https://battydev.com/fcevents/';
const GOLD = 0xc6a664;
const WARN = 0xd4722a;

type Ev = {
  id: string; title: string; description: string | null; status: string;
  scheduled_at: string | null;
  tanks_needed: number | null; healers_needed: number | null; dps_needed: number | null;
  party_size: number | null; min_level: number | null; level_rule: string | null;
  created_by: string;
};
type Signup = { member_id: string; roles: string[] | null; assigned_role: string | null };
type Person = { display_name: string; avatar_url: string | null; character: string | null };

/* Same comparison fcevents.js uses: plenty of people play a character with
   their own Discord name, and printing it twice reads as a rendering bug. */
const slug = (v: string | null) => String(v ?? '').toLowerCase();

function nameFor(p: Person | undefined): string {
  if (!p) return 'Unknown';
  const character = p.character;
  if (!character) return p.display_name;
  return slug(character) === slug(p.display_name)
    ? character
    : `${character} (${p.display_name})`;
}

/* The author line is a credit, not an identification -- the character alone
   carries it. The roster keeps the handle because that is the line somebody
   reads when they want to know who to ping, and "Batty Jjk" does not tell you
   to type @batty_jjk. */
const creditFor = (p: Person | undefined) =>
  p ? (p.character || p.display_name) : 'Unknown';

/* Total seats: an explicit party size when there is one, otherwise the sum of
   whatever per-role requirements are set. Both can be absent, which is what
   "unlimited" means -- and then there is no such thing as a spot left. */
function seats(ev: Ev): number | null {
  if (ev.party_size != null) return ev.party_size;
  const roles = [ev.tanks_needed, ev.healers_needed, ev.dps_needed].filter((n) => n != null) as number[];
  return roles.length ? roles.reduce((a, b) => a + b, 0) : null;
}

/* Discord markdown quotes one line at a time, so a multi-line description needs
   the marker on every line or only its first line is quoted. */
const quote = (text: string) => text.split('\n').map((l) => `> ${l}`).join('\n');

export function buildEmbed(ev: Ev, signups: Signup[], people: Map<string, Person>) {
  const cancelled = ev.status === 'cancelled';
  const total = seats(ev);

  /* <t:unix:F> renders in each reader's own timezone, which is the right answer
     for an FC spread across several. */
  const when = ev.scheduled_at
    ? (() => {
        const t = Math.floor(new Date(ev.scheduled_at).getTime() / 1000);
        return `🗓️ **<t:${t}:F>** · <t:${t}:R>`;
      })()
    : '🗓️ *Time not picked yet — add your hours on the page.*';

  const comp = [
    ev.tanks_needed   != null ? `${ROLE_EMOJI.tank} ${ev.tanks_needed}` : null,
    ev.healers_needed != null ? `${ROLE_EMOJI.healer} ${ev.healers_needed}` : null,
    ev.dps_needed     != null ? `${ROLE_EMOJI.dps} ${ev.dps_needed}` : null,
  ].filter(Boolean).join('  ');

  const left = total != null ? Math.max(0, total - signups.length) : null;
  const party = [
    comp || (total != null ? `${total} spots` : 'Unlimited'),
    total != null
      ? (left === 0 ? '**full**' : `**${left} spot${left === 1 ? '' : 's'} left**`)
      : null,
  ].filter(Boolean).join('  ·  ');

  /* Facts first, then the organiser's own words. Keeping them apart -- and
     quoting theirs -- stops a long description burying the time and the count,
     which are the two things somebody scrolling a channel is actually after. */
  const blocks = [
    cancelled ? '### ⚠️ Cancelled' : null,
    when,
    party,
    ev.min_level != null
      ? `📈 Level ${ev.min_level} ${ev.level_rule === 'required' ? 'required' : 'recommended'}`
      : null,
    ev.description ? `\n${quote(String(ev.description).slice(0, 1200))}` : null,
  ].filter(Boolean);

  /* Signup order is the backup queue, so the numbers are load-bearing, not
     decoration. A pinned role is the organiser's decision and is named; an
     unpinned one shows what the person offered, as icons. */
  const roster = signups.map((s, i) => {
    const who = nameFor(people.get(s.member_id));
    const role = s.assigned_role
      ? `${ROLE_EMOJI[s.assigned_role]} **${ROLE_LABEL[s.assigned_role]}**`
      : (s.roles ?? []).map((r) => ROLE_EMOJI[r] ?? ROLE_LABEL[r]).join(' ');
    return `\`${String(i + 1).padStart(2, ' ')}\` ${who} · ${role}`;
  });

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
  if (roster.length) {
    /* Discord caps a field value at 1024 characters. Truncate on a whole line
       rather than letting the entire POST be rejected. */
    let list = '';
    let shown = 0;
    for (const l of roster) {
      if (list.length + l.length + 1 > 900) break;
      list += (list ? '\n' : '') + l;
      shown++;
    }
    if (shown < roster.length) list += `\n…and ${roster.length - shown} more`;
    fields.push({
      name: `Signed up — ${signups.length}${total != null ? `/${total}` : ''}`,
      value: list,
    });
  } else {
    fields.push({
      name: 'Signed up — nobody yet',
      value: `[Be the first](${PAGE_URL}#/event/${ev.id}) 👀`,
    });
  }

  const organiser = people.get(ev.created_by);

  return {
    author: organiser
      ? {
          name: `Organised by ${creditFor(organiser)}`,
          ...(organiser.avatar_url ? { icon_url: organiser.avatar_url } : {}),
        }
      : undefined,
    title: String(ev.title).slice(0, 256),
    url: `${PAGE_URL}#/event/${ev.id}`,
    description: blocks.join('\n'),
    color: cancelled ? WARN : GOLD,
    fields,
    footer: { text: 'battydev.com/fcevents' },
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const webhook = Deno.env.get('DISCORD_WEBHOOK_URL');
  if (!webhook) {
    /* Said plainly so the page can show something actionable rather than a
       generic failure. This is configuration, not a bug. */
    return json({
      error: 'not_configured',
      message: 'DISCORD_WEBHOOK_URL is not set. Add it under Edge Functions → Secrets.',
    }, 503);
  }
  if (!/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(webhook)) {
    return json({
      error: 'not_configured',
      message: 'DISCORD_WEBHOOK_URL does not look like a Discord webhook URL.',
    }, 503);
  }

  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'unauthorized' }, 401);

  let eventId: string | undefined;
  try {
    eventId = (await req.json())?.event_id;
  } catch {
    return json({ error: 'bad_request', message: 'Expected JSON with event_id.' }, 400);
  }
  if (!eventId || !/^[0-9a-f-]{36}$/i.test(eventId)) {
    return json({ error: 'bad_request', message: 'Expected a uuid event_id.' }, 400);
  }

  /* The caller's own token, not the service role: every read below is filtered
     by exactly the policies that would apply in the browser. */
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  if (!url || !key) {
    return json({ error: 'not_configured', message: 'Project URL or publishable key missing.' }, 503);
  }
  const db = createClient(url, key, { global: { headers: { Authorization: auth } } });

  const { data: mayManage, error: checkErr } = await db.rpc('raid_can_manage_event', {
    p_event: eventId,
  });
  /* A failure here is overwhelmingly "EXECUTE was denied", which is what an
     anonymous or non-member caller gets, since raid_can_manage_event is
     granted to authenticated only. That is a refusal, not a server fault --
     reporting it as 500 would invite a retry loop over something that will
     never succeed. */
  if (checkErr || !mayManage) return json({ error: 'forbidden' }, 403);

  const [{ data: ev, error: evErr }, { data: signups }, { data: dir }, { data: chars }] =
    await Promise.all([
      db.from('raid_events').select('*').eq('id', eventId).single(),
      db.from('raid_event_signups').select('member_id, roles, assigned_role, seq')
        .eq('event_id', eventId).order('seq'),
      db.from('raid_member_directory').select('id, display_name, avatar_url'),
      /* Opened to every member by 003, which is what lets an announcement lead
         with the character the way the page does. */
      db.from('raid_characters').select('member_id, character_name'),
    ]);
  if (evErr || !ev) return json({ error: 'not_found' }, 404);

  /* First claim per member, matching charsOf(...)[0] on the page. */
  const firstChar = new Map<string, string>();
  for (const c of (chars ?? []) as Array<{ member_id: string; character_name: string }>) {
    if (!firstChar.has(c.member_id)) firstChar.set(c.member_id, c.character_name);
  }
  const people = new Map(
    ((dir ?? []) as Array<{ id: string; display_name: string; avatar_url: string | null }>)
      .map((m) => [m.id, {
        display_name: m.display_name,
        avatar_url: m.avatar_url,
        character: firstChar.get(m.id) ?? null,
      }]),
  );

  const payload = {
    username: 'FC Events',
    embeds: [buildEmbed(ev as never, (signups ?? []) as never, people as never)],
    /* Nothing in here should ever ping a role or @everyone: the text is
       user-supplied event titles and descriptions, and an organiser should not
       be able to mass-ping the server through a scheduler. */
    allowed_mentions: { parse: [] },
  };

  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return json({ error: 'discord_failed', status: res.status, detail: detail.slice(0, 500) }, 502);
  }
  return json({ ok: true, announced: (signups ?? []).length });
});
