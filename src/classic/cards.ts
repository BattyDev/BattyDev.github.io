import rawCards from './data/cards.json';
import rawStarterDecks from './data/starter-decks.json';
import type {
  CardDef,
  DeckList,
  Faction,
  LeaderAbility,
  LeaderDef,
  SpecialEffect,
  UnitAbility,
  UnitDef,
  WeatherEffect,
} from './types';

export const CARDS: readonly CardDef[] = rawCards as CardDef[];

const byId = new Map<string, CardDef>(CARDS.map((c) => [c.id, c]));

export function def(id: string): CardDef {
  const d = byId.get(id);
  if (!d) throw new Error(`unknown card ${id}`);
  return d;
}

export function hasCard(id: string): boolean {
  return byId.has(id);
}

export function unitDef(id: string): UnitDef | null {
  const d = def(id);
  return d.type === 'unit' ? d : null;
}

export function leaderDef(id: string): LeaderDef {
  const d = def(id);
  if (d.type !== 'leader') throw new Error(`${id} is not a leader`);
  return d;
}

export function isSpecialCard(d: CardDef): boolean {
  return d.type === 'special' || d.type === 'weather';
}

export const FACTIONS: readonly Faction[] = ['realms', 'nilfgaard', 'monsters', 'scoiatael', 'skellige'];

export const FACTION_INFO: Record<Faction, { name: string; perk: string }> = {
  realms: { name: 'Northern Realms', perk: 'Draw a card from your deck whenever you win a round.' },
  nilfgaard: { name: 'Nilfgaardian Empire', perk: 'Win any round that ends in a draw.' },
  monsters: { name: 'Monsters', perk: 'Keep a random unit on the battlefield after each round.' },
  scoiatael: { name: "Scoia'tael", perk: 'Decide who takes the first turn.' },
  skellige: { name: 'Skellige', perk: 'At the start of round 3, two random units from your discard pile return to the battlefield.' },
};

export const ABILITY_TEXT: Record<UnitAbility | 'hero' | 'agile', { name: string; text: string }> = {
  hero: { name: 'Hero', text: 'Not affected by special cards, weather or abilities.' },
  agile: { name: 'Agile', text: 'Can be placed in the Close Combat or Ranged Combat row. Cannot move once placed.' },
  medic: { name: 'Medic', text: 'Choose a unit from your discard pile and play it instantly (no heroes or special cards).' },
  spy: { name: 'Spy', text: "Goes to your opponent's battlefield (counts towards their total) and draws you 2 cards." },
  muster: { name: 'Muster', text: 'Finds the matching cards in your deck and plays them instantly.' },
  bond: { name: 'Tight Bond', text: 'Multiplies the strength of each same-named card on the row by how many there are.' },
  morale: { name: 'Morale Boost', text: 'Adds +1 to every other unit on its row.' },
  horn: { name: "Commander's Horn", text: 'Doubles the strength of every other unit on its row. One horn per row.' },
  scorch: { name: 'Scorch', text: 'Destroys the strongest non-hero unit(s) on the whole battlefield.' },
  scorch_close: { name: 'Scorch – Close Combat', text: "If your opponent's Close Combat row totals 10 or more, destroys its strongest unit(s)." },
  scorch_ranged: { name: 'Scorch – Ranged', text: "If your opponent's Ranged Combat row totals 10 or more, destroys its strongest unit(s)." },
  scorch_siege: { name: 'Scorch – Siege', text: "If your opponent's Siege row totals 10 or more, destroys its strongest unit(s)." },
  avenger: { name: 'Avenger', text: 'When removed from the battlefield, summons a powerful unit in its place.' },
  berserker: { name: 'Berserker', text: 'Transforms into a bear when Mardroeme is on its row.' },
  mardroeme: { name: 'Mardroeme', text: 'Transforms every Berserker on its row.' },
};

