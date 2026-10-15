# AGENTS.md — /baby

Scope: **this directory.** Read the root `AGENTS.md` first; this file adds to it.

`battydev.com/baby` is a private section for following a pregnancy and saving
up for the baby. It is unlisted and behind a sign-in. It has its own front
page (a hub of section tiles), and each section is a sub-folder:

```
baby/
  index.html            /baby              hub: one tile per section
  progress/             /baby/progress     week by week, month by month, visits
  savings/              /baby/savings      the stack, item by item, accounts, history
  shared/
    auth.js             sign-in, loading the data, shared helpers (BB.*)
    baby.css            shared skin (copied from /health's chrome)
    weeks.js            general pregnancy content, keyed by week. Date-free.
    savings-model.js    pure ledger maths, used by the hub tile and /savings
  sql/                  every migration applied to the database, in order
```

## Where the data lives

`baby_`-prefixed tables in the **`battydevsite`** Supabase project
(`bbqauqqymjxqcyurxmna`), the same project as `/fcevents` (`raid_`) and
brackets (`bkt_`). `/health` uses a different project; don't confuse them.

- **Reading:** each page makes one call, `rpc('baby_snapshot')`, which returns
  the whole section as one JSON document (shape below).
- **Who can read:** only user ids listed in `public.baby_members`. Every
  `baby_` table has RLS that checks `baby_is_member()`. Being signed in is not
  enough: this project lets strangers create accounts (Discord sign-in for the
  FC, anonymous and guest accounts for brackets), so "authenticated" means
  nothing here. A signed-in non-member gets error `42501` and the page says
  so; an anonymous caller gets "permission denied".
- **Writing:** nothing is writable from a browser. Rows are written through
  the Supabase MCP or the SQL editor, which run as `postgres`. That is how
  logging works: the owner tells Claude or ChatGPT in plain language, and the
  agent runs the SQL below.
- **Sign-in:** the same as `/health`, by the owner's choice. The gate asks
  for a PIN only; `ACCOUNT_EMAIL` in `shared/auth.js` names the account, and
  the PIN is that account's password on `battydevsite`, checked by Supabase
  (`signInWithPassword`). Do not add Discord, email links, or any other sign-in
  method without being asked, and never compare the PIN in JavaScript.

The publishable key in `shared/auth.js` is public by design. Never put a
service-role key or the database password anywhere in this repository.

## The privacy rule (read this before changing anything)

The owner does not want a stranger who finds this public repository, or the
site, to be able to work out **when the baby is due**. Everything else follows
from that:

- **Never write the due date, or any real date tied to the pregnancy, in
  plaintext anywhere that gets pushed.** That means files, migrations, seed
  scripts, commit messages, branch names, PR titles and bodies, issue
  comments, and code comments. That includes dates that imply the due date:
  an anatomy-scan date, or "week 20 is in December", gives it away just as
  surely.
- The due date lives only in `baby_settings.due`. Pages compute every calendar
  date from it after loading.
- `shared/weeks.js` is generic reference content keyed by gestational week.
  Keep it date-free.
- Migrations in `sql/` hold schema only, never data. Seed and real rows go in
  through `execute_sql`, never a committed file.
- Savings deadlines prefer `weeks_before_due` over an absolute `need_by`.
- Test fixtures and screenshots follow the same rule. Keep them out of the
  repo, or use invented dates.
- If a real date is ever pushed by mistake, tell the owner straight away:
  rewriting history on a public repo is their decision.

The page titles and the folder name do say "baby". That is accepted: the
concern is the date, not the fact.

## Logging (for any agent with the Supabase MCP)

Project id `bbqauqqymjxqcyurxmna`. Use `execute_sql` for data and
`apply_migration` only for schema (and copy each migration into `sql/`).
Look up ids first (`select id, name from baby_goals`, `... from baby_accounts`)
rather than guessing. Use the owner's local date for `date`, not UTC.

