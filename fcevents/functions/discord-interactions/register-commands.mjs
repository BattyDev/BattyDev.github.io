/* Registers the slash commands with Discord.
 *
 * Commands cannot be created from the Developer Portal UI -- they only exist
 * once something PUTs them to the API -- so this script is the registration
 * step, and it runs on YOUR machine, never in CI and never from an agent
 * session, because it needs a credential.
 *
 *   node register-commands.mjs
 *
 * It reads everything from the environment and prints nothing secret:
 *
 *   DISCORD_APP_ID       required -- Developer Portal -> General Information
 *   DISCORD_GUILD_ID     optional -- register to ONE server (see below)
 *
 * and then EITHER
 *
 *   DISCORD_BOT_TOKEN    Developer Portal -> Bot -> Reset Token
 *
 * or, if you would rather not create a bot user at all,
 *
 *   DISCORD_CLIENT_ID + DISCORD_CLIENT_SECRET
 *
 * the same pair already configured for Discord login. The script exchanges
 * those for a short-lived token scoped to applications.commands.update, which
 * is the least privilege that can do this job.
 *
 * GUILD VS GLOBAL. With DISCORD_GUILD_ID set, commands appear in that one
 * server within seconds. Without it they are registered globally, which Discord
 * caches for up to an hour before they show up anywhere. Use a guild id while
 * testing -- waiting an hour to find out you had a typo is a bad afternoon.
 *
 * Re-running is safe: PUT replaces the whole command set for that scope, so
 * this file is the single source of truth for what exists. Removing a command
 * here and re-running deletes it from Discord.
 */

const API = 'https://discord.com/api/v10';

const COMMANDS = [
  {
    name: 'events',
    description: 'Show upcoming Free Company events',
    /* Both integration_types and contexts are required for a command to be
       usable in a server under Discord's current model; omitting them leaves
       the command installable but invisible. 0 = guild install, 0/1/2 =
       usable in a guild, a DM with the app, and a group DM. */
    integration_types: [0],
    contexts: [0, 1, 2],
  },
];

const need = (k) => {
  const v = process.env[k];
  if (!v) {
    console.error(`Missing ${k}. See the comment at the top of this file.`);
    process.exit(1);
  }
  return v;
};

async function bearerFromClientCredentials(id, secret) {
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'applications.commands.update',
    }),
  });
  if (!res.ok) {
    console.error(`Could not get a client-credentials token: ${res.status}`);
    console.error(await res.text());
    process.exit(1);
  }
  return `Bearer ${(await res.json()).access_token}`;
}

const appId = need('DISCORD_APP_ID');
const guildId = process.env.DISCORD_GUILD_ID;

const auth = process.env.DISCORD_BOT_TOKEN
  ? `Bot ${process.env.DISCORD_BOT_TOKEN}`
  : await bearerFromClientCredentials(need('DISCORD_CLIENT_ID'), need('DISCORD_CLIENT_SECRET'));

const url = guildId
  ? `${API}/applications/${appId}/guilds/${guildId}/commands`
  : `${API}/applications/${appId}/commands`;

console.log(`Registering ${COMMANDS.length} command(s) ${guildId ? `to guild ${guildId}` : 'GLOBALLY (up to an hour to appear)'}…`);

const res = await fetch(url, {
  method: 'PUT',
  headers: { Authorization: auth, 'Content-Type': 'application/json' },
  body: JSON.stringify(COMMANDS),
});

if (!res.ok) {
  console.error(`Failed: ${res.status}`);
  console.error(await res.text());
  process.exit(1);
}

for (const c of await res.json()) console.log(`  ✓ /${c.name} — ${c.description}`);
console.log('Done.');
