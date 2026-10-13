# AGENTS.md — /baby

Scope: **this directory.** Read the root `AGENTS.md` first; this file adds to it.

`battydev.com/baby` is a private section for following a pregnancy and saving
up for the baby. It is unlisted and locked. It has its own front page (a hub
of section tiles), and each section is a sub-folder:

```
baby/
  index.html            /baby              hub: one tile per section
  progress/             /baby/progress     week by week, month by month, visits
  savings/              /baby/savings      the stack, item by item, accounts, history
  shared/
    lock.js             the passphrase gate, decryption, shared helpers (BB.*)
    baby.css            shared skin (copied from /health's chrome)
    weeks.js            general pregnancy content, keyed by week. Date-free.
    savings-model.js    pure ledger maths, used by the hub tile and /savings
  tools/seal.mjs        encrypt data.json -> data.enc.json (and back)
  data.enc.json         THE DATA, encrypted. The only data file ever committed.
  data.sample.json      schema example with placeholder dates. Committed.
  data.json             plaintext working copy. GITIGNORED. Never commit.
```

## The privacy rule (read this before changing anything)

The owner does not want a stranger who finds this public repository, or the
site, to be able to work out **when the baby is due**. Everything else follows
from that:

- **Never write the due date, or any real date tied to the pregnancy, in
  plaintext anywhere that gets pushed.** That means files, commit messages,
  branch names, PR titles and bodies, issue comments, and code comments. That
  includes dates that imply the due date: an anatomy-scan date or "week 20 is
  in December" gives it away just as surely.
- The due date lives only inside `data.enc.json` (and the gitignored
  `data.json`). Pages compute every calendar date from it *after* decrypting.
- `shared/weeks.js` is generic reference content keyed by gestational week.
  Keep it date-free.
- Savings deadlines use `weeksBeforeDue` (relative), not absolute dates, so
  the sample and any fixtures never leak the date. Absolute `needBy` is
  supported but only belongs in the encrypted data.
- `data.sample.json` uses `YYYY-MM-DD` placeholders for pregnancy dates. Keep
  it that way. Savings entry dates in it are harmless.
- Test fixtures, screenshots, and anything else you commit follow the same
  rule.
- If a real date is ever pushed by mistake, say so to the owner straight
  away: rewriting history on a public repo is their decision.

How the lock works: there is no server to check a password, so the data is
encrypted (AES-256-GCM; key from PBKDF2-SHA256, 600k iterations, salt and
iteration count stored in the file). The browser derives the key from the
passphrase and decrypts locally. Because the ciphertext is public it can be
attacked offline with no rate limit, so the passphrase must be long and random
(several random words), never a PIN. Never hard-code the passphrase, never add
a plaintext copy of the data, and never log decrypted data to the console.

The page title and the folder name do say "baby". That is accepted: the
concern is the date, not the fact.

## Updating the data today (no backend)

```
node baby/tools/seal.mjs open      # data.enc.json -> data.json (asks for the passphrase)
# edit baby/data.json
node baby/tools/seal.mjs seal      # data.json -> data.enc.json (verifies the passphrase first)
git add baby/data.enc.json         # never data.json
```

`seal --new-passphrase` changes the passphrase. Sealing with the same
passphrase keeps the salt, so browsers that chose "keep unlocked" stay
unlocked. A new passphrase locks every device out until it is entered again.
`BABY_PASSPHRASE` in the environment skips the prompt (useful for scripts; do
not put it in a file in the repo).

## Data schema

One JSON document. `"sample": true` shows a "sample data" banner on every page.

```jsonc
{
  "sample": false,
  "updated": "YYYY-MM-DD",                 // shown in the header
  "pregnancy": {
    "due": "YYYY-MM-DD",                    // the only date everything else derives from
    "nickname": "Baby",
    "done": ["first-appointment"],          // ids from BABY_TASKS in shared/weeks.js
    "appointments": [{ "date": "YYYY-MM-DD", "label": "OB check-in", "note": "" }],
    "moments": [{ "date": "YYYY-MM-DD", "text": "Heard the heartbeat." }]
  },
  "savings": {
    "accounts": [{ "id": "hysa", "name": "High-yield savings", "note": "" }],
    "goals": [{
      "id": "crib", "name": "Crib + mattress",
      "icon": "crib",                       // a key of BABY_ICONS in savings/icons.js
      "target": 600,
      "weeksBeforeDue": 8,                  // or "needBy": "YYYY-MM-DD"
      "note": "",
      "bought": { "date": "YYYY-MM-DD", "paid": 560 }   // optional; marks it done
    }],
    "entries": [{
      "date": "YYYY-MM-DD",
      "amount": 100,                        // negative takes money back out
      "goal": "crib",                       // null = general fund
      "account": "hysa",
      "kind": "purchase",                   // optional; omitted = deposit
      "note": ""
    }]
  }
}
```

