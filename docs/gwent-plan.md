# Gwent simulator: plan

A fan-made Gwent simulator at `battydev.com/gwent`, built to practise against
the hard matches in the real games. Witcher 3 Gwent comes first, then
Thronebreaker, then standalone Gwent.

Decisions so far:

| Question | Answer |
|---|---|
| Versions | All three, Witcher 3 first |
| Practice features | Real NPC opponents, strong AI, coach and hints, deck builder |
| Code location | New repo `BattyDev/batty-gwent`, assembled into `/gwent` the same way brackets is |
| Card art | Official CDPR art, used under their fan content rules |

Note: `/gwent` is a path, not a subdomain. A real subdomain such as
`gwent.battydev.com` would need its own Pages site and a DNS record. The path
is simpler, and it matches `/brackets`.

---

## 1. What "high quality" means here

The practice value depends on four things, in this order:

1. **The rules are exactly right.** If a score, a Scorch or a Medic chain
   resolves differently from the real game, practice teaches the wrong thing.
   Correctness beats features at every milestone.
2. **Opponents match the game.** The real NPCs play their real decks and
   leaders, and they behave the way the in-game AI does. A stronger mode sits
   on top.
3. **The coach tells the truth.** Hints and win odds come from the same search
   engine the strong AI uses, not hand-written tips.
4. **It feels like Gwent.** Familiar board layout, official art, readable
   scores, quick animations, and it works on a phone held sideways.

---

## 2. Architecture

The three games split into **two engine families**:

| Family | Games | Shape |
|---|---|---|
| Classic | Witcher 3 (base game, Hearts of Stone, Blood and Wine) | 3 rows, weather, horns, ability keywords, faction perks, best of 3, no draw between rounds |
| Homecoming | Thronebreaker, standalone Gwent | 2 rows, deploy and order abilities, armour, round-based card draw; Thronebreaker adds puzzles |

Everything else is shared: the board UI shell, the AI search, the coach, the
replay and undo system, and the deck builder framework.

```
batty-gwent/
  packages/
    core/            shared types, seeded RNG, event log, search harness (ISMCTS)
    classic/         Witcher 3 rules engine + card data + NPC data
    homecoming/      Thronebreaker / standalone engine (phase 2+)
    ai/              heuristic bots, NPC imitation bots, ISMCTS bot (runs in a Web Worker)
    coach/           move ranking, pass advisor, post-game review
  app/               UI: menus, board, deck builder, practice modes
  assets/            card art pipeline output (WebP), frames, icons
  tools/             data import/validation scripts, art converter, self-play benchmark
  test/              unit, golden-scenario, property, and Playwright E2E tests
```

### Tech stack

- **TypeScript + Vite**, built into plain static files with `base: '/gwent/'`.
  The rest of the site is hand-written JS. A rules engine with a few hundred
  cards and a search AI is where types pay for themselves.
- **No heavy UI framework.** The board is DOM and CSS (crisp card art, easy
  text, accessible). Preact if state management gets awkward, nothing larger.
- **Web Worker for the AI and coach**, so search never freezes the board.
- **Vitest** for engine tests and **Playwright** for E2E, matching brackets.
- **localStorage** for decks, collection and settings, with export/import
  codes. Accounts or cloud sync are optional later (Supabase is already used by
  `fcevents`).

### Engine contract (same for both families)

The engine is pure and deterministic: same state, action and seed give the same
result. That one rule makes undo, replays, tests, AI search and shareable
scenarios simple.

```ts
legalActions(state, player): Action[]
apply(state, action): { state, events }    // RNG seed lives inside state
view(state, player): PlayerView            // hides the opponent's hand and deck order
score(state): RowScores                    // derived, never stored
```

