import './styles.css';
import { icon } from './assets';
import { renderBuilder, renderCollection, renderDeckList } from './builder';
import { clear, h } from './dom';
import { forgetMatch, Match, savedMatch, type MatchSetup, type SavedMatch } from './match';
import { renderMenu } from './menu';
import { fanNotice } from './notice';
import { renderScenarioEditor } from './scenario-editor';

const app = document.getElementById('app') as HTMLElement;

// The game's weather overlays, referenced from CSS.
for (const w of ['frost', 'fog', 'rain']) document.documentElement.style.setProperty(`--ov-${w}`, `url(${icon(`overlay_${w}`)})`);
let match: Match | null = null;
let cleanup: (() => void) | null = null;

function about(): void {
  clear(app);
  app.append(
    h(
      'div',
      { class: 'menu about' },
      h('header', { class: 'menu-head' }, h('h1', null, 'About'), h('p', null, 'How this simulator works')),
      h(
        'section',
        { class: 'panel prose' },
        h('h2', null, 'What it is'),
        h(
          'p',
          null,
          'A faithful copy of the Gwent minigame from The Witcher 3: Wild Hunt, including Hearts of Stone, Blood and Wine (Skellige) and the next-gen update, built for practising the hard matches in the game.',
        ),
        h('h2', null, 'The opponent plays fair'),
        h(
          'p',
          null,
          'The AI only ever sees what a player at the table could see. It knows which cards are in your deck, as a regular opponent would, but never which ones are in your hand or what order your deck is in. To decide, it imagines possible hands for you and plays the move that does best across them.',
        ),
        h('h2', null, 'Rules'),
        h(
          'p',
          null,
          'Every card ability, leader and faction perk is implemented and covered by automated tests. A few fine details could not be confirmed from card text alone and are listed for checking against the real game.',
        ),
        h('h2', null, 'Credits'),
        fanNotice(),
        h(
          'p',
          null,
          'Card data and art were converted from ',
          h('a', { href: 'https://github.com/asundr/gwent-classic' }, 'gwent-classic'),
          ' by Arun Sundaram (MIT with Commons Clause).',
        ),
        h('p', null, h('a', { class: 'btn', href: '#/' }, 'Back')),
      ),
    ),
  );
}

function play(setup: MatchSetup, resume?: SavedMatch): void {
  match?.destroy();
  if (location.hash !== '#/' && location.hash !== '') history.replaceState(null, '', '#/');
  try {
    startMatch(setup, resume);
  } catch (e) {
    // A save the current code can't read: drop it rather than strand the player.
    console.error(e);
    forgetMatch();
    match?.destroy();
    match = null;
    renderMenu(app, play, null);
  }
}

function startMatch(setup: MatchSetup, resume?: SavedMatch): void {
  match = new Match(
    app,
    setup,
    () => {
      forgetMatch();
      match?.destroy();
      match = null;
      location.hash = '#/';
      route();
    },
    resume,
  );
}

function route(): void {
  cleanup?.();
  cleanup = null;
  const hash = location.hash || '#/';
  if (hash !== '#/' && hash !== '') {
    match?.destroy();
    match = null;
  }
  window.scrollTo(0, 0);
  if (hash === '#/about') return about();
  if (hash === '#/decks') return renderDeckList(app);
  if (hash === '#/collection') return renderCollection(app);
  if (hash === '#/scenario' || hash.startsWith('#/scenario/')) {
    cleanup = renderScenarioEditor(app, hash.slice('#/scenario/'.length) || null, play);
    return;
  }
  if (hash.startsWith('#/decks/')) {
    cleanup = renderBuilder(app, decodeURIComponent(hash.slice('#/decks/'.length)));
    return;
  }
  if (match) return;
  const saved = savedMatch();
  renderMenu(app, play, saved ? () => play(saved.setup, saved) : null);
}

window.addEventListener('hashchange', route);
route();
