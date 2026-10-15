# To do

What's left, grouped by what it's waiting on. Built so far: the Witcher 3
rules engine, board, three AI levels, coach and review, deck builder,
collection, scenario editor, exam mode, and resume after reload. See the
README.

## Needs you (no code can do these)

- [ ] **Create `BattyDev/batty-gwent`** on GitHub: public, empty, no README.
  Then push this code with
  `git push https://github.com/BattyDev/batty-gwent.git origin/gwent-dev:main`
  in a clone of BattyDev.github.io, or ask Claude to once the repo is added
  to a session.
- [ ] **Check CI is green there**; the Publish workflow then creates `dist`.
- [ ] **Merge `claude/gwent-plan`** in BattyDev.github.io. That deploys
  `/gwent` and adds the home tile.
- [ ] **Fan content notice.** Copy the exact wording CD PROJEKT RED's current
  fan content guidelines ask for into the menu footer (`src/ui/menu.ts`) and
  the About page (`src/ui/main.ts`). Their site couldn't be reached from the
  build environment.
- [ ] **Check the rules in `docs/VERIFY.md`** in the real game. Each item
  names a board to set up and what we currently assume.
- [ ] Optional: add `SITE_DISPATCH_TOKEN` here so updates go live straight
  away instead of within the hour.

## Blocked on data

- [ ] **The in-game opponents' decks (M3).** Best source: the game files from
  a PC copy, unpacked with WolvenKit. Until then, rebuild a deck you face in
  the game with the deck builder (save it as "An opponent's"), then pick it
  under *Practice opponents*.
  - Once the data exists: a catalogue page with region, quest, reward card
    and difficulty, and practice straight from it.
- [ ] **Where to get each card**, with missable warnings, in the collection
  page. Same source.
- [ ] **Card names.** The data says "Mysterious Elf"; the card art says
  "Avallac'h". Check which the current patch uses.
- [ ] **Thronebreaker (phase 2).** Needs its card pool and puzzle
  definitions. The plan's second, two-row engine and the scenario system are
  the way in.
- [ ] **Standalone Gwent (phase 3).** Pick a patch, then source card data.

## Can be done any time

### AI and coach
- [ ] Better playouts are the main lever for strength and for the coach's
  accuracy. Try a cheaper card valuation with a greedy pass decision, then
  benchmark at equal time over 200+ games (40 is too noisy; see
  `docs/AI.md`).
- [ ] A truer "game-like" bot. Note how the Witcher 3 AI actually plays
  (when it passes, how it uses its leader) and tune `src/ai/simple.ts` to
  match.
- [ ] Measure how many search iterations per second phones manage, and scale
  the time budgets to suit.
- [ ] Coach explanations: say *why* a move is best ("keeps card advantage",
  "they can't catch up") as well as the number.
- [ ] Skip the coach's search when a prompt is open, where the panel isn't
  shown anyway.
- [ ] `francesca_hope` can be activated when it would move nothing. Either
  check for an actual improvement (cost: an extra search per legal-move
  check) or record the game's behaviour in VERIFY.md.

### Play experience
- [ ] Opt-in sound effects. Licensing applies here too.
- [ ] Drag and drop as well as click to play.
- [ ] Keyboard play of the hand with arrow keys; a full screen-reader
  playthrough.
- [ ] Save finished games and step through them: a replay viewer.
- [ ] Start the scenario editor from any point of a finished match ("edit
  this position").

### Engineering
- [ ] Add a manually triggered CI workflow that runs `npm run bench` and
  posts the result.
- [ ] Unit tests for the UI helpers (`narrate.ts`, `coach.ts › judge`).
- [ ] Profile `totalScore`, which is called heavily in search. Caching row
  scores per state could roughly double the number of iterations.