- **Choices in the middle of an effect** (Medic picks a revive target, which
  can chain into another Medic; Decoy picks a target; an Agile unit picks a
  row; Emhyr's peek) are modelled as a `pending` prompt in the state. The next
  action answers it. There are no callbacks, so the AI can search through them.
- **Events** (`cardPlayed`, `unitDestroyed`, `weatherApplied`,
  `roundEnded`, and so on) drive animations, the game log, and the coach's
  review.
- **Card data is declarative.** Each card is JSON with ability keywords
  (`muster`, `tightBond`, `medic`, `spy`, `agile`, `moraleBoost`, `horn`,
  `scorchRow`, `avenger`, `berserker`, `mardroeme` and so on). Code hooks exist
  only for unique leaders and one-offs.

```json
{ "id": "tw3.nr.ves", "name": "Ves", "faction": "northern", "type": "unit",
  "rows": ["close"], "strength": 5, "hero": false, "abilities": [],
  "set": "base", "art": "tw3/ves", "obtain": "..." }
```

---

## 3. Witcher 3 rules engine (phase 1 core)

### Rules checklist

Each item gets its own tests before UI work depends on it.

- [ ] Setup: draw 10, redraw up to 2, leader card, coin flip. Scoia'tael chooses who goes first.
- [ ] Turn flow: play one card, use the leader, or pass. A pass locks you out until the round ends.
- [ ] Round end: higher total wins. A tie costs both players a life, unless one is Nilfgaard. Two lives each. A draw is possible when both lose their last life together.
- [ ] Faction perks:
  - Northern Realms: draw a card on a round win.
  - Nilfgaard: win ties.
  - Scoia'tael: choose who goes first.
  - Monsters: a random unit stays on the board after each round.
  - Skellige: two random units come back from the discard pile in round 3.
- [ ] Strength pipeline: base → weather → Tight Bond → Morale Boost → Horn. **This order must be checked against the real game, not assumed.**
- [ ] Heroes: immune to weather, horns, morale, Scorch, Decoy and Medic.
- [ ] Weather: Biting Frost, Impenetrable Fog, Torrential Rain, Skellige Storm, Clear Weather.
- [ ] Specials: Commander's Horn, Decoy, Scorch (strongest non-hero units on both sides; ties all die), Mardroeme.
- [ ] Unit abilities: Agile, Medic (including chains, never heroes or specials), Morale Boost, Muster (pulls from the deck), Spy (goes to the other side, draws 2), Tight Bond, row Scorch (Villentretenmerth and others), unit Horn (Dandelion), Summon Avenger, Berserker and its transformation.
- [ ] Every leader ability, base game plus expansions, including passive ones such as Emhyr the White Flame cancelling the opponent's leader, King Bran's half weather penalty, and Crach an Craite's discard pile shuffle.
- [ ] Deck rules: at least 22 units, at most 10 specials, one leader, faction plus neutral cards.
- [ ] Target the current patch of the game. Some rules changed in early patches, so note anywhere older guides disagree.

### How we know it's right

- **Golden scenarios.** Set up real boards in the game, screenshot the
  result, and encode them as fixtures: "this board, this play, these row
  scores." Focus on the confusing interactions: weather plus bond plus horn,
  Scorch ties, Decoy on a spy, a Medic reviving a Medic, Avenger after Scorch,
  the Monsters perk and Skellige round 3. About 60–100 of these is the
  correctness backbone.
- **Property tests.** The total number of cards across all zones never
  changes. Heroes never change strength. The same seed always gives the same
  game. `view()` never leaks hidden cards.
- **Random self-play.** Thousands of games between random bots must finish
  without exceptions or illegal states.

### Data sourcing

Card data and NPC decks come from two places, checked against each other:

1. **Game files from your own PC copy** (best). Witcher 3's card and NPC deck
   definitions sit in its bundled XML. The community extraction tool
   WolvenKit can unpack them and the card textures. This gives exact values
   and the official art at full resolution.
2. **Wiki and guide data** as a fallback and cross-check. Guides sometimes
   disagree on leader text, so anything they disagree on is settled by the game
   files or in-game play.

A validator script in `tools/` checks every card and deck: legal rows,
ability keywords it recognises, deck legality, and an image for every card.

---

## 4. Opponents and AI

Two independent dials: **which deck** (any real NPC, or any custom deck) and
**which brain**.

| Brain | Purpose | How |
|---|---|---|
| **Game-like** | Practise against what you'll actually face | A rule-based imitation of the Witcher 3 AI's habits (when it passes, how it spends cards, how it uses its leader), tuned by watching real matches |
| **Strong** | Better than the game, so in-game wins feel easy | ISMCTS (Information Set Monte Carlo Tree Search): samples what your hand could be from cards not yet seen, then searches. **It does not cheat.** |
| **Expert** | Hardest | The same search with a bigger time budget and smarter rollouts |
| **Open-hand** (optional) | Puzzle-like drills | The AI can see your hand. Off by default and clearly labelled |

### What the strong AI has to understand

Classic Gwent is mostly about **card advantage across three rounds**, not
winning each round. The search's evaluation therefore weighs lives, card count
difference, score difference, cards still in the deck that matter (muster
groups, spies), and leader availability. Rollouts use a fast heuristic policy
rather than random moves, so search finds real lines such as baiting a pass,
bleeding cards, or saving the horn.

Budget: under about 1.5 s per move on a mid-range phone at the Strong level.
It runs in a Worker, with an "AI thinking" indicator.

### NPC catalogue

One entry per in-game opponent:

- Name, region, quest (for example High Stakes, the Passiflora tournament
  often called the hardest Gwent event; the Velen players; the Hearts of Stone
  and Blood and Wine players).
- Faction, leader, exact decklist, unique card reward, and whether it's
  missable.
- A difficulty rating, plus short notes on its tricks ("holds two spies",
  "dumps muster in round 1").
- Whether the deck is fixed or changes, which needs checking per opponent.

Practice mode lets you pick an opponent from the catalogue, see their full
deck before the match if you want to, and track their remaining cards while
you play.

---

## 5. Coach

All coach output comes from the same search engine running for your side.

- **Hint button:** your top 3 moves, each with an estimated win percentage.
- **Pass advisor:** "Win chance if you pass now: 38%. If you play your Ves: 61%."
  This is the most valuable single feature for classic Gwent.
- **Card tracker:** the opponent's played cards, discard pile, and (for known
  NPC decks) what's still left in their deck.
