import { describe, expect, it } from 'vitest';
import { apply, canUseLeader, legalActions } from '../../src/classic/engine';
import { cardStrength, totalScore } from '../../src/classic/score';
import { eventsOf, ids, rowIds, scenario, uidIn } from './helpers';

const FILLER = ['realms.ves', 'realms.ves', 'realms.ves'];
const leader = { type: 'leader' } as const;

describe('weather from deck', () => {
  it('Foltest, King of Temeria plays Impenetrable Fog from the deck', () => {
    const s = scenario({ me: { leader: 'realms.foltest_silver', hand: FILLER, deck: ['realms.keira', 'neutral.fog'] }, op: { hand: FILLER } });
    const { state } = apply(s, leader);
    expect(ids(state.weather.map((w) => w.card))).toEqual(['neutral.fog']);
    expect(ids(state.players[0].deck)).toEqual(['realms.keira']);
    expect(state.players[0].leaderUsed).toBe(true);
    expect(state.current).toBe(1);
  });

  it('is unavailable with no fog in the deck', () => {
    const s = scenario({ me: { leader: 'realms.foltest_silver', hand: FILLER, deck: ['realms.keira'] } });
    expect(canUseLeader(s, 0)).toBe(false);
  });

  it('Eredin, King of the Wild Hunt picks which weather', () => {
    const s = scenario({
      op: { leader: 'monsters.eredin_copper', hand: FILLER, deck: ['neutral.frost', 'neutral.frost', 'neutral.rain', 'monsters.fiend'] },
      me: { hand: FILLER },
      current: 1,
    });
    let { state } = apply(s, leader);
    expect(state.pending?.kind).toBe('kingWeather');
    expect(state.pending?.options).toHaveLength(2);
    state = apply(state, { type: 'choose', uid: uidIn(state.players[1].deck, 'neutral.rain') }).state;
    expect(ids(state.weather.map((w) => w.card))).toEqual(['neutral.rain']);
    expect(state.current).toBe(0);
  });
});

describe('leader horns', () => {
  it('Foltest, the Siegemaster doubles siege for the round', () => {
    const s = scenario({ me: { leader: 'realms.foltest_copper', hand: FILLER, board: { siege: ['realms.ballista'] } }, op: { hand: FILLER } });
    const { state } = apply(s, leader);
    expect(totalScore(state, 0)).toBe(12);
  });

  it("can't go on a row that already has a horn", () => {
    const s = scenario({ me: { leader: 'monsters.eredin_silver', hand: FILLER, specials: { close: 'neutral.horn' } } });
    expect(canUseLeader(s, 0)).toBe(false);
  });

  it('a horn card cannot follow a leader horn on the same row', () => {
    const s = scenario({ me: { leader: 'scoiatael.francesca_gold', hand: ['neutral.horn'], leaderHorn: ['ranged'] } });
    const rows = legalActions(s).flatMap((a) => (a.type === 'play' ? [a.row] : []));
    expect(rows).toEqual(['close', 'siege']);
  });
});

describe('leader scorches', () => {
  it('Foltest, the Steel-Forged scorches enemy siege at 10 or more', () => {
    const s = scenario({
      me: { leader: 'realms.foltest_bronze', hand: FILLER },
      op: { hand: FILLER, board: { siege: ['nilfgaard.heavy_zerri', 'nilfgaard.zerri', 'nilfgaard.moorvran'] } },
    });
    const { state } = apply(s, leader);
    expect(rowIds(state, 1, 'siege')).toEqual(['nilfgaard.zerri', 'nilfgaard.moorvran']);
  });

  it('is unavailable below 10', () => {
    const s = scenario({ me: { leader: 'realms.foltest_bronze', hand: FILLER }, op: { board: { siege: ['nilfgaard.zerri'] } } });
    expect(canUseLeader(s, 0)).toBe(false);
  });
});

describe('Emhyr', () => {
  it('the White Flame cancels the other leader', () => {
    const s = scenario({ me: { leader: 'realms.foltest_gold', hand: FILLER }, op: { leader: 'nilfgaard.emhyr_bronze' }, weather: ['neutral.frost'] });
    expect(s.players[0].leaderDisabled).toBe(true);
    expect(canUseLeader(s, 0)).toBe(false);
  });

  it('Emperor of Nilfgaard reveals 3 cards from the opponent hand', () => {
    const s = scenario({ me: { hand: FILLER }, op: { leader: 'nilfgaard.emhyr_copper', hand: FILLER }, current: 1 });
    const { events } = apply(s, leader);
    expect(eventsOf(events, 'reveal')[0]?.cards).toHaveLength(3);
  });

  it('the Relentless takes a unit from the opponent discard pile', () => {
    const s = scenario({ me: { hand: FILLER, discard: ['realms.keira', 'realms.vernon'] }, op: { leader: 'nilfgaard.emhyr_gold', hand: FILLER }, current: 1 });
    let { state } = apply(s, leader);
    expect(state.pending?.options).toEqual([uidIn(s.players[0].discard, 'realms.keira')]);
    state = apply(state, { type: 'choose', uid: uidIn(state.players[0].discard, 'realms.keira') }).state;
    expect(ids(state.players[1].hand)).toContain('realms.keira');
    expect(ids(state.players[0].discard)).toEqual(['realms.vernon']);
  });
});

