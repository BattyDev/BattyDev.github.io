// Turns engine events into the sentences shown in the game log and toasts,
// from the human player's point of view.

import { CARDS, def } from '../classic/cards';
import type { LeaderAbility } from '../classic/types';
import type { Card, GameEvent, PlayerId, Row } from '../classic/types';
import { HIDDEN } from '../classic/view';

const ROW_NAME: Record<Row, string> = { close: 'close combat', ranged: 'ranged', siege: 'siege' };

const WEATHER_NAME = {
  frost: 'Biting Frost',
  fog: 'Impenetrable Fog',
  rain: 'Torrential Rain',
  storm: 'Skellige Storm',
  clear: 'Clear Weather',
} as const;

const LEADER_NAME = Object.fromEntries(
  CARDS.flatMap((c) => (c.type === 'leader' ? [[c.leader, c.name.replace(' - ', ', ')]] : [])),
) as Record<LeaderAbility, string>;

export function cardName(c: Card): string {
  return c.id === HIDDEN ? 'a card' : def(c.id).name;
}

function names(cards: Card[]): string {
  const counts = new Map<string, number>();
  for (const c of cards) counts.set(cardName(c), (counts.get(cardName(c)) ?? 0) + 1);
  return [...counts].map(([n, k]) => (k > 1 ? `${n} ×${k}` : n)).join(', ');
}

export interface Line {
  text: string;
  who: 'me' | 'op' | 'game';
  /** Worth a toast as well as a log line. */
  toast?: boolean;
}

export function narrate(e: GameEvent, me: PlayerId, opName: string): Line | null {
  const who = (p: PlayerId): Line['who'] => (p === me ? 'me' : 'op');
  const subject = (p: PlayerId) => (p === me ? 'You' : opName);
  switch (e.type) {
    case 'coin':
      return {
        who: 'game',
        toast: true,
        text: e.chosen
          ? `${e.first === me ? 'You go' : `${opName} goes`} first.`
          : `Coin toss: ${e.first === me ? 'you go' : `${opName} goes`} first.`,
      };
    case 'redraw':
      return e.player === me ? { who: 'me', text: `You redrew ${cardName(e.out)} for ${e.in ? cardName(e.in) : 'nothing'}.` } : null;
    case 'roundStart':
      return { who: 'game', toast: true, text: `Round ${e.round}. ${e.first === me ? 'You start.' : `${opName} starts.`}` };
    case 'play': {
      const d = def(e.card.id);
      const where = e.row && d.type === 'unit' ? ` (${ROW_NAME[e.row]}${e.side !== e.player ? `, ${e.side === me ? 'your' : 'their'} side` : ''})` : '';
      const onRow = e.row && d.type === 'special' ? ` on ${ROW_NAME[e.row]}` : '';
      return { who: who(e.player), text: `${subject(e.player)} played ${d.name}${where}${onRow}.` };
    }
    case 'decoy':
      return { who: who(e.player), text: `${subject(e.player)} used a Decoy to take back ${cardName(e.returned)}.` };
    case 'leader':
      return { who: who(e.player), toast: e.player !== me, text: `${subject(e.player)} used ${LEADER_NAME[e.ability]}.` };
    case 'pass':
      return {
        who: who(e.player),
        toast: true,
        text: e.auto ? `${subject(e.player)} ${e.player === me ? 'have' : 'has'} nothing to play and passed.` : `${subject(e.player)} passed.`,
      };
    case 'draw':
      if (e.reason === 'start') return null;
      return {
        who: who(e.player),
        text: e.player === me ? `You drew ${names(e.cards)}.` : `${opName} drew ${e.cards.length} card${e.cards.length === 1 ? '' : 's'}.`,
      };
    case 'muster':
      return { who: who(e.player), text: `Muster: ${names(e.cards)} joined from the deck.` };
    case 'revive':
      return { who: who(e.player), text: `${e.reason === 'medic' ? 'Medic' : 'Restored'}: ${cardName(e.card)} returns to the battlefield.` };
    case 'destroy':
      return {
        who: e.side === me ? 'op' : 'me',
        toast: true,
        text: `${e.reason === 'scorch' ? 'Scorch' : 'Scorched'}: ${cardName(e.card)} (${e.side === me ? 'yours' : 'theirs'}) destroyed.`,
      };
    case 'summon':
      return { who: who(e.side), toast: true, text: `${cardName(e.card)} takes the field!` };
    case 'transform':
      return { who: who(e.side), text: `${cardName(e.from)} transforms into ${cardName(e.to)}.` };
    case 'weather':
      return { who: who(e.player), toast: true, text: e.effect === 'clear' ? 'The skies clear.' : `${WEATHER_NAME[e.effect]}!` };
    case 'leaderHorn':
      return { who: who(e.player), text: `A leader's horn sounds over the ${ROW_NAME[e.row]} row.` };
    case 'move':
      return { who: who(e.side), text: `${cardName(e.card)} moves to ${ROW_NAME[e.to]}.` };
    case 'toHand':
      return {
        who: who(e.player),
        text: `${subject(e.player)} took ${cardName(e.card)} from ${e.from === 'deck' ? 'the deck' : e.from === 'discard' ? 'the discard pile' : "the opponent's discard pile"}.`,
      };
    case 'discard':
      return { who: who(e.player), text: `${subject(e.player)} discarded ${cardName(e.card)}.` };
    case 'reveal':
      return e.player === me ? { who: 'me', toast: true, text: `${opName}'s hand includes ${names(e.cards)}.` } : { who: 'op', text: `${opName} looked at 3 of your cards.` };
    case 'shuffleDiscards':
      return { who: 'game', text: 'Both discard piles were shuffled back into the decks.' };
    case 'perk': {
      const text = {
        realms: `Northern Realms: ${e.player === me ? 'you draw' : `${opName} draws`} a card for winning the round.`,
        monsters: `Monsters: ${names(e.cards)} stays on the battlefield.`,
        skellige: `Skellige: ${names(e.cards)} return${e.cards.length === 1 ? 's' : ''} from the discard pile.`,
        nilfgaard: '',
        scoiatael: '',
      }[e.faction];
      return text ? { who: who(e.player), toast: true, text } : null;
    }
    case 'roundEnd': {
      const [mine, theirs] = [e.scores[me], e.scores[me === 0 ? 1 : 0]];
      const res = e.winner === null ? 'Draw' : e.winner === me ? 'You win the round' : `${opName} wins the round`;
      return { who: 'game', text: `Round ${e.round}: ${res}, ${mine}–${theirs}.` };
    }
    case 'gameOver':
      return { who: 'game', text: e.winner === 'draw' ? 'The match is a draw.' : e.winner === me ? 'You win the match!' : `${opName} wins the match.` };
  }
}

