# Rules to confirm in the real game

The engine follows the card text and the behaviour of
[gwent-classic](https://github.com/asundr/gwent-classic), a careful browser
remake of the Witcher 3 minigame. A handful of rules can't be settled from
card text alone. Each is listed here, with what we currently do and where the
code makes that decision (search the source for `VERIFY`). To confirm one, set
the board up in Witcher 3, note what happens, then tick it off and, if it
differs, fix the engine and add a test.

## Strength

- [ ] **Order of operations** is weather → Tight Bond → Morale Boost → Horn.
  Test: two Blue Stripes Commandos + Olgierd on one row, no horn. We say each
  Commando shows **9** (4×2+1); the other order would give 10.
  (`score.ts`, `score.test.ts › is applied after Tight Bond`)
- [ ] **King Bran under weather** halves, rounding down (a 1-strength unit
  shows 0). (`score.ts`)
- [ ] **Dandelion and a Commander's Horn** on the same row: Dandelion is
  doubled by the horn card (shows 4), other units are doubled only once.

## Abilities

- [ ] **Muster pulls from the deck only**, not from your hand.
  Test: hold two Arachas, play one. We say the other stays in hand.
- [ ] **Clan Dimun Pirate** doesn't count itself when finding the strongest
  unit, so it can't scorch itself. (`engine.ts › onPlaced`)
- [ ] **Avenger at the end of a round** (Cow, Kambi): the token appears at the
  start of the next round. (`engine.ts › endRound`)
- [ ] **Decoy on a summoned token** (Bovine Defense Force, Hemdall) isn't
  allowed. A transformed Berserker can be decoyed and comes back as a
  Berserker. (`engine.ts › decoyTargets`)
- [ ] **A transformed Berserker** goes to the discard pile as the original
  Berserker. (`engine.ts › leaveBoard`)
- [ ] **Mardroeme uses the row's horn slot**, so it blocks a Commander's Horn
  on that row and vice versa.

## Leaders

- [ ] **Leaders that would do nothing can't be activated** (e.g. Foltest,
  King of Temeria with no fog in the deck). If the game allows a no-op
  activation, it's a legal way to skip a turn without passing, and the AI
  should know about it. (`engine.ts › canUseLeader`)
- [ ] **Eredin, Bringer of Death** and **Emhyr, the Relentless** can take any
  non-hero unit, but not heroes or special cards.
- [ ] **Two Emhyr, the White Flame** leaders cancel each other.

## Flow

- [ ] **The round winner starts the next round**; after a draw, the player who
  started the drawn round starts again. (`engine.ts › endRound`)
- [ ] **Skellige round 3 revival** places the two units without triggering
  their abilities (no spy draw, no medic, no muster). (`engine.ts › startRound`)
- [ ] **Monsters keep a random non-hero unit**, never a hero.
- [ ] **Redraw** puts the card back at a random position in the deck before
  you could draw it again.

## Card data

- [ ] Spot-check every card's strength and row against the in-game collection
  (the data came from gwent-classic; `test/data` checks its shape, not its
  numbers).
- [ ] **Next-gen**: Geralt and Ciri muster Roach. gwent-classic says the
  next-gen update added this; confirm on the current patch.
