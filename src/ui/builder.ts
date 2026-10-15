// Deck builder: your own decks, and the decks of opponents you want to
// practise against (rebuild what an in-game opponent plays, card by card).

import { AiClient } from '../ai/client';
import { CARDS, def, FACTION_INFO, FACTIONS, LEADER_TEXT, STARTER_DECKS } from '../classic/cards';
import { deckStats, MAX_SPECIALS, MIN_UNITS, validateDeck } from '../classic/deck';
import { decodeDeck, encodeDeck } from '../classic/deckcode';
import type { CardDef, DeckList, Faction, Row } from '../classic/types';
import { artSm, shield } from './assets';
import { inspector, tile } from './cards';
import { clear, h } from './dom';
import { siteFooter } from './notice';
import { deleteDeck, getDeck, listDecks, newDeckId, owned, saveDeck, setOwned, type DeckRole, type SavedDeck } from './library';

type Filter = 'all' | Row | 'agile' | 'hero' | 'special';

const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['close', 'Close'],
  ['ranged', 'Ranged'],
  ['siege', 'Siege'],
  ['agile', 'Agile'],
  ['hero', 'Heroes'],
  ['special', 'Special & weather'],
];

function matches(d: CardDef, f: Filter, q: string): boolean {
  if (q && !d.name.toLowerCase().includes(q)) return false;
  switch (f) {
    case 'all':
      return true;
    case 'special':
      return d.type === 'special' || d.type === 'weather';
    case 'hero':
      return d.type === 'unit' && d.hero;
    case 'agile':
      return d.type === 'unit' && d.rows.length > 1;
    default:
      return d.type === 'unit' && d.rows.length === 1 && d.rows[0] === f;
  }
}

function poolFor(f: Faction): CardDef[] {
  return CARDS.filter((c) => c.type !== 'leader' && !(c.type === 'unit' && c.token) && (c.faction === f || c.faction === 'neutral')).sort((a, b) => {
    const order = (d: CardDef) => (d.type === 'unit' ? (d.hero ? 0 : 1) : d.type === 'special' ? 2 : 3);
    const sa = a.type === 'unit' ? a.strength : 0;
    const sb = b.type === 'unit' ? b.strength : 0;
    return order(a) - order(b) || sb - sa || a.name.localeCompare(b.name);
  });
}

function blankDeck(role: DeckRole, faction: Faction = 'realms'): SavedDeck {
  const starter = STARTER_DECKS.find((d) => d.faction === faction) as DeckList;
  return { id: newDeckId(), role, name: role === 'mine' ? 'My deck' : 'Opponent deck', faction, leader: starter.leader, cards: [], updated: Date.now() };
}

/** The list of decks, with buttons to make, edit, import and remove. */
export function renderDeckList(host: HTMLElement): void {
  const draw = () => {
    const section = (role: DeckRole, title: string, blurb: string) => {
      const decks = listDecks(role);
      return h(
        'section',
        { class: 'panel' },
        h('h2', null, title),
        h('p', { class: 'muted' }, blurb),
        decks.length
          ? h(
              'ul',
              { class: 'deck-list' },
              ...decks.map((d) => {
                const errors = validateDeck(d);
                return h(
                  'li',
                  null,
                  h('img', { src: shield(d.faction), alt: '' }),
                  h('div', null, h('strong', null, d.name), h('span', { class: 'muted' }, `${FACTION_INFO[d.faction].name} · ${deckStats(d).total} cards${errors.length ? ' · not legal yet' : ''}`)),
                  h('a', { class: 'btn small', href: `#/decks/${d.id}` }, 'Edit'),
                  h(
                    'button',
                    {
                      class: 'btn small',
                      on: {
                        click: () => {
                          if (confirm(`Delete “${d.name}”?`)) {
                            deleteDeck(d.id);
                            draw();
                          }
                        },
                      },
                    },
                    'Delete',
                  ),
                );
              }),
            )
          : h('p', null, 'None yet.'),
        h('div', { class: 'modal-actions start' }, h('a', { class: 'btn primary', href: `#/decks/new-${role}` }, role === 'mine' ? 'New deck' : 'New opponent deck')),
      );
    };
    const importBox = h('input', { class: 'text', type: 'text', aria: { label: 'Deck code' } });
    importBox.placeholder = 'Paste a deck code (GW1.…)';
    const msg = h('p', { class: 'muted' });
    clear(host);
    host.append(
      h(
        'div',
        { class: 'menu' },
        h('header', { class: 'menu-head' }, h('h1', null, 'Decks'), h('p', null, h('a', { href: '#/' }, '← Back to the table'), ' · ', h('a', { href: '#/collection' }, 'My collection'))),
        section('mine', 'Your decks', 'Build the deck you actually have in the game, then test it here first.'),
        section(
          'opponent',
          'Opponents',
          'Rebuild a deck an in-game opponent plays (you can see their cards as they play them) and practise against it as often as you like. The AI plays it, and the coach knows its list.',
        ),
        h(
          'section',
          { class: 'panel' },
          h('h2', null, 'Import'),
          h(
            'div',
            { class: 'import-row' },
            importBox,
            h(
              'button',
              {
                class: 'btn',
                on: {
                  click: () => {
                    try {
                      const d = decodeDeck(importBox.value);
                      const saved: SavedDeck = { ...d, id: newDeckId(), role: 'mine', updated: Date.now() };
                      saveDeck(saved);
                      location.hash = `#/decks/${saved.id}`;
                    } catch (e) {
                      msg.textContent = e instanceof Error ? e.message : String(e);
                    }
                  },
                },
              },
              'Import',
            ),
          ),
          msg,
        ),
      ),
    );
    host.append(siteFooter());
  };
  draw();
}

