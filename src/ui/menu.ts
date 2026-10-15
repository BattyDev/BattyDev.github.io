// Match setup: pick your deck and leader, then an opponent.

import { BOTS, type BotLevel } from '../ai/bots';
import { CARDS, FACTION_INFO, FACTIONS, LEADER_TEXT, STARTER_DECKS } from '../classic/cards';
import { deckStats } from '../classic/deck';
import type { DeckList, Faction } from '../classic/types';
import { artSm, shield } from './assets';
import { clear, h } from './dom';
import type { MatchSetup } from './match';
import { load, save } from './storage';

interface Choice {
  faction: Faction;
  deck: number;
  leader: string;
  opponent: Faction | 'any';
  level: BotLevel;
}

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
    opponent: saved.opponent ?? 'any',
    level: saved.level && saved.level in BOTS ? saved.level : 'simple',
  };
}

export function renderMenu(host: HTMLElement, start: (setup: MatchSetup) => void): void {
  const choice = defaults();

  const draw = () => {
    save('menu', choice);
    const decks = decksFor(choice.faction);
    const deck = { ...(decks[choice.deck] as DeckList), leader: choice.leader };
    const st = deckStats(deck);

    const factionButtons = (selected: Faction | 'any', pick: (f: Faction | 'any') => void, allowAny: boolean) =>
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
                  class: `chip${choice.deck === i ? ' on' : ''}`,
                  type: 'button',
                  on: {
                    click: () => {
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
      const oppFaction = choice.opponent === 'any' ? (FACTIONS[Math.floor(Math.random() * FACTIONS.length)] as Faction) : choice.opponent;
      const oppDecks = decksFor(oppFaction);
      const oppDeck = oppDecks[Math.floor(Math.random() * oppDecks.length)] as DeckList;
      start({
        you: deck,
        opponent: oppDeck,
        level: choice.level,
        youName: 'You',
        opponentName: BOTS[choice.level].name,
      });
    };

    clear(host);
    host.append(
      h(
        'div',
        { class: 'menu' },
        h('header', { class: 'menu-head' }, h('h1', null, 'Gwent'), h('p', null, 'A practice table for The Witcher 3’s card game')),
        h(
          'section',
          { class: 'panel' },
          h('h2', null, 'Your deck'),
          factionButtons(
            choice.faction,
            (f) => {
              if (f === 'any') return;
              choice.faction = f;
              choice.deck = 0;
              choice.leader = (decksFor(f)[0] as DeckList).leader;
              draw();
            },
            false,
          ),
          h('p', { class: 'perk' }, FACTION_INFO[choice.faction].perk),
          deckPicker,
          h('p', { class: 'deck-stats' }, `${st.units} units · ${st.specials} specials · ${st.heroes} heroes · ${st.strength} total strength`),
          h('h3', null, 'Leader'),
          leaders,
        ),
        h(
          'section',
          { class: 'panel' },
          h('h2', null, 'Opponent'),
          factionButtons(
            choice.opponent,
            (f) => {
              choice.opponent = f;
              draw();
            },
            true,
          ),
          h('h3', null, 'Who'),
          bots,
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