```sql
-- "Put $150 toward the crib from savings"
insert into baby_entries (amount, goal_id, account_id) values (150, 'crib', 'hysa');

-- "Add $80 to the general fund, cash"           (goal_id null = general fund)
insert into baby_entries (amount, goal_id, account_id, note) values (80, null, 'cash', 'garage sale');

-- "Move $50 from the general fund to the stroller"   (always a pair)
insert into baby_entries (amount, goal_id, account_id) values (-50, null, 'hysa'), (50, 'stroller', 'hysa');

-- "We bought the car seat, $289 from checking"
insert into baby_entries (amount, goal_id, account_id, kind) values (289, 'carseat', 'checking', 'purchase');
update baby_goals set bought_date = current_date, bought_paid = 289 where id = 'carseat';

-- New item / new account
insert into baby_goals (id, name, icon, target, weeks_before_due) values ('swing', 'Baby swing', 'gift', 180, 3);
insert into baby_accounts (id, name) values ('529', 'College 529');

-- Appointments, moments, checklist
insert into baby_appointments (date, label, note) values ('<date>', 'OB check-in', '');
insert into baby_moments (date, text) values (current_date, 'Felt the first kick from outside.');
insert into baby_tasks_done (task_id) values ('car-seat');      -- ids: BABY_TASKS in shared/weeks.js

-- When the sample data is replaced with real figures
update baby_settings set sample = false;
```

Ledger rules (`shared/savings-model.js` implements them):
- A goal's funding is the sum of its deposit entries. Nothing stores a
  balance, so there is nothing to keep in sync. Fix a mistake with a
  correcting entry, or by deleting the wrong row.
- `goal_id null` is general money. It counts toward the whole stack, not
  toward any one item.
- A purchase (`kind = 'purchase'`) is money spent. It lowers the account
  balance but does not un-fund the goal; set the goal's `bought_*` too.
- Task ids in `BABY_TASKS` are stored in `baby_tasks_done`. Never rename one.
- Icons: `crib stroller carseat bassinet dresser monitor bottle diapers bag
  piggy onesie highchair jar gift` (see `savings/icons.js`; unknown = gift).
- Account colours follow `baby_accounts.created_at` order, so existing
  accounts keep their colour when a new one is added. Past three accounts the
  extras share a neutral grey.

No real money moves through any of this. It is a notebook.

### Access and the PIN

The allow-list holds the owner's account only. Adding someone means giving
them an account of their own and a sign-in path on the gate, which is a
design change: ask the owner first. The SQL side is one row:

```sql
insert into baby_members (user_id, label)
select id, 'Name' from auth.users where email = '<their email>';
```

Changing the PIN changes that account's password for the whole `battydevsite`
project. The owner does it in the Supabase SQL editor, never through an AI
chat, so the PIN does not end up in a transcript:

```sql
update auth.users set encrypted_password = extensions.crypt('<new PIN>', extensions.gen_salt('bf'))
where email = '<owner email>';
```

## Snapshot shape (what `baby_snapshot()` returns)

```jsonc
{
  "sample": true,                           // shows the "sample data" banner
  "updated": "<timestamptz>",               // bumped by a trigger on any write
  "pregnancy": {
    "due": "YYYY-MM-DD", "nickname": "Baby",
    "done": ["first-appointment"],
    "appointments": [{ "date": "...", "label": "...", "note": "" }],
    "moments": [{ "date": "...", "text": "..." }]
  },
  "savings": {
    "accounts": [{ "id": "hysa", "name": "...", "note": "" }],
    "goals": [{ "id": "crib", "name": "...", "icon": "crib", "target": 600,
                "weeksBeforeDue": 8, "needBy": null, "note": "",
                "bought": null }],          // or { "date": "...", "paid": 560 }
    "entries": [{ "date": "...", "amount": 100, "goal": "crib" /* or null */,
                  "account": "hysa", "kind": "deposit", "note": "" }]
  }
}
```

New data for a new section goes in a new table plus a new top-level key here.

## Adding a section

A folder with an `index.html` that loads `../shared/baby.css`, supabase-js,
`../shared/auth.js` and its own script, and calls
`BB.unlock((data) => { BB.chrome(data); ...; BB.views(); })`. Then add a tile
to `baby/index.html`. Copy `progress/` as the pattern: a home-bar header whose
icon buttons switch `.view` sections (and set `#hash`), plus a Sign out button.

## Later: the spare laptop

The owner may move this to a self-hosted Supabase on a spare laptop. If so,
the schema in `sql/` applies as-is (it only assumes Supabase's `auth` schema
and roles). The open question is reachability: a page on battydev.com needs
an HTTPS endpoint, and the laptop should not be opened to the internet. Two
ways that keep it closed: Tailscale (`tailscale serve` provides HTTPS, so
only devices on the tailnet can reach it), or the laptop publishing an
encrypted snapshot to this repository. The site's history has a working
version of the second; see the commits that added `baby/tools/seal.mjs`.