/** Ticks off which cards you own in the game; the builder can filter by it. */
export function renderCollection(host: HTMLElement): void {
  let faction: Faction | 'neutral' = 'realms';
  const draw = () => {
    const have = owned();
    const pool = CARDS.filter((c) => c.type !== 'leader' && !(c.type === 'unit' && c.token) && c.faction === faction);
    const leaders = CARDS.filter((c) => c.type === 'leader' && c.faction === faction);
    const all = [...leaders, ...pool];
    const count = all.filter((c) => have.has(c.id)).length;
    clear(host);
    host.append(
      h(
        'div',
        { class: 'menu' },
        h('header', { class: 'menu-head' }, h('h1', null, 'Collection'), h('p', null, h('a', { href: '#/decks' }, '← Decks'), ' · Tick the cards you own in the game.')),
        h(
          'section',
          { class: 'panel' },
          h(
            'div',
            { class: 'faction-picker' },
            ...[...FACTIONS, 'neutral' as const].map((f) =>
              h(
                'button',
                {
                  class: `faction${faction === f ? ' on' : ''}`,
                  type: 'button',
                  on: {
                    click: () => {
                      faction = f;
                      draw();
                    },
                  },
                },
                f === 'neutral' ? h('span', { class: 'any-mark' }, 'N') : h('img', { src: shield(f), alt: '' }),
                h('span', null, f === 'neutral' ? 'Neutral' : FACTION_INFO[f].name),
              ),
            ),
          ),
          h('p', null, `${count} of ${all.length} owned.`),
          h(
            'div',
            { class: 'collection-grid' },
            ...all.map((c) => {
              const box = h('input', {
                type: 'checkbox',
                on: { change: (e) => setOwned(c.id, (e.target as HTMLInputElement).checked) },
              });
              box.checked = have.has(c.id);
              return h('label', { class: 'collect' }, tile({ uid: -1, id: c.id }), h('span', null, box, c.name));
            }),
          ),
        ),
      ),
    );
    host.append(siteFooter());
  };
  draw();
}

