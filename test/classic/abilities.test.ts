import { describe, expect, it } from 'vitest';
import { apply, IllegalAction, legalActions } from '../../src/classic/engine';
import { totalScore } from '../../src/classic/score';
import { boardUid, eventsOf, handUid, ids, play, rowIds, scenario, uidIn } from './helpers';

const FILLER = ['realms.ves', 'realms.ves', 'realms.ves'];

describe('Spy', () => {
  it("lands on the opponent's side and draws its player 2 cards", () => {
    const s = scenario({ me: { hand: ['realms.stennis', ...FILLER], deck: ['realms.keira', 'realms.sabrina', 'realms.sheldon'] } });
    const { state, events } = play(s, 'realms.stennis');
    expect(rowIds(state, 1, 'close')).toEqual(['realms.stennis']);
    expect(rowIds(state, 0, 'close')).toEqual([]);
    expect(state.players[0].hand).toHaveLength(5);
    expect(state.players[0].deck).toHaveLength(1);
    expect(eventsOf(events, 'draw')[0]?.cards).toHaveLength(2);
    expect(totalScore(state, 1)).toBe(5);
  });

  it('draws what is left when the deck is short', () => {
    const s = scenario({ me: { hand: ['realms.stennis', ...FILLER], deck: ['realms.keira'] } });
    expect(play(s, 'realms.stennis').state.players[0].hand).toHaveLength(4);
  });
});

describe('Medic', () => {
  const medicGame = () =>
    scenario({
      me: { hand: ['realms.banner_nurse', ...FILLER], discard: ['realms.ves', 'realms.vernon', 'neutral.decoy', 'realms.keira'] },
    });

  it('asks which non-hero unit to revive: no heroes, no specials', () => {
    const { state } = play(medicGame(), 'realms.banner_nurse');
    expect(state.pending?.kind).toBe('medic');
    const options = state.pending?.options.map((uid) => state.players[0].discard.find((c) => c.uid === uid)?.id);
    expect(options).toEqual(['realms.ves', 'realms.keira']);
    expect(state.current).toBe(0);
  });

  it('plays the chosen unit and then ends the turn', () => {
    let { state } = play(medicGame(), 'realms.banner_nurse');
    state = apply(state, { type: 'choose', uid: uidIn(state.players[0].discard, 'realms.keira') }).state;
    expect(rowIds(state, 0, 'ranged')).toEqual(['realms.keira']);
    expect(rowIds(state, 0, 'siege')).toEqual(['realms.banner_nurse']);
    expect(state.pending).toBeNull();
    expect(state.current).toBe(1);
  });

  it('does nothing with an empty discard pile', () => {
    const s = scenario({ me: { hand: ['realms.banner_nurse', ...FILLER] } });
    const { state } = play(s, 'realms.banner_nurse');
    expect(state.pending).toBeNull();
    expect(state.current).toBe(1);
  });

  it('chains into another Medic', () => {
    const s = scenario({
      me: { hand: FILLER },
      op: { hand: ['nilfgaard.archer_support', ...FILLER], discard: ['nilfgaard.archer_support_1', 'nilfgaard.cahir'] },
      current: 1,
    });
    let { state } = play(s, 'nilfgaard.archer_support');
    state = apply(state, { type: 'choose', uid: uidIn(state.players[1].discard, 'nilfgaard.archer_support_1') }).state;
    expect(state.pending?.kind).toBe('medic');
    state = apply(state, { type: 'choose', uid: uidIn(state.players[1].discard, 'nilfgaard.cahir') }).state;
    expect(ids(state.players[1].rows.ranged.units)).toEqual(['nilfgaard.archer_support', 'nilfgaard.archer_support_1']);
    expect(rowIds(state, 1, 'close')).toEqual(['nilfgaard.cahir']);
    expect(state.current).toBe(0);
  });

  it('revives a spy onto the opponent side and draws 2', () => {
    const s = scenario({ me: { hand: ['realms.banner_nurse', ...FILLER], discard: ['realms.dijkstra'], deck: ['realms.ves', 'realms.ves'] } });
    let { state } = play(s, 'realms.banner_nurse');
    state = apply(state, { type: 'choose', uid: uidIn(state.players[0].discard, 'realms.dijkstra') }).state;
    expect(rowIds(state, 1, 'close')).toEqual(['realms.dijkstra']);
    expect(state.players[0].hand).toHaveLength(5);
  });

  it('asks for a row when reviving an agile unit', () => {
    const s = scenario({ op: { leader: 'scoiatael.francesca_silver', hand: ['scoiatael.havekar_nurse', ...FILLER], discard: ['scoiatael.barclay'] }, current: 1 });
    let { state } = play(s, 'scoiatael.havekar_nurse');
    const choices = legalActions(state);
    expect(choices).toEqual([
      { type: 'choose', uid: state.pending?.options[0], row: 'close' },
      { type: 'choose', uid: state.pending?.options[0], row: 'ranged' },
    ]);
    state = apply(state, choices[1]!).state;
    expect(rowIds(state, 1, 'ranged')).toEqual(['scoiatael.havekar_nurse', 'scoiatael.barclay']);
  });

  it('picks at random under Emhyr, Invader of the North (both players)', () => {
    const s = scenario({
      me: { hand: ['realms.banner_nurse', ...FILLER], discard: ['realms.ves', 'realms.keira', 'realms.sabrina'] },
      op: { leader: 'nilfgaard.emhyr_invader_of_the_north', hand: FILLER },
    });
    const { state } = play(s, 'realms.banner_nurse');
    expect(state.pending).toBeNull();
    expect(state.players[0].discard).toHaveLength(2);
    expect(state.current).toBe(1);
  });
});