Ledger rules, as implemented in `shared/savings-model.js`:
- A goal's funding is the sum of its non-purchase entries. Nothing stores a
  balance, so there is nothing to keep in sync.
- `goal: null` is general money. It counts toward the whole stack, not toward
  any one item.
- Moving money between goals or accounts is two entries: a negative and a
  positive.
- A purchase (`kind: "purchase"`) is money spent. It lowers the account
  balance but does not un-fund the goal; set the goal's `bought` too.
- Task ids in `BABY_TASKS` are referenced by `pregnancy.done`. Never rename one.

No real money moves through any of this. It is a notebook.

## Adding a section

A folder with an `index.html` that loads `../shared/baby.css`,
`../shared/lock.js`, and its own script, and calls
`BB.unlock((data) => { BB.chrome(data); ...; BB.views(); })`. Then add a tile
to `baby/index.html`. Copy `progress/` as the pattern: a home-bar header whose
icon buttons switch `.view` sections (and set `#hash`), plus a Lock button.
New data goes in a new top-level key of the same JSON document.

## Backend plan (not built yet)

**Decided:** the owner's out of Supabase projects, so the backend will be a
**self-hosted Supabase on a spare laptop**. Logging will be done in natural
language through an **MCP server** that Claude or ChatGPT calls ("put $150
toward the crib from savings", "we had the anatomy scan today, add a moment").
Nobody types into a form on this site.

**Recommended shape** (the laptop never has to face the internet):

```
Claude / ChatGPT --MCP--> MCP server on the laptop --> Postgres (self-hosted Supabase)
                                                          |
                                     publish step: export -> seal.mjs -> git push data.enc.json
                                                          |
                                     battydev.com/baby (static, unchanged) decrypts it
```

- The laptop is the source of truth. After each write, the MCP server (or a
  `publish` tool it exposes) exports the database into the JSON schema above,
  seals it with `tools/seal.mjs`, and commits and pushes `baby/data.enc.json`.
- The site keeps working when the laptop is asleep or off. It shows the last
  published snapshot, and the `updated` stamp says how old it is.
- The privacy model does not change, and no port on the home network is
  opened.
- The push needs a GitHub credential on the laptop, scoped to this repository
  only (a fine-grained token with contents:write).

**Alternative:** pages read live from the laptop over Tailscale (`tailscale
serve` provides the HTTPS that a page on battydev.com needs; a plain-http
laptop URL would be blocked as mixed content). This is only reachable from
devices on the tailnet, and it is down whenever the laptop is. Not
recommended to start.

**Not recommended:** exposing the laptop's Supabase to the public internet
(for example through a Cloudflare Tunnel). That is more to secure for no gain
over the publish step.

**Also possible:** `baby_`-prefixed tables in the existing cloud project
`battydevsite` (see `fcevents/README.md`), with RLS like `/health`. No new
project is needed, but the data then lives with a cloud provider, which the
laptop plan avoids.

Sketch of the tables, mirroring the JSON so the export is a straight mapping:

| table | columns |
|---|---|
| `baby_settings` | `due date, nickname text, updated_at` (one row) |
| `baby_appointments` | `id, date, label, note` |
| `baby_moments` | `id, date, text` |
| `baby_tasks_done` | `task_id text primary key, done_at` |
| `baby_accounts` | `id text primary key, name, note` |
| `baby_goals` | `id text primary key, name, icon, target numeric, weeks_before_due int, need_by date, note, bought_date, bought_paid` |
| `baby_entries` | `id, date, amount numeric, goal_id null, account_id, kind, note, created_at` |

MCP tools to expose (small and explicit, so a model cannot do anything
surprising): `log_entry`, `move_money`, `mark_bought`, `add_goal`,
`update_goal`, `add_appointment`, `add_moment`, `mark_task_done`,
`get_summary`, `publish`. Keep the passphrase in the laptop's OS keychain or
an environment variable that the publish step reads, never in a file in the
repository.

Open decisions for the owner:
- Whether the owner's wife gets her own login. Today there is one shared
  passphrase. With the publish design, "her own login" would mean a second
  passphrase, which needs a key-wrapping change in `seal.mjs`.
- Whether to keep a dated history of `data.enc.json` in git (current
  behaviour, each publish is a commit) or squash it.