describe('Eredin', () => {
  it('Bringer of Death restores a unit from your discard pile to hand', () => {
    const s = scenario({ me: { leader: 'monsters.eredin_bronze', hand: FILLER, discard: ['monsters.fiend'] }, op: { hand: FILLER } });
    let { state } = apply(s, leader);
    state = apply(state, { type: 'choose', uid: state.pending?.options[0] as number }).state;
    expect(ids(state.players[0].hand)).toContain('monsters.fiend');
    expect(state.current).toBe(1);
  });

  it('Destroyer of Worlds discards 2, then draws 1 of your choice', () => {
    const s = scenario({
      me: { leader: 'monsters.eredin_gold', hand: ['monsters.fogling', 'monsters.wyvern', 'monsters.draug'], deck: ['monsters.imlerith', 'monsters.fiend'] },
      op: { hand: FILLER },
    });
    let { state } = apply(s, leader);
    state = apply(state, { type: 'choose', uid: uidIn(state.players[0].hand, 'monsters.fogling') }).state;
    expect(state.pending?.kind).toBe('destroyerDiscard');
    state = apply(state, { type: 'choose', uid: uidIn(state.players[0].hand, 'monsters.wyvern') }).state;
    expect(state.pending?.kind).toBe('destroyerDraw');
    state = apply(state, { type: 'choose', uid: uidIn(state.players[0].deck, 'monsters.imlerith') }).state;
    expect(ids(state.players[0].hand).sort()).toEqual(['monsters.draug', 'monsters.imlerith']);
    expect(ids(state.players[0].discard).sort()).toEqual(['monsters.fogling', 'monsters.wyvern']);
    expect(state.current).toBe(1);
  });
});

describe('Francesca', () => {
  it('Hope of the Aen Seidhe moves agile units to their best rows', () => {
    const s = scenario({
      me: {
        leader: 'scoiatael.francesca_hope_of_the_aen_seidhe',
        hand: FILLER,
        board: { close: ['scoiatael.barclay', 'scoiatael.mahakam'], ranged: ['scoiatael.dol_archer'] },
        specials: { ranged: 'neutral.horn' },
      },
      op: { hand: FILLER },
    });
    const before = totalScore(s, 0);
    const { state, events } = apply(s, leader);
    expect(rowIds(state, 0, 'ranged')).toEqual(['scoiatael.dol_archer', 'scoiatael.barclay']);
    expect(totalScore(state, 0)).toBe(before + 6);
    expect(eventsOf(events, 'move')).toHaveLength(1);
  });

  it('Daisy of the Valley starts with 11 cards', async () => {
    const { newGame } = await import('../../src/classic/engine');
    const { STARTER_DECKS } = await import('../../src/classic/cards');
    const scoia = STARTER_DECKS.find((d) => d.faction === 'scoiatael')!;
    const realms = STARTER_DECKS.find((d) => d.faction === 'realms')!;
    const { state } = newGame({
      seed: 1,
      players: [
        { name: 'A', deck: { ...scoia, leader: 'scoiatael.francesca_copper' } },
        { name: 'B', deck: realms },
      ],
    });
    expect(state.players[0].hand).toHaveLength(11);
    expect(state.players[1].hand).toHaveLength(10);
  });
});

describe('Skellige leaders', () => {
  it('Crach an Craite shuffles both discard piles into the decks', () => {
    const s = scenario({
      me: { leader: 'skellige.crach_an_craite', hand: FILLER, deck: ['skellige.udalryk'], discard: ['skellige.donar', 'skellige.svanrige'] },
      op: { hand: FILLER, discard: ['nilfgaard.cahir'] },
    });
    const { state } = apply(s, leader);
    expect(state.players[0].deck).toHaveLength(3);
    expect(state.players[0].discard).toHaveLength(0);
    expect(ids(state.players[1].deck)).toEqual(['nilfgaard.cahir']);
  });

  it('King Bran is passive', () => {
    const s = scenario({ me: { leader: 'skellige.king_bran', hand: FILLER } });
    expect(canUseLeader(s, 0)).toBe(false);
    expect(legalActions(s).some((a) => a.type === 'leader')).toBe(false);
  });
});

describe('leaders are once per game', () => {
  it('cannot be used twice', () => {
    const s = scenario({ me: { leader: 'realms.foltest_copper', hand: FILLER, leaderUsed: true } });
    expect(canUseLeader(s, 0)).toBe(false);
    const st = scenario({ me: { leader: 'realms.foltest_copper', hand: FILLER, board: { siege: ['realms.ballista'] } } });
    expect(cardStrength(st, 0, 'siege', st.players[0].rows.siege.units[0]!)).toBe(6);
  });
});
