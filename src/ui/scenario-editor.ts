// Scenario editor: lay out any position (cards on each row, hands, discard
// piles, weather, lives) and play it from there against the AI, as many times
// as you like. Good for "I lost this in the game; what should I have done?".

import { BOTS, type BotLevel } from '../ai/bots';
import { CARDS, FACTION_INFO, STARTER_DECKS } from '../classic/cards';
import { decodeScenario, emptySide, encodeScenario, normaliseScenario, scenarioErrors, type Scenario, type ScenarioSide, type ScenarioWeather } from '../classic/scenario';
import type { CardDef, DeckList, PlayerId, Row } from '../classic/types';
import { ROWS } from '../classic/types';
import { icon, shield } from './assets';
import { inspector, tile } from './cards';
import { clear, h } from './dom';
import { siteFooter } from './notice';
import { listDecks } from './library';
import type { MatchSetup } from './match';
import { load, save } from './storage';

const ROW_LABEL: Record<Row, string> = { close: 'Close combat', ranged: 'Ranged', siege: 'Siege' };

interface DeckOption {
  key: string;
  label: string;
  deck: DeckList;
}

function deckOptions(role: 'mine' | 'opponent'): DeckOption[] {
  const starters = STARTER_DECKS.map((d, i) => ({ key: `starter:${i}`, label: `${FACTION_INFO[d.faction].name} starter ${(i % 2) + 1}`, deck: d }));
  const saved = listDecks(role).map((d) => ({ key: `saved:${d.id}`, label: d.name, deck: { faction: d.faction, leader: d.leader, cards: d.cards } as DeckList }));
  return [...saved, ...starters];
}

function defaultScenario(): Scenario {
  const me = emptySide(STARTER_DECKS[0] as DeckList);
  const op = emptySide(STARTER_DECKS[2] as DeckList);
  op.randomHand = 6;
  return { name: 'New scenario', sides: [me, op], weather: [], round: 1, toMove: 0 };
}

/** Cards that can go in a zone of `side`: its faction's and neutral cards. */
function poolFor(sc: Scenario, side: PlayerId, zone: 'hand' | 'discard' | Row): CardDef[] {
  const own = sc.sides[side].deck.faction;
  const other = sc.sides[side === 0 ? 1 : 0].deck.faction;
  const mine = (c: CardDef) => c.faction === own || c.faction === 'neutral';
  const theirs = (c: CardDef) => c.faction === other || c.faction === 'neutral';
  return CARDS.filter((c) => {
    if (c.type === 'leader') return false;
    if (zone === 'hand' || zone === 'discard') return mine(c) && !(c.type === 'unit' && c.token);
    if (c.type !== 'unit' || !c.rows.includes(zone)) return false;
    // Summoned tokens (Hemdall, the Bovine Defense Force) can already be on a
    // row; transformed Berserkers can't be laid out directly.
    if (c.token) return mine(c) && !c.id.includes('vildkaarl');
    // A row holds your own units, or spies the other side played against you.
    return c.abilities.includes('spy') ? theirs(c) : mine(c);
  }).sort((a, b) => {
    const sa = a.type === 'unit' ? a.strength : -1;
    const sb = b.type === 'unit' ? b.strength : -1;
    return sb - sa || a.name.localeCompare(b.name);
  });
}