export const SPECIAL_TEXT: Record<SpecialEffect | WeatherEffect, string> = {
  decoy: 'Swap with a non-hero unit on your side to return it to your hand.',
  horn: 'Doubles the strength of every non-hero unit on the chosen row. One per row.',
  scorch: 'Destroys the strongest non-hero unit(s) on the battlefield, on both sides.',
  mardroeme: 'Transforms every Berserker on the chosen row.',
  frost: 'Sets the strength of every Close Combat unit to 1, for both players.',
  fog: 'Sets the strength of every Ranged Combat unit to 1, for both players.',
  rain: 'Sets the strength of every Siege unit to 1, for both players.',
  storm: 'Sets the strength of every Ranged and Siege unit to 1, for both players.',
  clear: 'Removes every weather effect.',
};

export const LEADER_TEXT: Record<LeaderAbility, { text: string; passive: boolean }> = {
  foltest_king: { text: 'Pick an Impenetrable Fog card from your deck and play it instantly.', passive: false },
  foltest_lord: { text: 'Clear any weather effects in play.', passive: false },
  foltest_siegemaster: { text: "Double the strength of your Siege units (unless a Commander's Horn is already on that row).", passive: false },
  foltest_steelforged: { text: "Destroy your enemy's strongest Siege unit(s) if their Siege row totals 10 or more.", passive: false },
  foltest_son: { text: "Destroy your enemy's strongest Ranged unit(s) if their Ranged row totals 10 or more.", passive: false },
  emhyr_imperial: { text: 'Pick a Torrential Rain card from your deck and play it instantly.', passive: false },
  emhyr_emperor: { text: "Look at 3 random cards from your opponent's hand.", passive: false },
  emhyr_whiteflame: { text: "Cancel your opponent's leader ability.", passive: true },
  emhyr_relentless: { text: "Draw a card from your opponent's discard pile.", passive: false },
  emhyr_invader: { text: 'Abilities that restore a unit to the battlefield restore a random one. Affects both players.', passive: true },
  eredin_commander: { text: "Double the strength of your Close Combat units (unless a Commander's Horn is already on that row).", passive: false },
  eredin_bringer_of_death: { text: 'Restore a card from your discard pile to your hand.', passive: false },
  eredin_destroyer: { text: 'Discard 2 cards and draw 1 card of your choice from your deck.', passive: false },
  eredin_king: { text: 'Pick any weather card from your deck and play it instantly.', passive: false },
  eredin_treacherous: { text: 'Doubles the strength of all spy cards. Affects both players.', passive: true },
  francesca_queen: { text: "Destroy your enemy's strongest Close Combat unit(s) if their Close Combat row totals 10 or more.", passive: false },
  francesca_beautiful: { text: "Double the strength of your Ranged units (unless a Commander's Horn is already on that row).", passive: false },
  francesca_daisy: { text: 'Draw an extra card at the beginning of the battle.', passive: true },
  francesca_pureblood: { text: 'Pick a Biting Frost card from your deck and play it instantly.', passive: false },
  francesca_hope: { text: 'Move your agile units to whichever valid row maximises their strength.', passive: false },
  crach_an_craite: { text: "Shuffle every card from each player's discard pile back into their deck.", passive: false },
  king_bran: { text: 'Your units only lose half their strength in bad weather.', passive: true },
};

export const STARTER_DECKS: readonly DeckList[] = rawStarterDecks as DeckList[];

/** Short description for any card, used by tooltips and the zoom view. */
export function describe(d: CardDef): string[] {
  switch (d.type) {
    case 'leader':
      return [LEADER_TEXT[d.leader].text];
    case 'special':
    case 'weather':
      return [SPECIAL_TEXT[d.effect]];
    case 'unit': {
      const lines: string[] = [];
      if (d.hero) lines.push(ABILITY_TEXT.hero.text);
      if (d.rows.length > 1) lines.push(ABILITY_TEXT.agile.text);
      for (const a of d.abilities) lines.push(ABILITY_TEXT[a].text);
      return lines;
    }
  }
}
