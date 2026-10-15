// Match setup: pick your deck and leader, then an opponent.

import { BOTS, type BotLevel } from '../ai/bots';
import { CARDS, FACTION_INFO, FACTIONS, LEADER_TEXT, STARTER_DECKS } from '../classic/cards';
import { deckStats, validateDeck } from '../classic/deck';
import type { DeckList, Faction } from '../classic/types';
import { artSm, shield } from './assets';
import { clear, h } from './dom';
import { getDeck, listDecks } from './library';
import type { MatchSetup } from './match';
import { load, save } from './storage';

interface Choice {
  faction: Faction;
  deck: number;
  leader: string;
  /** A saved deck of yours, used instead of a starter deck. */
  saved: string | null;
  opponent: Faction | 'any';
  /** A saved opponent deck, used instead of a random starter. */
  opponentSaved: string | null;
  level: BotLevel;
  exam: boolean;
}

const playable = (role: 'mine' | 'opponent') => listDecks(role).filter((d) => validateDeck(d).length === 0);

const decksFor = (f: Faction) => STARTER_DECKS.filter((d) => d.faction === f);
const leadersFor = (f: Faction) => CARDS.filter((c) => c.type === 'leader' && c.faction === f);

function defaults(): Choice {
  const saved = load<Partial<Choice>>('menu', {});
  const faction = saved.faction && FACTIONS.includes(saved.faction) ? saved.faction : 'realms';
  const decks = decksFor(faction);
  const deck = Math.min(saved.deck ?? 0, decks.length - 1);
  const leader = saved.leader && leadersFor(faction).some((l) => l.id === saved.leader) ? saved.leader : (decks[deck] as DeckList).leader;
  return {
    faction,
    deck,
    leader,
    saved: saved.saved && playable('mine').some((d) => d.id === saved.saved) ? saved.saved : null,
    opponent: saved.opponent ?? 'any',
    opponentSaved: saved.opponentSaved && playable('opponent').some((d) => d.id === saved.opponentSaved) ? saved.opponentSaved : null,
    level: saved.level && saved.level in BOTS ? saved.level : 'simple',
    exam: saved.exam ?? false,
  };
}

