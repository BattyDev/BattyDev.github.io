// Turns a player's view (opponent's hand and deck face down) into a complete
// game state the engine can run, by dealing the hidden cards at random from
// whatever the opponent could still be holding. Search samples many of these
// and averages, which is how an honest AI reasons about hidden information.

import { CARDS, def } from '../classic/cards';
import { cloneState, other } from '../classic/engine';
import type { Card, DeckList, GameState, PlayerId } from '../classic/types';
import { ROWS } from '../classic/types';
import type { Rng } from '../core/rng';

/** Fresh uids for invented cards start here, well clear of real ones. */
const INVENTED_UID = 1_000_000;

function expand(deck: DeckList): string[] {
  const out: string[] = [];
  for (const [id, n] of deck.cards) for (let i = 0; i < n; i++) out.push(id);
  return out;
}

/** Every card a deck of this faction could contain, for when the list is unknown. */
function factionPool(s: GameState, p: PlayerId): string[] {
  const faction = s.players[p].faction;
  const out: string[] = [];
  for (const c of CARDS) {
    if (c.type === 'leader') continue;
    if (c.type === 'unit' && c.token) continue;
    if (c.faction !== faction && c.faction !== 'neutral') continue;
    for (let i = 0; i < c.copies; i++) out.push(c.id);
  }
  return out;
}

/** Cards that started in `p`'s deck and are visible to the viewer right now. */
export function seenFrom(s: GameState, p: PlayerId): string[] {
  const [b0, b1, b2] = s.uidBounds;
  const [lo, hi] = p === 0 ? [b0, b1] : [b1, b2];
  const out: string[] = [];
  const see = (c: Card | null) => {
    if (c && c.uid >= lo && c.uid < hi && c.id !== '?') out.push(c.base ?? c.id);
  };
  for (const P of s.players) {
    P.discard.forEach(see);
    P.hand.forEach(see);
    for (const row of ROWS) {
      P.rows[row].units.forEach(see);
      see(P.rows[row].special);
    }
  }
  for (const w of s.weather) see(w.card);
  return out;
}

/**
 * A full, playable state consistent with what `me` knows. `opponentDeck` is
 * the opponent's deck list when known (practice against a known deck), or
 * null to assume anything their faction could hold.
 */
export function determinize(v: GameState, me: PlayerId, opponentDeck: DeckList | null, rng: Rng): GameState {
  const s = cloneState(v);
  const opp = other(me);
  const O = s.players[opp];

  // Our own deck's order is unknown to us too.
  rng.shuffle(s.players[me].deck);

  const pool = opponentDeck ? expand(opponentDeck) : factionPool(s, opp);
  for (const id of seenFrom(s, opp)) {
    const i = pool.indexOf(id);
    if (i >= 0) pool.splice(i, 1);
  }
  rng.shuffle(pool);

  const need = O.hand.length + O.deck.length;
  // A Crach an Craite shuffle or a stolen card can leave the count off by a
  // little; pad from the faction pool rather than fail.
  if (pool.length < need) {
    const extra = factionPool(s, opp).filter((id) => def(id).type === 'unit');
    while (pool.length < need && extra.length) pool.push(rng.pick(extra));
  }
  let uid = INVENTED_UID;
  const dealt = pool.slice(0, need).map((id) => ({ uid: uid++, id }));
  O.hand = dealt.slice(0, O.hand.length);
  O.deck = dealt.slice(O.hand.length);
  s.nextUid = Math.max(s.nextUid, uid);
  s.rng = (rng.next() * 0xffffffff) >>> 0;
  return s;
}