export function renderScenarioEditor(host: HTMLElement, code: string | null, play: (setup: MatchSetup) => void): () => void {
  let sc: Scenario = defaultScenario();
  // The saved draft may come from an older version: only keep it if it still parses.
  try {
    const draft = load<Scenario | null>('scenarioDraft', null);
    if (draft) {
      sc = normaliseScenario(draft);
      scenarioErrors(sc); // throws only if the shape is beyond repair
    }
  } catch {
    sc = defaultScenario();
  }
  let message = '';
  if (code) {
    try {
      sc = decodeScenario(decodeURIComponent(code));
      message = `Loaded “${sc.name}”.`;
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
  }
  let level: BotLevel = load<BotLevel>('scenarioLevel', 'strong');
  let deckKeys: [string, string] = load<[string, string]>('scenarioDecks', ['starter:0', 'starter:2']);
  let modal: HTMLElement | null = null;

  const persist = () => {
    save('scenarioDraft', sc);
    save('scenarioLevel', level);
    save('scenarioDecks', deckKeys);
  };

  const closeModal = () => {
    modal?.remove();
    modal = null;
  };

  const picker = (side: PlayerId, zone: 'hand' | 'discard' | Row) => {
    closeModal();
    const slot = h('div', { class: 'picker-inspect' });
    const add = (id: string) => {
      const s = sc.sides[side];
      if (zone === 'hand') s.hand.push(id);
      else if (zone === 'discard') s.discard.push(id);
      else s.board[zone].push(id);
      draw();
      picker(side, zone);
    };
    const where = zone === 'hand' ? 'hand' : zone === 'discard' ? 'discard pile' : `${ROW_LABEL[zone].toLowerCase()} row`;
    modal = h(
      'div',
      {
        class: 'modal-backdrop',
        on: {
          click: (e) => {
            if (e.target === modal) closeModal();
          },
        },
      },
      h(
        'div',
        { class: 'modal wide', role: 'dialog', aria: { modal: 'true', label: 'Add a card' } },
        h('h2', null, `Add to ${side === 0 ? 'your' : 'their'} ${where}`),
        h('p', { class: 'muted' }, 'Click cards to add them; close when done.'),
        h(
          'div',
          { class: 'pick-grid' },
          ...poolFor(sc, side, zone).map((d) =>
            tile(
              { uid: -1, id: d.id },
              {
                classes: ['pick'],
                onClick: () => add(d.id),
                onHover: () => {
                  clear(slot);
                  slot.append(inspector({ uid: -1, id: d.id }));
                },
              },
            ),
          ),
        ),
        slot,
        h('div', { class: 'modal-actions' }, h('button', { class: 'btn primary', on: { click: closeModal } }, 'Done')),
      ),
    );
    host.append(modal);
  };

  const chips = (side: PlayerId, zone: 'hand' | 'discard') => {
    const list = sc.sides[side][zone];
    return h(
      'div',
      { class: 'sc-zone' },
      ...list.map((id, i) =>
        tile(
          { uid: -1, id },
          {
            onClick: () => {
              list.splice(i, 1);
              draw();
            },
          },
        ),
      ),
      h('button', { class: 'btn small sc-add', type: 'button', on: { click: () => picker(side, zone) }, aria: { label: `Add a card to ${side === 0 ? 'your' : 'their'} ${zone}` } }, '+'),
    );
  };

  const rowEditor = (side: PlayerId, row: Row) => {
    const s = sc.sides[side];
    const horned = s.horns.includes(row);
    return h(
      'div',
      { class: `sc-row${sc.weather.some((w) => ({ frost: 'close', fog: 'ranged', rain: 'siege' })[w] === row) ? ` weather-${row}` : ''}` },
      h('span', { class: 'sc-row-label' }, ROW_LABEL[row]),
      h(
        'button',
        {
          class: `sc-horn${horned ? ' on' : ''}`,
          type: 'button',
          title: "Commander's Horn on this row",
          aria: { pressed: String(horned), label: `Commander's Horn on ${side === 0 ? 'your' : 'their'} ${ROW_LABEL[row].toLowerCase()} row` },
          on: {
            click: () => {
              s.horns = horned ? s.horns.filter((r) => r !== row) : [...s.horns, row];
              draw();
            },
          },
        },
        h('img', { src: icon('card_special_horn'), alt: '' }),
      ),
      h(
        'div',
        { class: 'sc-zone' },
        ...s.board[row].map((id, i) =>
          tile(
            { uid: -1, id },
            {
              onClick: () => {
                s.board[row].splice(i, 1);
                draw();
              },
            },
          ),
        ),
        h('button', { class: 'btn small sc-add', type: 'button', on: { click: () => picker(side, row) }, aria: { label: `Add a card to this row` } }, '+'),
      ),
    );
  };

  const select = <T extends string>(label: string, value: T, options: [T, string][], on: (v: T) => void) => {
    const el = h('select', { class: 'text', aria: { label } }, ...options.map(([v, text]) => {
      const o = h('option', null, text);
      o.value = v;
      o.selected = v === value;
      return o;
    }));
    el.addEventListener('change', () => {
      on(el.value as T);
      draw();
    });
    return h('label', { class: 'sc-field' }, h('span', null, label), el);
  };

  const check = (label: string, value: boolean, on: (v: boolean) => void) => {
    const box = h('input', { type: 'checkbox' });
    box.checked = value;
    box.addEventListener('change', () => {
      on(box.checked);
      draw();
    });
    return h('label', { class: 'sc-check' }, box, label);
  };

  const draw = () => {
    persist();
    const errors = scenarioErrors(sc);
    const mine = deckOptions('mine');
    const theirs = deckOptions('opponent');
    const nameBox = h('input', { class: 'text deck-name', type: 'text', aria: { label: 'Scenario name' } });
    nameBox.value = sc.name;
    nameBox.addEventListener('input', () => {
      sc.name = nameBox.value.slice(0, 60);
      persist();
    });
    const pickDeck = (side: PlayerId, options: DeckOption[]) => (key: string) => {
      const opt = options.find((o) => o.key === key);
      if (!opt) return;
      deckKeys[side] = key;
      // Changing faction invalidates the cards laid out for that side.
      if (opt.deck.faction !== sc.sides[side].deck.faction) {
        const fresh = emptySide(opt.deck);
        fresh.randomHand = sc.sides[side].randomHand ?? 0;
        fresh.lives = sc.sides[side].lives;
        sc.sides[side] = fresh;
      } else {
        sc.sides[side].deck = opt.deck;
      }
    };
    const randomBox = h('input', { class: 'text sc-num', type: 'number', aria: { label: 'Extra random cards in their hand' } });
    randomBox.min = '0';
    randomBox.max = '20';
    randomBox.value = String(sc.sides[1].randomHand ?? 0);
    randomBox.addEventListener('change', () => {
      sc.sides[1].randomHand = Math.max(0, Math.min(20, Math.floor(Number(randomBox.value) || 0)));
      draw();
    });
    const codeBox = h('input', { class: 'text', type: 'text', aria: { label: 'Scenario code' } });
    codeBox.readOnly = true;
    codeBox.value = errors.length ? '' : encodeScenario(sc);
    const loadBox = h('input', { class: 'text', type: 'text', aria: { label: 'Paste a scenario code' } });
    loadBox.placeholder = 'Paste a scenario code (GS1.…)';

    const side = (p: PlayerId) => sc.sides[p] as ScenarioSide;
    const start = () => {
      const opp = theirs.find((o) => o.key === deckKeys[1]);
      play({
        you: side(0).deck,
        opponent: side(1).deck,
        level,
        youName: 'You',
        opponentName: opp?.key.startsWith('saved:') ? opp.label : BOTS[level].name,
        scenario: structuredClone(sc),
      });
    };

    clear(host);
    host.append(
      h(
        'div',
        { class: 'builder scenario' },
        h(
          'header',
          { class: 'builder-head' },
          h('a', { class: 'btn ghost', href: '#/' }, '← Table'),
          nameBox,
          h(
            'button',
            {
              class: 'btn',
              type: 'button',
              on: {
                click: () => {
                  sc = defaultScenario();
                  deckKeys = ['starter:0', 'starter:2'];
                  message = '';
                  draw();
                },
              },
            },
            'Clear',
          ),
          h('button', { class: 'btn primary', type: 'button', disabled: errors.length > 0, on: { click: start } }, 'Play from here'),
        ),
        message ? h('p', { class: 'muted' }, message) : null,
        h(
          'section',
          { class: 'panel sc-settings' },
          select('Your deck', deckKeys[0], mine.map((o) => [o.key, o.label]), pickDeck(0, mine)),
          select('Their deck', deckKeys[1], theirs.map((o) => [o.key, o.label]), pickDeck(1, theirs)),
          select('Opponent', level, (Object.keys(BOTS) as BotLevel[]).map((k) => [k, BOTS[k].name]), (v) => (level = v)),
          select('Round', String(sc.round) as '1' | '2' | '3', [['1', 'Round 1'], ['2', 'Round 2'], ['3', 'Round 3']], (v) => (sc.round = Number(v) as 1 | 2 | 3)),
          select('Your lives', String(side(0).lives) as '1' | '2', [['2', '2'], ['1', '1']], (v) => (side(0).lives = Number(v) as 1 | 2)),
          select('Their lives', String(side(1).lives) as '1' | '2', [['2', '2'], ['1', '1']], (v) => (side(1).lives = Number(v) as 1 | 2)),
          select('To move', String(sc.toMove) as '0' | '1', [['0', 'You'], ['1', 'Them']], (v) => (sc.toMove = Number(v) as PlayerId)),
          h(
            'div',
            { class: 'sc-checks' },
            ...(['frost', 'fog', 'rain'] as ScenarioWeather[]).map((w) =>
              check({ frost: 'Biting Frost', fog: 'Impenetrable Fog', rain: 'Torrential Rain' }[w], sc.weather.includes(w), (v) => (sc.weather = v ? [...sc.weather, w] : sc.weather.filter((x) => x !== w))),
            ),
            check('You have passed', side(0).passed, (v) => (side(0).passed = v)),
            check('They have passed', side(1).passed, (v) => (side(1).passed = v)),
            check('Your leader is used', side(0).leaderUsed, (v) => (side(0).leaderUsed = v)),
            check('Their leader is used', side(1).leaderUsed, (v) => (side(1).leaderUsed = v)),
          ),
        ),
        errors.length ? h('ul', { class: 'deck-errors' }, ...errors.map((e) => h('li', null, e))) : null,
        h(
          'section',
          { class: 'panel sc-board' },
          h(
            'div',
            { class: 'sc-side-head' },
            h('img', { src: shield(side(1).deck.faction), alt: '' }),
            h('strong', null, 'Them'),
            h('span', { class: 'muted' }, 'Hand:'),
            chips(1, 'hand'),
            h('label', { class: 'sc-field inline' }, h('span', null, '+ random from their deck'), randomBox),
          ),
          h('div', { class: 'sc-side-head' }, h('span', { class: 'muted' }, 'Their discard pile:'), chips(1, 'discard')),
          rowEditor(1, 'siege'),
          rowEditor(1, 'ranged'),
          rowEditor(1, 'close'),
          h('hr'),
          rowEditor(0, 'close'),
          rowEditor(0, 'ranged'),
          rowEditor(0, 'siege'),
          h('div', { class: 'sc-side-head' }, h('img', { src: shield(side(0).deck.faction), alt: '' }), h('strong', null, 'You'), h('span', { class: 'muted' }, 'Hand:'), chips(0, 'hand')),
          h('div', { class: 'sc-side-head' }, h('span', { class: 'muted' }, 'Your discard pile:'), chips(0, 'discard')),
          h('p', { class: 'muted small' }, 'Click a card to remove it. Anything not placed stays in that player’s deck. Spies played against a player sit on that player’s rows.'),
        ),
        h(
          'section',
          { class: 'panel' },
          h('h3', null, 'Share or load'),
          h(
            'div',
            { class: 'import-row' },
            codeBox,
            h(
              'button',
              {
                class: 'btn',
                disabled: errors.length > 0,
                on: {
                  click: async () => {
                    const link = `${location.origin}${location.pathname}#/scenario/${encodeURIComponent(codeBox.value)}`;
                    try {
                      await navigator.clipboard.writeText(link);
                      message = 'Link copied.';
                    } catch {
                      codeBox.select();
                      message = 'Copy the code above.';
                    }
                    draw();
                  },
                },
              },
              'Copy link',
            ),
          ),
          h(
            'div',
            { class: 'import-row' },
            loadBox,
            h(
              'button',
              {
                class: 'btn',
                on: {
                  click: () => {
                    try {
                      sc = decodeScenario(loadBox.value);
                      message = `Loaded “${sc.name}”.`;
                    } catch (e) {
                      message = e instanceof Error ? e.message : String(e);
                    }
                    draw();
                  },
                },
              },
              'Load',
            ),
          ),
        ),
      ),
    );
    host.append(siteFooter());
  };

  draw();
  return closeModal;
}