export function renderMenu(host: HTMLElement, start: (setup: MatchSetup) => void, resume: (() => void) | null = null): void {
  const choice = defaults();

  const draw = () => {
    save('menu', choice);
    const decks = decksFor(choice.faction);
    const savedDeck = choice.saved ? getDeck(choice.saved) : undefined;
    const deck: DeckList = savedDeck ?? { ...(decks[choice.deck] as DeckList), leader: choice.leader };
    const st = deckStats(deck);
    const mine = playable('mine');
    const theirs = playable('opponent');
    const oppSaved = choice.opponentSaved ? getDeck(choice.opponentSaved) : undefined;

    const savedChips = (list: typeof mine, selected: string | null, pick: (id: string | null) => void) =>
      list.length
        ? h(
            'div',
            { class: 'deck-picker' },
            ...list.map((d) =>
              h(
                'button',
                { class: `chip saved${selected === d.id ? ' on' : ''}`, type: 'button', on: { click: () => pick(selected === d.id ? null : d.id) } },
                h('img', { src: shield(d.faction), alt: '' }),
                d.name,
              ),
            ),
          )
        : null;

    const factionButtons = (selected: Faction | 'any' | null, pick: (f: Faction | 'any') => void, allowAny: boolean) =>
      h(
        'div',
        { class: 'faction-picker', role: 'radiogroup' },
        ...FACTIONS.map((f) =>
          h(
            'button',
            { class: `faction${selected === f ? ' on' : ''}`, type: 'button', role: 'radio', aria: { checked: String(selected === f) }, on: { click: () => pick(f) } },
            h('img', { src: shield(f), alt: '' }),
            h('span', null, FACTION_INFO[f].name),
          ),
        ),
        allowAny
          ? h(
              'button',
              { class: `faction any${selected === 'any' ? ' on' : ''}`, type: 'button', role: 'radio', aria: { checked: String(selected === 'any') }, on: { click: () => pick('any') } },
              h('span', { class: 'any-mark' }, '?'),
              h('span', null, 'Surprise me'),
            )
          : null,
      );

    const leaders = h(
      'div',
      { class: 'leader-picker', role: 'radiogroup', aria: { label: 'Leader' } },
      ...leadersFor(choice.faction).map((l) =>
        h(
          'button',
          {
            class: `leader-option${choice.leader === l.id ? ' on' : ''}`,
            type: 'button',
            role: 'radio',
            aria: { checked: String(choice.leader === l.id) },
            on: {
              click: () => {
                choice.leader = l.id;
                draw();
              },
            },
          },
          h('img', { src: artSm(l.id), alt: '', loading: 'lazy' }),
          h('span', { class: 'leader-name' }, l.name.replace(/^.*? - /, '')),
          h('span', { class: 'leader-text' }, l.type === 'leader' ? LEADER_TEXT[l.leader].text : ''),
        ),
      ),
    );

    const deckPicker =
      decks.length > 1
        ? h(
            'div',
            { class: 'deck-picker' },
            ...decks.map((_, i) =>
              h(
                'button',
                {
                  class: `chip${choice.deck === i && !choice.saved ? ' on' : ''}`,
                  type: 'button',
                  on: {
                    click: () => {
                      choice.saved = null;
                      choice.deck = i;
                      draw();
                    },
                  },
                },
                `Starter deck ${i + 1}`,
              ),
            ),
          )
        : null;

    const bots = h(
      'div',
      { class: 'bot-picker' },
      ...(Object.keys(BOTS) as BotLevel[]).map((k) =>
        h(
          'button',
          {
            class: `bot${choice.level === k ? ' on' : ''}`,
            type: 'button',
            on: {
              click: () => {
                choice.level = k;
                draw();
              },
            },
          },
          h('strong', null, BOTS[k].name),
          h('span', null, BOTS[k].blurb),
        ),
      ),
    );

    const go = () => {
      let oppDeck: DeckList;
      if (oppSaved) oppDeck = oppSaved;
      else {
        const oppFaction = choice.opponent === 'any' ? (FACTIONS[Math.floor(Math.random() * FACTIONS.length)] as Faction) : choice.opponent;
        const oppDecks = decksFor(oppFaction);
        oppDeck = oppDecks[Math.floor(Math.random() * oppDecks.length)] as DeckList;
      }
      start({
        you: deck,
        opponent: oppDeck,
        level: choice.level,
        exam: choice.exam,
        youName: 'You',
        opponentName: oppSaved ? oppSaved.name : BOTS[choice.level].name,
      });
    };

    clear(host);
    host.append(
      h(
        'div',
        { class: 'menu' },
        h(
          'header',
          { class: 'menu-head' },
          h('h1', null, 'Gwent'),
          h('p', null, 'A practice table for The Witcher 3’s card game'),
          h(
            'nav',
            { class: 'menu-nav' },
            h('a', { href: '#/decks' }, 'Decks'),
            h('a', { href: '#/scenario' }, 'Scenarios'),
            h('a', { href: '#/collection' }, 'Collection'),
            h('a', { href: '#/about' }, 'About'),
          ),
        ),
        resume
          ? h(
              'section',
              { class: 'panel resume' },
              h('div', null, h('strong', null, 'You have a match in progress.'), h('span', { class: 'muted' }, ' Pick up where you left off?')),
              h(
                'div',
                { class: 'modal-actions start' },
                h('button', { class: 'btn primary', type: 'button', on: { click: resume } }, 'Resume match'),
                h(
                  'button',
                  {
                    class: 'btn',
                    type: 'button',
                    on: {
                      click: () => {
                        save('match', null);
                        renderMenu(host, start, null);
                      },
                    },
                  },
                  'Discard it',
                ),
              ),
            )
          : null,
        h(
          'section',
          { class: 'panel' },
          h('h2', null, 'Your deck'),
          factionButtons(
            savedDeck ? null : choice.faction,
            (f) => {
              if (f === 'any') return;
              choice.saved = null;
              choice.faction = f;
              choice.deck = 0;
              choice.leader = (decksFor(f)[0] as DeckList).leader;
              draw();
            },
            false,
          ),
          h('p', { class: 'perk' }, FACTION_INFO[savedDeck?.faction ?? choice.faction].perk),
          deckPicker,
          mine.length ? h('h3', null, 'Your saved decks') : null,
          savedChips(mine, choice.saved, (id) => {
            choice.saved = id;
            draw();
          }),
          h('p', { class: 'deck-stats' }, `${savedDeck ? `${savedDeck.name}: ` : ''}${st.units} units · ${st.specials} specials · ${st.heroes} heroes · ${st.strength} total strength`),
          savedDeck ? null : h('h3', null, 'Leader'),
          savedDeck ? null : leaders,
          h('p', { class: 'muted small' }, h('a', { href: '#/decks' }, 'Build or import a deck →')),
        ),
        h(
          'section',
          { class: 'panel' },
          h('h2', null, 'Opponent'),
          factionButtons(
            oppSaved ? null : choice.opponent,
            (f) => {
              choice.opponentSaved = null;
              choice.opponent = f;
              draw();
            },
            true,
          ),
          theirs.length ? h('h3', null, 'Practice opponents') : null,
          savedChips(theirs, choice.opponentSaved, (id) => {
            choice.opponentSaved = id;
            draw();
          }),
          h('h3', null, 'Who'),
          bots,
          h(
            'label',
            { class: 'field-row exam-toggle' },
            (() => {
              const box = h('input', {
                type: 'checkbox',
                on: {
                  change: (e) => {
                    choice.exam = (e.target as HTMLInputElement).checked;
                    save('menu', choice);
                  },
                },
              });
              box.checked = choice.exam;
              return box;
            })(),
            h('span', null, h('strong', null, 'Exam mode'), ' · no coach and no undo: a dress rehearsal for the real match'),
          ),
          h('button', { class: 'btn primary big', type: 'button', on: { click: go } }, 'Start match'),
        ),
        h(
          'footer',
          { class: 'menu-foot' },
          h('p', null, 'Unofficial fan project. Gwent and The Witcher are trademarks of CD PROJEKT S.A.; card art © CD PROJEKT RED, used non-commercially. Not endorsed by CD PROJEKT RED.'),
          h('p', null, h('a', { href: '#/about' }, 'About this simulator'), ' · ', h('a', { href: '../' }, 'battydev.com')),
        ),
      ),
    );
  };
  draw();
}