/** An action in a few words, for the coach: "Ves → close combat", "Pass". */
export function describeAction(s: import('../classic/types').GameState, a: import('../classic/types').Action): string {
  const find = (uid: number): Card | undefined => {
    for (const P of s.players) {
      const c = P.hand.find((x) => x.uid === uid) ?? P.discard.find((x) => x.uid === uid) ?? P.deck.find((x) => x.uid === uid);
      if (c) return c;
      for (const r of Object.values(P.rows)) {
        const u = r.units.find((x) => x.uid === uid);
        if (u) return u;
      }
    }
    return undefined;
  };
  const nameOf = (uid: number) => {
    const c = find(uid);
    return c ? cardName(c) : 'a card';
  };
  switch (a.type) {
    case 'pass':
      return 'Pass';
    case 'leader':
      return 'Use your leader';
    case 'play': {
      const n = nameOf(a.uid);
      if (a.target !== undefined) return `${n} → take back ${nameOf(a.target)}`;
      const c = find(a.uid);
      const d = c && def(c.id);
      if (a.row && d && (d.type === 'special' || (d.type === 'unit' && d.rows.length > 1))) return `${n} → ${ROW_NAME[a.row]}`;
      return n;
    }
    case 'choose':
      return `${nameOf(a.uid)}${a.row ? ` → ${ROW_NAME[a.row]}` : ''}`;
    case 'redraw':
      return `Redraw ${nameOf(a.uid)}`;
    case 'endRedraw':
      return 'Keep hand';
    case 'chooseFirst':
      return a.first === 0 ? 'Go first' : 'Go second';
  }
}