describe('Muster', () => {
  it('plays every card of its group from the deck, not the hand', () => {
    const s = scenario({
      op: {
        leader: 'monsters.eredin_silver',
        hand: ['monsters.arachas', 'monsters.arachas_1', ...FILLER],
        deck: ['monsters.arachas_2', 'monsters.arachas_behemoth', 'monsters.ghoul', 'monsters.fiend'],
      },
      current: 1,
    });
    const { state, events } = play(s, 'monsters.arachas');
    expect(rowIds(state, 1, 'close')).toEqual(['monsters.arachas', 'monsters.arachas_2']);
    expect(rowIds(state, 1, 'siege')).toEqual(['monsters.arachas_behemoth']);
    expect(ids(state.players[1].hand)).toContain('monsters.arachas_1');
    expect(ids(state.players[1].deck)).toEqual(['monsters.ghoul', 'monsters.fiend']);
    expect(eventsOf(events, 'muster')[0]?.cards).toHaveLength(2);
  });

  it('Geralt and Ciri call Roach', () => {
    const s = scenario({ me: { hand: ['neutral.geralt', ...FILLER], deck: ['neutral.roach', 'realms.keira'] } });
    expect(rowIds(play(s, 'neutral.geralt').state, 0, 'close')).toEqual(['neutral.geralt', 'neutral.roach']);
  });

  it('Cerys calls her shield maidens, who then bond', () => {
    const s = scenario({
      me: { leader: 'skellige.king_bran', hand: ['skellige.cerys', ...FILLER], deck: ['skellige.shield_maiden', 'skellige.shield_maiden_1', 'skellige.shield_maiden_2'] },
    });
    const { state } = play(s, 'skellige.cerys');
    expect(rowIds(state, 0, 'close')).toHaveLength(4);
    expect(totalScore(state, 0)).toBe(10 + 3 * 12);
  });

  it("the Gaunter O'Dimm group lands on its own rows", () => {
    const s = scenario({ me: { hand: ['neutral.gaunter_odimm', ...FILLER], deck: ['neutral.gaunter_odimm_darkness', 'neutral.gaunter_odimm_darkness'] } });
    const { state } = play(s, 'neutral.gaunter_odimm');
    expect(rowIds(state, 0, 'siege')).toEqual(['neutral.gaunter_odimm']);
    expect(rowIds(state, 0, 'ranged')).toEqual(['neutral.gaunter_odimm_darkness', 'neutral.gaunter_odimm_darkness']);
  });
});