- **Post-game review:** a timeline of win percentage, moves where it dropped
  sharply flagged as mistakes, and the better move shown. Jump to any point
  and replay from there.
- **Takebacks:** undo in practice mode, which is cheap because the engine is
  deterministic.
- **Exam mode:** coach off, no undo, game-like AI. A dress rehearsal for the
  real match.
- **Scenario editor:** set up any board, hand and discard pile, for example to
  recreate a spot from a game you just lost in Witcher 3, then ask the coach or
  play it out over and over. Scenarios share as a code or link.

---

## 6. Deck builder and collection

- **Collection tracker:** a checklist of every Witcher 3 card, with where to
  get it (vendor, NPC win, quest reward) and a **missable** warning. Useful in
  its own right for the Collect 'Em All quest.
- **Deck builder:** filter by faction, row, ability or set. Live legality check
  (22 units, 10 specials). Strength totals, row spread, and hero, spy and medic
  counts. "Only cards I own" toggle.
- **Testing:** "Play this deck against an NPC", plus a batch run of 100 AI vs
  AI games against a chosen NPC to estimate a win rate before you try it in
  the real game.
- **Saving:** decks and collection in localStorage, with copy/paste deck codes.

---

## 7. Look and feel

- Board layout like Witcher 3's: opponent rows above yours, a score per row
  and total score, life gems, the leader on the left, deck and discard on the
  right, hand along the bottom, and a weather slot.
- Official card art, framed in a close imitation of the game's card
  presentation. Tap or hover to zoom a card with its ability text.
- Short animations with a speed setting and an instant mode; reduced motion
  respected.
- Desktop first. Phones work held sideways; holding one upright shows a
  "rotate" prompt rather than a cramped board.
- Keyboard controls. Colour isn't the only way to tell anything apart (weather
  rows get icons, not just tints).
- Matches the site's style for menus (Roboto Condensed, dark), while the board
  itself looks like Witcher 3. A tile on the home page links to it.

### Card art and the fan content rules

- CDPR publishes **Fan Content Guidelines** that set out what fans may do with
  their assets. The general shape is non-commercial use only, a visible notice
  that it's an unofficial fan project not endorsed by CD PROJEKT RED, and
  credit for the IP. **I couldn't load the guidelines page from this
  environment, so reading the current text is a required step before
  launch** (milestone M6), and the footer and About page should follow it
  word for word.
