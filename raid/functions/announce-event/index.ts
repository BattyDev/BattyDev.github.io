/* BattyRaid · announce-event
 *
 * Posts an event to the FC's Discord channel through an incoming webhook.
 * Called from raid.js when the organiser presses "Announce to Discord".
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
 * solver lives in raid.js and porting it here would mean two copies of a
 * matching algorithm drifting apart, with Discord quietly disagreeing with the
 * page about who is playing. Instead this announces the facts the database
 * holds directly -- who signed up, in order, with the roles they offered and
 * any role the organiser pinned -- and links to the page for the live roster.
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
const PAGE_URL = 'https://battydev.com/raid/';

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

  const [{ data: ev, error: evErr }, { data: signups }, { data: dir }] = await Promise.all([
    db.from('raid_events').select('*').eq('id', eventId).single(),
    db.from('raid_event_signups').select('member_id, roles, assigned_role, seq')
      .eq('event_id', eventId).order('seq'),
    db.from('raid_member_directory').select('id, display_name'),
  ]);
  if (evErr || !ev) return json({ error: 'not_found' }, 404);

  const names = new Map((dir ?? []).map((m: any) => [m.id, m.display_name]));
  const roster = (signups ?? []).map((s: any, i: number) => {
    const name = names.get(s.member_id) ?? 'Unknown';
    const role = s.assigned_role
      ? `**${ROLE_LABEL[s.assigned_role]}**`
      : (s.roles ?? []).map((r: string) => ROLE_LABEL[r]).join('/');
    return `${i + 1}. ${name} — ${role}`;
  });

  const comp = [
    ev.tanks_needed != null ? `${ev.tanks_needed} Tank` : null,
    ev.healers_needed != null ? `${ev.healers_needed} Healer` : null,
    ev.dps_needed != null ? `${ev.dps_needed} DPS` : null,
  ].filter(Boolean).join(' · ')
    || (ev.party_size ? `${ev.party_size} spots` : 'Unlimited');

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: 'Composition', value: comp, inline: true },
    { name: 'Signed up', value: String(roster.length), inline: true },
  ];
  /* Added with migration 005; this function predated the column. */
  if (ev.min_level != null) {
    fields.push({
      name: 'Level',
      value: `${ev.min_level} ${ev.level_rule === 'required' ? 'required' : 'recommended'}`,
      inline: true,
    });
  }
  if (roster.length) {
    /* Discord caps an embed field at 1024 characters. Truncate on a whole line
       rather than letting the whole POST be rejected. */
    let list = '';
    let shown = 0;
    for (const line of roster) {
      if (list.length + line.length + 1 > 900) break;
      list += (list ? '\n' : '') + line;
      shown++;
    }
    if (shown < roster.length) list += `\n…and ${roster.length - shown} more`;
    fields.push({ name: 'Who', value: list });
  }

  /* Discord renders <t:unix:F> in each reader's own timezone, which is the
     right answer for an FC spread across several. */
  const when = ev.scheduled_at
    ? `<t:${Math.floor(new Date(ev.scheduled_at).getTime() / 1000)}:F> · <t:${
        Math.floor(new Date(ev.scheduled_at).getTime() / 1000)}:R>`
    : 'Time not picked yet — add your hours on the page.';

  const payload = {
    username: 'FC Events',
    embeds: [{
      title: String(ev.title).slice(0, 256),
      /* Straight to the event, now that events have their own links, rather
         than dropping the reader on the index to find it again. */
      url: `${PAGE_URL}#/event/${ev.id}`,
      description: [when, ev.description ? `\n${String(ev.description).slice(0, 1500)}` : '']
        .filter(Boolean).join('\n'),
      color: 0xc6a664,
      fields,
      footer: { text: ev.status === 'scheduled' ? 'Scheduled' : `Status: ${ev.status}` },
    }],
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
  return json({ ok: true, announced: roster.length });
});
