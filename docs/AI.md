# How the AI works, and how strong it is

## Bots

| Level | Name in the app | How it decides |
|---|---|---|
| `simple` | Tavern regular | One move of lookahead over six guesses at your hand, plus rules of thumb for passing. Plays roughly like the Witcher 3 AI. |
| `strong` | Seasoned player | ISMCTS (below), about 1.5 s per move. |
| `expert` | Gaunter O'Dimm | The same search with about 5 s per move. |

None of them can see hidden cards. Each bot is given `view(state, me)`,
where your hand and both deck orders are face down. Each bot is also given
your deck *list*, as a regular opponent would know it. Hidden cards are dealt
at random from what's left of that list (`src/ai/determinize.ts`), and the
search averages over many such deals.

## ISMCTS

`src/ai/ismcts.ts` uses single-observer Information Set Monte Carlo Tree
Search (Cowling, Powley & Whitehouse, 2012). Each iteration works like this:

1. Deal a fresh guess at the hidden cards.
2. Walk a single shared tree. Actions are keyed by what is played
   (`src/ai/keys.ts`), so two copies of a card are the same action, and
   "Decoy on Ves" means the same thing in every guess.
3. Choose with UCB, counting how often each action was *available* rather
   than how often its parent was visited.
4. Finish the game with a playout policy (`src/ai/playout.ts`), then credit
   the result back up the path.

There are two playout policies:

- **fast**: guesses a card's worth from the board without simulating it.
- **greedy** (the default): tries each candidate move and weighs score gained
  against cards spent. It's about 2.3× slower per iteration.

Both policies treat the three round situations differently: the final round
(play everything), a round you must win but should win cheaply, and a round
you can afford to lose.

The coach runs the same search for you. Its "win chance" is the estimated
win rate of a move across all the deals and playouts.

## Benchmarks

Run them with `npm run bench`, for example
`BENCH_GAMES=40 BENCH_A=1000g BENCH_B=0 npm run bench`. Every pairing is
played twice with seats and decks swapped, so deck strength cancels out.

| Matchup (iterations per move) | Games | Result |
|---|---|---|
| search 600 (fast) vs simple | 20 | 15–5 |
| search 2500 (fast) vs simple | 30 | 22–8 |
| search 1000 (greedy) vs simple | 40 | **35–5** |
| search 1000 (greedy) vs search 2300 (fast), about equal time | 40 | 18–22 |

The simple bot was improved between the first two rows and the third, so
compare the rows loosely. At equal time, neither playout policy is clearly
stronger: 18–22 is well within noise over 40 games. Greedy is the default
because its advice is more sensible in hand-checked positions, such as the
opening moves (`test/bench` and the opening diagnostic in the commit history).
Better playouts are the main lever for a stronger AI and a better coach.

## Known limits

- The search assumes you play like its playout policy. Unusual but strong
  lines can be undervalued, especially passes early in a round.
- Win chances are estimates with noise. A move with few visits (the coach
  shows the top three) can be off by several points. The post-match review
  only flags a mistake when the gap is at least 12 points and the move was
  explored enough to trust.