- No ads, donations or paywalls on `/gwent`.
- Art is converted to WebP at two sizes (about 160 px thumbnails and about
  480 px zoom), lazy-loaded, and kept within a total budget so first load stays
  fast.
- The art will sit in a public GitHub repo. The guidelines apply to that too.

---

## 8. Repo, CI and deploy

Same pattern as brackets, with one difference: this project has a build step.

1. Create `BattyDev/batty-gwent` (empty).
2. **CI there** (`ci.yml`): typecheck, lint, unit, golden and property tests,
   build, and a Playwright smoke test against the built output.
3. **Publish** (`publish.yml`): after CI passes on `main`, push the built
   `dist/` to a `dist` branch. Then optionally send the same
   `repository_dispatch` brackets uses (the existing `SITE_DISPATCH_TOKEN`
   approach), or rely on the hourly schedule `pages.yml` already has.
4. **Here, in `pages.yml`:** check out `BattyDev/batty-gwent` at `ref: dist`
   into `gwent/`, strip `.git`, and check that `gwent/index.html` exists.
   **Add this step only after the `dist` branch exists.** Otherwise the
   existence check fails and blocks every deploy of the whole site.
5. Add the home page tile (`assets/tile-gwent.jpg`) last, when it's worth
   finding.

---

## 9. Milestones

Each milestone ends in something you can open at `/gwent`.

| # | Milestone | Done when |
|---|---|---|
| **M0** | Repo, CI, deploy pipeline | A placeholder page is live at `battydev.com/gwent`, built by batty-gwent's CI |
| **M1** | Witcher 3 rules engine, headless | Every rule on the checklist is implemented; all card data is imported and validated; golden, property and random self-play tests pass |
| **M2** | Playable board | Full match against a simple bot in the browser, with official art, the game log, and undo |
| **M3** | NPC opponents | Full NPC catalogue, game-like AI, practice mode with deck preview and card tracker |
| **M4** | Strong AI and coach | ISMCTS in a Worker; hints, pass advisor, post-game review, exam mode, scenario editor |
| **M5** | Deck builder and collection | Collection tracker with missable warnings, deck builder, deck codes, batch win-rate testing |
| **M6** | Polish and launch | Phone layout, accessibility pass, performance budgets met, fan content guidelines checked and the notice added, home tile live |
| **P2** | Thronebreaker | Homecoming engine family; Thronebreaker card pool; the campaign's puzzle battles as built-in scenarios |
| **P3** | Standalone Gwent | One fixed patch snapshot of the card pool, with the same AI, coach and deck builder on the Homecoming engine |

Benchmarks run in CI from M4 onward: Strong must beat Game-like over a fixed
set of 1,000 seeded games by a set margin. Any AI change that drops below that
fails the build.

### Phase 2 and 3 notes

- **Thronebreaker:** its puzzles map directly onto the scenario system from M4.
  Its card pool is self-contained and campaign-sized, so it's a good first
  target for the Homecoming engine.
- **Standalone Gwent:** the card pool is far larger and changed often over the
  years. Choose one patch to target. Community sites have published card data,
  so its availability should be checked when P3 starts. The AI's evaluation
  will need retuning, because round-based draw changes the card advantage
  maths.

---

## 10. Open questions

None of these block M0 or M1, but the answers shape later milestones:

1. **Do you have Witcher 3 on PC?** If so, extracting card data, NPC decks and
   art from your own install is the most accurate source. If you only play on
   console, we use wiki data and check it in the game.
2. **Which in-game matches are you stuck on right now?** Those NPCs get
   catalogued, imitated and tested first in M3.
3. **Play against friends online?** It's not in the plan. It's possible later
   with Supabase Realtime, but it adds accounts, hidden-information security
   and cheating concerns. Practice against the AI is the focus.
4. **Sound and music?** Left out by default (asset licensing again). It can
   be added as an opt-in.
5. **For standalone Gwent:** a particular era or patch you care about, or the
   final card pool?
