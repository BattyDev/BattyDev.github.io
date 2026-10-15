# Batty Gwent

A fan-made Gwent simulator for practising the hard matches in The Witcher 3,
served at **battydev.com/gwent**. Witcher 3 Gwent comes first; Thronebreaker
and standalone Gwent follow. The plan lives in BattyDev.github.io at
`docs/gwent-plan.md`.

Unofficial fan project, not endorsed by CD PROJEKT RED. See
[NOTICE.md](NOTICE.md).

## Working on it

```
npm ci
npm run dev          # http://localhost:5173/gwent/
npm test             # engine, data and property tests
npm run test:e2e     # Playwright, against a production build
npm run build        # typecheck + build to dist/
```

## Layout

| Path | What |
|---|---|
| `src/core/` | Shared pieces: the seeded RNG |
| `src/classic/` | Witcher 3 rules engine, card data, deck rules, hidden-information view |
| `src/ai/` | Opponents: determinisation, bots, the Web Worker they run in |
| `src/ui/` | The app: menu, board, prompts, log |
| `public/art/` | Card art and icons (WebP), built by `tools/build_art.py` |
| `tools/` | One-off importers for card data and art |
| `test/` | Vitest suites; `e2e/` holds Playwright |
| `docs/VERIFY.md` | Rules still to confirm against the real game |

### The engine contract

```ts
newGame(config)          // → { state, events }
legalActions(state)      // every legal action for whoever must act
apply(state, action)     // → { state, events }; never mutates; throws IllegalAction
view(state, player)      // what that player may know: the AI only sees this
```

Everything, the RNG included, lives in the state, so a game replays
exactly from its seed and actions. Undo, replays, tests and the AI's search
all rely on that.

## Deploying

CI runs on every push. When it passes on `main`, `publish.yml` pushes the
build to the `dist` branch, which BattyDev.github.io checks out into `/gwent`
on its next deploy (immediately with `SITE_DISPATCH_TOKEN` set here, otherwise
within the hour).

## Launch checklist

- [ ] Copy the exact notice wording from CD PROJEKT RED's current fan content
      guidelines into the footer and About page.
- [ ] Work through `docs/VERIFY.md` in the real game.