describe('Scorch', () => {
  it('destroys the strongest non-hero units on both sides, ties included', () => {
    const s = scenario({
      me: { hand: ['neutral.scorch', ...FILLER], board: { close: ['realms.vernon', 'realms.ves'], siege: ['realms.ballista'] } },
      op: { board: { close: ['nilfgaard.cahir', 'nilfgaard.rainfarn'] } },
    });
    const { state, events } = play(s, 'neutral.scorch');
    expect(rowIds(state, 0, 'close')).toEqual(['realms.vernon', 'realms.ves']);
    expect(rowIds(state, 0, 'siege')).toEqual([]);
    expect(rowIds(state, 1, 'close')).toEqual(['nilfgaard.rainfarn']);
    expect(eventsOf(events, 'destroy').map((e) => e.card.id)).toEqual(['realms.ballista', 'nilfgaard.cahir']);
    expect(ids(state.players[0].discard)).toEqual(['realms.ballista', 'neutral.scorch']);
  });

  it('uses current strength, after weather and horns', () => {
    const s = scenario({
      me: { hand: ['neutral.scorch', ...FILLER], board: { siege: ['realms.ballista'] } },
      op: { board: { close: ['nilfgaard.rainfarn'] }, specials: { close: 'neutral.horn' } },
    });
    const { state } = play(s, 'neutral.scorch');
    expect(rowIds(state, 1, 'close')).toEqual([]);
    expect(rowIds(state, 0, 'siege')).toEqual(['realms.ballista']);
  });

  it('does nothing when only heroes are on the board', () => {
    const s = scenario({ me: { hand: ['neutral.scorch', ...FILLER], board: { close: ['realms.vernon'] } } });
    expect(rowIds(play(s, 'neutral.scorch').state, 0, 'close')).toEqual(['realms.vernon']);
  });

  it('Villentretenmerth scorches the enemy close row only at 10 or more', () => {
    const base = { me: { hand: ['neutral.villen', ...FILLER] } };
    const under = scenario({ ...base, op: { board: { close: ['nilfgaard.cahir', 'nilfgaard.morteisen'] } } });
    expect(rowIds(play(under, 'neutral.villen').state, 1, 'close')).toHaveLength(2);
    const over = scenario({ ...base, op: { board: { close: ['nilfgaard.cahir', 'nilfgaard.rainfarn', 'nilfgaard.letho'] } } });
    expect(rowIds(play(over, 'neutral.villen').state, 1, 'close')).toEqual(['nilfgaard.rainfarn', 'nilfgaard.letho']);
  });

  it('Clan Dimun Pirate does not count itself', () => {
    const s = scenario({
      me: { leader: 'skellige.king_bran', hand: ['skellige.dimun_pirate', ...FILLER] },
      op: { board: { close: ['nilfgaard.rainfarn'] } },
    });
    const { state } = play(s, 'skellige.dimun_pirate');
    expect(rowIds(state, 0, 'ranged')).toEqual(['skellige.dimun_pirate']);
    expect(rowIds(state, 1, 'close')).toEqual([]);
  });
});

describe('Decoy', () => {
  it('swaps with a non-hero unit, which returns to hand', () => {
    const s = scenario({ me: { hand: ['neutral.decoy', 'realms.keira'], board: { close: ['realms.ves', 'realms.vernon'] } } });
    const targets = legalActions(s).filter((a) => a.type === 'play' && a.target !== undefined);
    expect(targets).toHaveLength(1);
    const { state } = play(s, 'neutral.decoy', { target: 'realms.ves' });
    expect(rowIds(state, 0, 'close')).toEqual(['neutral.decoy', 'realms.vernon']);
    expect(ids(state.players[0].hand)).toEqual(['realms.keira', 'realms.ves']);
  });

  it("takes back the opponent's spy for you to use", () => {
    const s = scenario({ me: { hand: ['neutral.decoy', 'realms.keira'], board: { close: ['nilfgaard.stefan'] } } });
    const { state } = play(s, 'neutral.decoy', { target: 'nilfgaard.stefan' });
    expect(ids(state.players[0].hand)).toContain('nilfgaard.stefan');
  });

  it('cannot be played without a target', () => {
    const s = scenario({ me: { hand: ['neutral.decoy', 'realms.keira'], board: { close: ['realms.vernon'] } } });
    expect(legalActions(s).some((a) => a.type === 'play' && a.uid === handUid(s, 0, 'neutral.decoy'))).toBe(false);
  });

  it('goes to the discard pile at the end of the round', () => {
    const s = scenario({ me: { hand: ['realms.keira'], board: { close: ['neutral.decoy'] } }, op: { hand: ['nilfgaard.cahir'], passed: true } });
    const { state } = apply(s, { type: 'pass' });
    expect(ids(state.players[0].discard)).toContain('neutral.decoy');
  });
});

describe("Commander's Horn card", () => {
  it('takes the row slot, so a second horn on that row is illegal', () => {
    const s = scenario({ me: { hand: ['neutral.horn', 'realms.keira'], board: { close: ['realms.ves'] }, specials: { close: 'neutral.horn' } } });
    const rows = legalActions(s)
      .filter((a) => a.type === 'play' && a.uid === handUid(s, 0, 'neutral.horn'))
      .map((a) => (a.type === 'play' ? a.row : null));
    expect(rows).toEqual(['ranged', 'siege']);
    expect(() => apply(s, { type: 'play', uid: handUid(s, 0, 'neutral.horn'), row: 'close' })).toThrow(IllegalAction);
  });

  it('is discarded at the end of the round', () => {
    const s = scenario({ me: { hand: ['realms.keira'], specials: { siege: 'neutral.horn' } }, op: { hand: ['nilfgaard.cahir'], passed: true } });
    expect(ids(apply(s, { type: 'pass' }).state.players[0].discard)).toEqual(['neutral.horn']);
  });
});