/** Returns a cleanup function that stops the builder's test worker. */
export function renderBuilder(host: HTMLElement, idOrNew: string): () => void {
  const existing = getDeck(idOrNew);
  const deck: SavedDeck = existing ? structuredClone(existing) : blankDeck(idOrNew === 'new-opponent' ? 'opponent' : 'mine');
  let filter: Filter = 'all';
  let query = '';
  let onlyOwned = false;
  let dirty = !existing;
  let testResult = '';
  let inspected: string | null = null;
  const ai = new AiClient();

  const count = (id: string) => deck.cards.find(([x]) => x === id)?.[1] ?? 0;
  const setCount = (id: string, n: number) => {
    const rest = deck.cards.filter(([x]) => x !== id);
    deck.cards = n > 0 ? [...rest, [id, n]] : rest;
    dirty = true;
    testResult = '';
  };

  const save = () => {
    saveDeck(deck);
    dirty = false;
    if (!existing) history.replaceState(null, '', `#/decks/${deck.id}`);
    draw();
  };

  const draw = () => {
    const stats = deckStats(deck);
    const errors = validateDeck(deck);
    const have = owned();
    const pool = poolFor(deck.faction).filter((d) => matches(d, filter, query) && (!onlyOwned || have.has(d.id)));

    const nameBox = h('input', { class: 'text deck-name', type: 'text', aria: { label: 'Deck name' } });
    nameBox.value = deck.name;
    nameBox.addEventListener('input', () => {
      deck.name = nameBox.value.slice(0, 60);
      dirty = true;
    });

    const factionPicker = h(
      'div',
      { class: 'faction-picker' },
      ...FACTIONS.map((f) =>
        h(
          'button',
          {
            class: `faction${deck.faction === f ? ' on' : ''}`,
            type: 'button',
            on: {
              click: () => {
                if (f === deck.faction) return;
                const hasFactionCards = deck.cards.some(([id]) => def(id).faction !== 'neutral');
                if (hasFactionCards && !confirm('Switching faction removes the faction cards from this deck. Continue?')) return;
                deck.faction = f;
                deck.cards = deck.cards.filter(([id]) => def(id).faction === 'neutral');
                deck.leader = (STARTER_DECKS.find((d) => d.faction === f) as DeckList).leader;
                dirty = true;
                draw();
              },
            },
          },
          h('img', { src: shield(f), alt: '' }),
          h('span', null, FACTION_INFO[f].name),
        ),
      ),
    );

    const leaders = h(
      'div',
      { class: 'leader-picker compact' },
      ...CARDS.filter((c) => c.type === 'leader' && c.faction === deck.faction).map((l) =>
        h(
          'button',
          {
            class: `leader-option${deck.leader === l.id ? ' on' : ''}`,
            type: 'button',
            title: l.type === 'leader' ? LEADER_TEXT[l.leader].text : '',
            on: {
              click: () => {
                deck.leader = l.id;
                dirty = true;
                draw();
              },
            },
          },
          h('img', { src: artSm(l.id), alt: '', loading: 'lazy' }),
          h('span', { class: 'leader-name' }, l.name.replace(/^.*? - /, '')),
        ),
      ),
    );

    const search = h('input', { class: 'text', type: 'search', aria: { label: 'Search cards' } });
    search.placeholder = 'Search';
    search.value = query;
    search.addEventListener('input', () => {
      query = search.value.toLowerCase();
      draw();
      (host.querySelector('input[type=search]') as HTMLInputElement | null)?.focus();
    });
    const ownedBox = h('input', {
      type: 'checkbox',
      on: {
        change: (e) => {
          onlyOwned = (e.target as HTMLInputElement).checked;
          draw();
        },
      },
    });
    ownedBox.checked = onlyOwned;

    const poolGrid = h(
      'div',
      { class: 'pool-grid' },
      ...pool.map((d) => {
        const n = count(d.id);
        const full = n >= d.copies;
        return h(
          'div',
          { class: `pool-card${full ? ' full' : ''}` },
          tile(
            { uid: -1, id: d.id },
            {
              onClick: () => {
                if (!full) setCount(d.id, n + 1);
                inspected = d.id;
                draw();
              },
              onHover: () => showInspect(d.id),
            },
          ),
          h('span', { class: 'pool-count' }, `${n}/${d.copies}`),
        );
      }),
    );

    const groups: [string, (d: CardDef) => boolean][] = [
      ['Close combat', (d) => d.type === 'unit' && d.rows.length === 1 && d.rows[0] === 'close'],
      ['Ranged', (d) => d.type === 'unit' && d.rows.length === 1 && d.rows[0] === 'ranged'],
      ['Siege', (d) => d.type === 'unit' && d.rows.length === 1 && d.rows[0] === 'siege'],
      ['Agile', (d) => d.type === 'unit' && d.rows.length > 1],
      ['Special', (d) => d.type === 'special'],
      ['Weather', (d) => d.type === 'weather'],
    ];
    const deckList = h(
      'div',
      { class: 'deck-cards' },
      ...groups.map(([title, test]) => {
        const items = deck.cards.filter(([id]) => test(def(id))).sort(([a], [b]) => def(a).name.localeCompare(def(b).name));
        if (!items.length) return null;
        return h(
          'div',
          { class: 'deck-group' },
          h('h4', null, title),
          ...items.map(([id, n]) => {
            const d = def(id);
            return h(
              'button',
              {
                class: 'deck-line',
                type: 'button',
                title: 'Remove one',
                on: {
                  click: () => {
                    setCount(id, n - 1);
                    draw();
                  },
                  mouseenter: () => showInspect(id),
                },
              },
              h('img', { src: artSm(id), alt: '', loading: 'lazy' }),
              h('span', { class: 'deck-line-name' }, d.name),
              d.type === 'unit' ? h('span', { class: `deck-line-str${d.hero ? ' hero' : ''}` }, d.strength) : h('span'),
              h('span', { class: 'deck-line-n' }, n > 1 ? `×${n}` : ''),
            );
          }),
        );
      }),
    );

    const opponents: { label: string; deck: DeckList }[] = [
      ...STARTER_DECKS.map((d, i) => ({ label: `${FACTION_INFO[d.faction].name} starter ${(i % 2) + 1}`, deck: d })),
      ...listDecks('opponent')
        .filter((d) => d.id !== deck.id && validateDeck(d).length === 0)
        .map((d) => ({ label: d.name, deck: d as DeckList })),
    ];
    const oppSelect = h('select', { class: 'text', aria: { label: 'Test against' } }, ...opponents.map((o, i) => {
      const opt = h('option', null, o.label);
      opt.value = String(i);
      return opt;
    }));
    const testBtn = h(
      'button',
      {
        class: 'btn',
        disabled: errors.length > 0,
        on: {
          click: async () => {
            const opp = opponents[Number(oppSelect.value)] as (typeof opponents)[number];
            testBtn.disabled = true;
            testBtn.textContent = 'Testing…';
            const r = await ai.batch({ deck, opponent: opp.deck, games: 100, seed: Date.now() % 100000 });
            const n = r.wins + r.losses + r.draws;
            testResult = `Against ${opp.label}: won ${r.wins} of ${n} (${Math.round((100 * r.wins) / n)}%), ${r.draws} draws. Quick bots on both sides, so treat it as a rough guide.`;
            draw();
          },
        },
      },
      'Test 100 games',
    );

    const code = h('input', { class: 'text', type: 'text', aria: { label: 'Deck code' } });
    code.readOnly = true;
    code.value = encodeDeck(deck);

    clear(host);
    host.append(
      h(
        'div',
        { class: 'builder' },
        h(
          'header',
          { class: 'builder-head' },
          h(
            'a',
            {
              class: 'btn ghost',
              href: '#/decks',
              on: {
                click: (e) => {
                  if (dirty && !confirm('Leave without saving?')) e.preventDefault();
                },
              },
            },
            '← Decks',
          ),
          nameBox,
          h(
            'div',
            { class: 'role-toggle', role: 'radiogroup', aria: { label: 'Whose deck' } },
            ...(['mine', 'opponent'] as const).map((r) =>
              h(
                'button',
                {
                  class: `chip${deck.role === r ? ' on' : ''}`,
                  type: 'button',
                  role: 'radio',
                  aria: { checked: String(deck.role === r) },
                  on: {
                    click: () => {
                      deck.role = r;
                      dirty = true;
                      draw();
                    },
                  },
                },
                r === 'mine' ? 'My deck' : 'An opponent’s',
              ),
            ),
          ),
          h('button', { class: 'btn primary', on: { click: save } }, dirty ? 'Save' : 'Saved'),
        ),
        h('section', { class: 'panel' }, factionPicker, h('h3', null, 'Leader'), leaders),
        h(
          'div',
          { class: 'builder-main' },
          h(
            'section',
            { class: 'panel pool' },
            h(
              'div',
              { class: 'pool-filters' },
              ...FILTERS.map(([f, label]) =>
                h(
                  'button',
                  {
                    class: `chip${filter === f ? ' on' : ''}`,
                    type: 'button',
                    on: {
                      click: () => {
                        filter = f;
                        draw();
                      },
                    },
                  },
                  label,
                ),
              ),
              search,
              h('label', { class: 'owned-toggle' }, ownedBox, 'Only cards I own'),
            ),
            h('p', { class: 'muted small' }, 'Click a card to add it; click it in the deck list to remove it.'),
            poolGrid,
          ),
          h(
            'section',
            { class: 'panel deck-side' },
            h(
              'div',
              { class: 'deck-stats-grid' },
              h('div', { class: stats.units >= MIN_UNITS ? 'ok' : 'bad' }, h('strong', null, stats.units), h('span', null, `units (min ${MIN_UNITS})`)),
              h('div', { class: stats.specials <= MAX_SPECIALS ? 'ok' : 'bad' }, h('strong', null, stats.specials), h('span', null, `specials (max ${MAX_SPECIALS})`)),
              h('div', null, h('strong', null, stats.heroes), h('span', null, 'heroes')),
              h('div', null, h('strong', null, stats.strength), h('span', null, 'strength')),
            ),
            errors.length ? h('ul', { class: 'deck-errors' }, ...errors.map((e) => h('li', null, e))) : h('p', { class: 'deck-ok' }, 'Legal deck.'),
            deckList,
            h('h3', null, 'Test it'),
            h('div', { class: 'import-row' }, oppSelect, testBtn),
            testResult ? h('p', null, testResult) : null,
            h('h3', null, 'Share'),
            h(
              'div',
              { class: 'import-row' },
              code,
              h(
                'button',
                {
                  class: 'btn',
                  on: {
                    click: async () => {
                      try {
                        await navigator.clipboard.writeText(code.value);
                      } catch {
                        code.select();
                      }
                    },
                  },
                },
                'Copy',
              ),
            ),
          ),
        ),
        h('div', { class: 'builder-inspector' }, inspector(inspected ? { uid: -1, id: inspected } : null)),
      ),
    );
    host.append(siteFooter());
  };

  const showInspect = (id: string) => {
    inspected = id;
    const slot = host.querySelector('.builder-inspector');
    if (slot) {
      clear(slot);
      slot.append(inspector({ uid: -1, id }));
    }
  };

  draw();
  return () => ai.dispose();
}