describe('weather cards', () => {
  it('Clear Weather removes all weather; weather cards go to their owners', () => {
    const s = scenario({ op: { hand: ['neutral.clear', ...FILLER] }, weather: ['neutral.frost', 'neutral.fog'], current: 1 });
    const { state } = play(s, 'neutral.clear');
    expect(state.weather).toEqual([]);
    expect(ids(state.players[0].discard)).toEqual(['neutral.frost', 'neutral.fog']);
    expect(ids(state.players[1].discard)).toEqual(['neutral.clear']);
  });
});

describe('Avenger', () => {
  it('Cow summons the Bovine Defense Force when scorched', () => {
    const s = scenario({
      me: { hand: ['neutral.scorch', ...FILLER], board: { ranged: ['neutral.cow'] } },
    });
    const { state, events } = play(s, 'neutral.scorch');
    expect(rowIds(state, 0, 'close')).toEqual(['neutral.chort']);
    expect(eventsOf(events, 'summon')).toHaveLength(1);
  });

  it('Kambi summons Hemdall at the start of the next round', () => {
    const s = scenario({
      me: { leader: 'skellige.king_bran', hand: ['skellige.udalryk'], board: { close: ['skellige.kambi', 'skellige.madmad_lugos'] } },
      op: { hand: ['nilfgaard.cahir'], passed: true },
    });
    const { state } = apply(s, { type: 'pass' });
    expect(state.round).toBe(2);
    expect(rowIds(state, 0, 'close')).toEqual(['skellige.hemdall']);
    expect(ids(state.players[0].discard)).toEqual(['skellige.kambi', 'skellige.madmad_lugos']);
  });

  it('summoned tokens vanish instead of going to the discard pile', () => {
    const s = scenario({
      me: { hand: ['neutral.scorch', ...FILLER], board: { close: ['neutral.chort'] } },
    });
    const { state } = play(s, 'neutral.scorch');
    expect(rowIds(state, 0, 'close')).toEqual([]);
    expect(ids(state.players[0].discard)).toEqual(['neutral.scorch']);
  });
});

describe('Berserker and Mardroeme', () => {
  it('Mardroeme transforms the Berserkers already on its row', () => {
    const s = scenario({
      me: { leader: 'skellige.king_bran', hand: ['neutral.mardroeme', ...FILLER], board: { ranged: ['skellige.young_berserker', 'skellige.young_berserker'] } },
    });
    const { state } = play(s, 'neutral.mardroeme', { row: 'ranged' });
    expect(rowIds(state, 0, 'ranged')).toEqual(['skellige.young_vildkaarl', 'skellige.young_vildkaarl']);
    expect(totalScore(state, 0)).toBe(32); // 8 × 2 bond, twice
  });

  it('a Berserker played onto a Mardroeme row transforms on arrival', () => {
    const s = scenario({
      me: { leader: 'skellige.king_bran', hand: ['skellige.berserker', ...FILLER], specials: { close: 'neutral.mardroeme' } },
    });
    expect(rowIds(play(s, 'skellige.berserker').state, 0, 'close')).toEqual(['skellige.vildkaarl']);
  });

  it('Ermion acts as Mardroeme for his row', () => {
    const s = scenario({
      me: { leader: 'skellige.king_bran', hand: ['skellige.ermion', ...FILLER], board: { ranged: ['skellige.young_berserker'] } },
    });
    expect(rowIds(play(s, 'skellige.ermion').state, 0, 'ranged')).toEqual(['skellige.young_vildkaarl', 'skellige.ermion']);
  });

  it('a transformed card goes to the discard pile as the original Berserker', () => {
    const s = scenario({
      me: { leader: 'skellige.king_bran', hand: ['skellige.berserker', 'realms.keira'], specials: { close: 'neutral.mardroeme' } },
      op: { hand: ['neutral.scorch', 'nilfgaard.cahir'] },
    });
    let { state } = play(s, 'skellige.berserker');
    expect(rowIds(state, 0, 'close')).toEqual(['skellige.vildkaarl']);
    state = play(state, 'neutral.scorch').state;
    expect(rowIds(state, 0, 'close')).toEqual([]);
    expect(ids(state.players[0].discard)).toEqual(['skellige.berserker']);
  });
});

describe('agile units', () => {
  it('may go to close or ranged, never siege', () => {
    const s = scenario({ op: { leader: 'scoiatael.francesca_silver', hand: ['scoiatael.barclay'] }, current: 1 });
    const rows = legalActions(s)
      .filter((a) => a.type === 'play')
      .map((a) => (a.type === 'play' ? a.row : null));
    expect(rows).toEqual(['close', 'ranged']);
  });
});

describe('boardUid helper sanity', () => {
  it('finds cards across rows', () => {
    const s = scenario({ me: { board: { siege: ['realms.ballista'] } } });
    expect(boardUid(s, 0, 'realms.ballista')).toBeGreaterThan(0);
  });
});
