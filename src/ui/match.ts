// One match: owns the game state, runs the opponent, and renders the board.
//
// The board is rendered from view(state, human), never from the full state,
// so the interface can't show what the player isn't allowed to know.

import { AiClient } from '../ai/client';
import type { BotLevel } from '../ai/bots';
import type { SearchResult } from '../ai/ismcts';
import { actionKey } from '../ai/keys';
import { def, FACTION_INFO, LEADER_TEXT } from '../classic/cards';
import { apply, canUseLeader, legalActions, newGame, other, toAct } from '../classic/engine';
import { cardStrength, rowScore, totalScore, weatherOn } from '../classic/score';
import type { Action, Card, DeckList, GameEvent, GameState, PlayerId, Row } from '../classic/types';
import { redactEvent, view } from '../classic/view';
import { seedFrom } from '../core/rng';
import { cardBack, icon, shield } from './assets';
import { inspector, tile } from './cards';
import { coachPanel, hintTarget, judge, reviewBody, trackerBody, type Decision, type Verdict } from './coach';
import { clear, h, sleep } from './dom';
import { narrate, type Line } from './narrate';
import { load, save } from './storage';

export interface MatchSetup {
  you: DeckList;
  opponent: DeckList;
  level: BotLevel;
  youName: string;
  opponentName: string;
  seed?: number;
}

interface Settings {
  speed: 'normal' | 'fast' | 'instant';
  confirmPass: boolean;
}

const SPEED = { normal: 1, fast: 0.45, instant: 0 } as const;
const ROW_NAMES: Record<Row, string> = { close: 'Close combat', ranged: 'Ranged', siege: 'Siege' };

type Selection = { kind: 'hand'; uid: number } | { kind: 'leader' } | null;

interface Targets {
  rows: Map<string, Action>;
  units: Map<number, Action>;
  direct: Action | null;
}

const HUMAN: PlayerId = 0;
const BOT: PlayerId = 1;

export class Match {
  private state!: GameState;
  private history: { state: GameState; log: number; action: Action }[] = [];
  private log: Line[] = [];
  private selection: Selection = null;
  private inspected: { card: Card; strength?: number } | null = null;
  private generation = 0;
  private thinking = false;
  private passArmed = false;
  private logOpen = false;
  private settings: Settings = load('settings', { speed: 'normal', confirmPass: true } as Settings);
  private ai = new AiClient();
  /** A second worker, so the coach never delays the opponent. */
  private coachAi = new AiClient();
  private coachOn: boolean = load('coach', false);
  private coach: { turn: number; gen: number; result: SearchResult | null } | null = null;
  private root: HTMLElement;
  private toasts: HTMLElement;
  private modal: HTMLElement | null = null;
  private lastUids = new Set<number>();
  private onKey = (e: KeyboardEvent) => this.key(e);

  constructor(
    private host: HTMLElement,
    private setup: MatchSetup,
    private exit: () => void,
  ) {
    this.root = h('div', { class: 'match' });
    this.toasts = h('div', { class: 'sr-only', role: 'status', aria: { live: 'polite' } });
    clear(host);
    host.append(this.root, this.toasts);
    document.body.classList.add('in-match');
    document.addEventListener('keydown', this.onKey);
    // Hide the big card when the pointer leaves the cards, unless one is selected.
    this.root.addEventListener('mouseout', (e) => {
      const to = e.relatedTarget as Element | null;
      if (!to?.closest?.('.card') && !this.selection) this.root.classList.remove('inspecting');
    });
    this.start(setup.seed ?? seedFrom(Date.now()));
  }

  destroy(): void {
    this.generation++;
    this.ai.dispose();
    this.coachAi.dispose();
    this.closeModal();
    this.toasts.remove();
    document.body.classList.remove('in-match');
    document.removeEventListener('keydown', this.onKey);
  }

  // -------------------------------------------------------------------------
  // Game flow

  private start(seed: number): void {
    this.generation++;
    const { state, events } = newGame({
      seed,
      players: [
        { name: this.setup.youName, deck: this.setup.you },
        { name: this.setup.opponentName, deck: this.setup.opponent },
      ],
    });
    this.state = state;
    this.history = [];
    this.log = [];
    this.selection = null;
    this.closeModal();
    this.absorb(events);
    this.render();
    void this.advance();
  }

  private delay(ms: number): Promise<void> {
    const f = SPEED[this.settings.speed];
    return f === 0 ? Promise.resolve() : sleep(ms * f);
  }

  /** Human action. */
  private act(action: Action): void {
    if (this.thinking || toAct(this.state) !== HUMAN) return;
    this.history.push({ state: this.state, log: this.log.length, action });
    this.selection = null;
    this.passArmed = false;
    const { state, events } = apply(this.state, action);
    this.state = state;
    this.absorb(events);
    this.closeModal();
    this.render();
    void this.advance();
  }

  /** Runs the bot until it's the human's turn or the game ends. */
  private async advance(): Promise<void> {
    const gen = this.generation;
    while (this.state.phase !== 'over' && toAct(this.state) === BOT) {
      this.thinking = true;
      this.render();
      await this.delay(this.state.phase === 'play' ? 750 : 150);
      if (gen !== this.generation) return;
      let action: Action;
      try {
        action = await this.ai.move({
          level: this.setup.level,
          view: view(this.state, BOT),
          me: BOT,
          // The bot knows which cards are in your deck, never which are in your hand.
          opponentDeck: this.setup.you,
          seed: seedFrom(Date.now() ^ this.state.turn),
        });
      } catch {
        action = legalActions(this.state).find((a) => a.type === 'pass' || a.type === 'endRedraw') ?? (legalActions(this.state)[0] as Action);
      }
      if (gen !== this.generation) return;
      const { state, events } = apply(this.state, action);
      this.state = state;
      this.thinking = false;
      this.absorb(events);
      this.render();
    }
    this.thinking = false;
    if (gen !== this.generation) return;
    this.render();
    this.prompt();
  }

  /** Takes back your last whole turn, including any choices it prompted. */
  private undo(): void {
    let last = this.history.pop();
    while (last && last.state.pending && this.history.length) last = this.history.pop();
    if (!last) return;
    this.generation++;
    this.thinking = false;
    this.state = last.state;
    this.log = this.log.slice(0, last.log);
    this.selection = null;
    this.closeModal();
    this.toast('Move taken back.');
    this.render();
    this.prompt();
  }

  /** Feeds engine events to the log, toasts and banners. */
  private absorb(events: GameEvent[]): void {
    for (const raw of events) {
      const e = redactEvent(raw, HUMAN);
      if (!e) continue;
      const line = narrate(e, HUMAN, this.setup.opponentName);
      if (!line) continue;
      this.log.push(line);
      if (e.type === 'roundEnd') this.banner(e.winner === null ? 'Round drawn' : e.winner === HUMAN ? 'Round won' : 'Round lost', `${e.scores[HUMAN]} – ${e.scores[BOT]}`);
      else if (line.toast) this.toast(line.text);
    }
  }

  // -------------------------------------------------------------------------
  // Input

  private targets(): Targets {
    const t: Targets = { rows: new Map(), units: new Map(), direct: null };
    if (this.thinking || toAct(this.state) !== HUMAN || this.state.phase !== 'play' || this.state.pending || !this.selection) return t;
    const acts = legalActions(this.state);
    if (this.selection.kind === 'leader') {
      t.direct = acts.find((a) => a.type === 'leader') ?? null;
      return t;
    }
    const uid = this.selection.uid;
    const card = this.state.players[HUMAN].hand.find((c) => c.uid === uid);
    if (!card) return t;
    const d = def(card.id);
    const mine = acts.filter((a): a is Extract<Action, { type: 'play' }> => a.type === 'play' && a.uid === uid);
    for (const a of mine) {
      if (a.target !== undefined) t.units.set(a.target, a);
      else if (a.row) {
        const side = d.type === 'unit' && d.abilities.includes('spy') ? BOT : HUMAN;
        t.rows.set(`${side}:${a.row}`, a);
      } else t.direct = a;
    }
    if (mine.length === 1 && !t.direct) t.direct = mine[0] as Action;
    return t;
  }

  private select(sel: Selection): void {
    if (this.thinking) return;
    const same = JSON.stringify(sel) === JSON.stringify(this.selection);
    this.selection = same ? null : sel;
    this.passArmed = false;
    if (sel?.kind === 'hand') {
      const c = this.state.players[HUMAN].hand.find((x) => x.uid === sel.uid);
      if (c) this.inspected = { card: c };
    }
    this.render();
  }

  private pass(): void {
    if (this.thinking || toAct(this.state) !== HUMAN || this.state.phase !== 'play' || this.state.pending) return;
    const hasCards = this.state.players[HUMAN].hand.length > 0;
    if (this.settings.confirmPass && hasCards && !this.passArmed) {
      this.passArmed = true;
      this.render();
      setTimeout(() => {
        if (this.passArmed) {
          this.passArmed = false;
          this.render();
        }
      }, 3000);
      return;
    }
    this.act({ type: 'pass' });
  }

  private key(e: KeyboardEvent): void {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'Escape') {
      if (this.modal?.dataset.dismissable) this.closeModal();
      else if (this.selection) this.select(null);
    } else if ((e.key === 'z' || e.key === 'Z') && !e.ctrlKey && !e.metaKey) {
      this.undo();
    } else if (e.key === 'p' || e.key === 'P') {
      this.pass();
    } else if (e.key === 'c' || e.key === 'C') {
      this.toggleCoach();
    } else if (e.key === 'l' || e.key === 'L') {
      this.logOpen = !this.logOpen;
      this.render();
    } else if (e.key === 'Enter' && this.selection) {
      const t = this.targets();
      if (t.direct) this.act(t.direct);
    }
  }

  // -------------------------------------------------------------------------
  // Prompts for decisions outside normal play

  private prompt(): void {
    if (this.state.phase === 'over') return this.gameOver();
    if (toAct(this.state) !== HUMAN) return;
    const s = this.state;
    if (s.phase === 'chooseFirst') return this.chooseFirstModal();
    if (s.phase === 'redraw') return this.redrawModal();
    if (s.pending) return this.pendingModal();
  }

  private openModal(title: string, body: Node[], opts: { dismissable?: boolean; wide?: boolean } = {}): void {
    this.closeModal();
    const m = h(
      'div',
      { class: 'modal-backdrop', data: opts.dismissable ? { dismissable: '1' } : {} },
      h('div', { class: `modal${opts.wide ? ' wide' : ''}`, role: 'dialog', aria: { modal: 'true', label: title } }, h('h2', null, title), ...body),
    );
    if (opts.dismissable) {
      m.addEventListener('click', (e) => {
        if (e.target === m) this.closeModal();
      });
    }
    this.modal = m;
    this.host.append(m);
    (m.querySelector('button') as HTMLButtonElement | null)?.focus();
  }

  private closeModal(): void {
    this.modal?.remove();
    this.modal = null;
  }

  private chooseFirstModal(): void {
    this.openModal("Scoia'tael: who goes first?", [
      h('p', null, FACTION_INFO.scoiatael.perk),
      h(
        'div',
        { class: 'modal-actions' },
        h('button', { class: 'btn primary', on: { click: () => this.act({ type: 'chooseFirst', first: HUMAN }) } }, 'I’ll go first'),
        h('button', { class: 'btn', on: { click: () => this.act({ type: 'chooseFirst', first: BOT }) } }, 'Let them start'),
      ),
    ]);
  }

  private redrawModal(): void {
    const P = this.state.players[HUMAN];
    const grid = h(
      'div',
      { class: 'pick-grid' },
      ...P.hand.map((c) =>
        tile(c, {
          classes: ['pick'],
          onClick: () => this.act({ type: 'redraw', uid: c.uid }),
          onHover: () => this.inspect(c),
        }),
      ),
    );
    this.openModal(
      `Redraw up to 2 cards`,
      [
        h('p', null, `Choose a card to send back and draw a replacement. ${P.redrawsLeft} redraw${P.redrawsLeft === 1 ? '' : 's'} left.`),
        grid,
        h('div', { class: 'modal-actions' }, h('button', { class: 'btn primary', on: { click: () => this.act({ type: 'endRedraw' }) } }, 'Keep this hand')),
      ],
      { wide: true },
    );
  }

  private pendingModal(): void {
    const s = this.state;
    const pend = s.pending;
    if (!pend) return;
    const P = s.players[HUMAN];
    const O = s.players[BOT];
    const zone: Card[] =
      pend.kind === 'medic' || pend.kind === 'bringer'
        ? P.discard
        : pend.kind === 'relentless'
          ? O.discard
          : pend.kind === 'destroyerDiscard'
            ? P.hand
            : P.deck;
    const titles = {
      medic: 'Medic: choose a unit to revive',
      bringer: 'Bringer of Death: restore a card to your hand',
      relentless: "The Relentless: take a card from your opponent's discard pile",
      destroyerDiscard: `Destroyer of Worlds: discard a card (${pend.kind === 'destroyerDiscard' ? pend.remaining : 0} to go)`,
      destroyerDraw: 'Destroyer of Worlds: draw any card from your deck',
      kingWeather: 'King of the Wild Hunt: choose a weather card to play',
    } as const;
    const acts = legalActions(s);
    const options = pend.options.map((uid) => zone.find((c) => c.uid === uid)).filter((c): c is Card => !!c);
    const grid = h(
      'div',
      { class: 'pick-grid' },
      ...options.map((c) => {
        const forCard = acts.filter((a) => a.type === 'choose' && a.uid === c.uid);
        const wrap = h('div', { class: 'pick-option' });
        if (forCard.length > 1) {
          wrap.append(
            tile(c, { onHover: () => this.inspect(c) }),
            h(
              'div',
              { class: 'pick-rows' },
              ...forCard.map((a) => h('button', { class: 'btn small', on: { click: () => this.act(a) } }, a.type === 'choose' && a.row ? ROW_NAMES[a.row] : 'Choose')),
            ),
          );
        } else {
          wrap.append(tile(c, { classes: ['pick'], onClick: () => this.act(forCard[0] as Action), onHover: () => this.inspect(c) }));
        }
        return wrap;
      }),
    );
    this.openModal(titles[pend.kind], [grid], { wide: true });
  }

  private pileModal(title: string, cards: Card[]): void {
    this.openModal(
      title,
      [
        cards.length ? h('div', { class: 'pick-grid' }, ...cards.map((c) => tile(c, { onHover: () => this.inspect(c) }))) : h('p', { class: 'muted' }, 'Empty.'),
        h('div', { class: 'modal-actions' }, h('button', { class: 'btn', on: { click: () => this.closeModal() } }, 'Close')),
      ],
      { dismissable: true, wide: true },
    );
  }

  private gameOver(): void {
    const s = this.state;
    const result = s.winner === 'draw' ? 'Draw' : s.winner === HUMAN ? 'Victory' : 'Defeat';
    const table = h(
      'table',
      { class: 'rounds' },
      h('thead', null, h('tr', null, h('th', null, ''), ...s.rounds.map((_, i) => h('th', null, `Round ${i + 1}`)))),
      h(
        'tbody',
        null,
        ...([HUMAN, BOT] as const).map((p) =>
          h('tr', null, h('th', null, s.players[p].name), ...s.rounds.map((r) => h('td', { class: r.winner === p ? 'won' : '' }, r.scores[p]))),
        ),
      ),
    );
    this.openModal(result, [
      table,
      h(
        'div',
        { class: 'modal-actions' },
        h('button', { class: 'btn primary', on: { click: () => this.start(seedFrom(Date.now())) } }, 'Rematch'),
        this.decisions().length ? h('button', { class: 'btn', on: { click: () => void this.review() } }, 'Review my moves') : null,
        this.history.length ? h('button', { class: 'btn', on: { click: () => this.undo() } }, 'Take back last move') : null,
        h('button', { class: 'btn', on: { click: () => this.exit() } }, 'Change decks'),
      ),
    ]);
  }

  // -------------------------------------------------------------------------
  // Coach

  private toggleCoach(): void {
    this.coachOn = !this.coachOn;
    save('coach', this.coachOn);
    this.render();
  }

  /** Asks the coach about the current position, once per position. */
  private requestCoach(): void {
    if (!this.coachOn || this.thinking || toAct(this.state) !== HUMAN || this.state.phase !== 'play') return;
    const turn = this.state.turn;
    const gen = this.generation;
    if (this.coach && this.coach.turn === turn && this.coach.gen === gen) return;
    this.coach = { turn, gen, result: null };
    void this.coachAi
      .analyse({ view: view(this.state, HUMAN), me: HUMAN, iterations: 3000, timeMs: 1400, opponentDeck: this.setup.opponent, seed: seedFrom(Date.now()) })
      .then((result) => {
        if (this.coach?.turn === turn && this.coach.gen === gen && this.generation === gen) {
          this.coach.result = result;
          this.render();
        }
      })
      .catch(() => undefined);
  }

  private currentCoach(): SearchResult | null {
    return this.coach && this.coach.turn === this.state.turn && this.coach.gen === this.generation ? this.coach.result : null;
  }

  private decisions(): Decision[] {
    return this.history.filter((h) => h.state.phase === 'play').map((h) => ({ state: h.state, action: h.action }));
  }

  /** Re-analyses each of your play-phase decisions and grades it. */
  private async review(): Promise<void> {
    const decisions = this.decisions();
    const bar = h('progress', { class: 'review-progress' });
    bar.max = decisions.length;
    bar.value = 0;
    const note = h('p', null, `Checking ${decisions.length} decisions…`);
    this.openModal('Reviewing your moves', [note, bar]);
    const gen = this.generation;
    const verdicts: Verdict[] = [];
    for (const [i, d] of decisions.entries()) {
      const r = await this.coachAi.analyse({ view: view(d.state, HUMAN), me: HUMAN, iterations: 1500, timeMs: 900, opponentDeck: this.setup.opponent, seed: 1000 + i });
      if (gen !== this.generation) return;
      const v = judge(d, r, actionKey);
      if (v) verdicts.push(v);
      bar.value = i + 1;
    }
    this.openModal(
      'Your moves, reviewed',
      [
        ...reviewBody(verdicts, (d) => this.replayFrom(d)),
        h(
          'div',
          { class: 'modal-actions' },
          h('button', { class: 'btn', on: { click: () => this.gameOver() } }, 'Back'),
          h('button', { class: 'btn primary', on: { click: () => this.start(seedFrom(Date.now())) } }, 'Rematch'),
        ),
      ],
      { wide: true },
    );
  }

  /** Rewinds to a past decision so you can try a different move. */
  private replayFrom(d: Decision): void {
    const i = this.history.findIndex((h) => h.state === d.state);
    if (i < 0) return;
    const entry = this.history[i] as (typeof this.history)[number];
    this.generation++;
    this.thinking = false;
    this.history = this.history.slice(0, i);
    this.state = entry.state;
    this.log = this.log.slice(0, entry.log);
    this.selection = null;
    this.closeModal();
    this.toast('Rewound. Try another move.');
    this.render();
    this.prompt();
  }

  private trackerModal(): void {
    this.openModal(`${this.setup.opponentName}'s cards still to come`, [
      ...trackerBody(view(this.state, HUMAN), BOT, this.setup.opponent, (c) => this.inspect(c)),
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn', on: { click: () => this.closeModal() } }, 'Close')),
    ], { dismissable: true, wide: true });
  }

  // -------------------------------------------------------------------------
  // Feedback

  /** Announces to screen readers; sighted players see the feed. */
  private toast(text: string): void {
    this.toasts.textContent = text;
  }

  private banner(title: string, sub: string): void {
    const b = h('div', { class: 'banner' }, h('strong', null, title), h('span', null, sub));
    this.host.append(b);
    setTimeout(() => b.remove(), SPEED[this.settings.speed] === 0 ? 900 : 1800);
  }

  private inspect(card: Card, strength?: number): void {
    this.inspected = { card, strength };
    this.root.classList.add('inspecting');
    const wrap = this.root.querySelector('.inspector-slot');
    if (wrap) {
      clear(wrap);
      wrap.append(inspector(card, strength));
    }
  }

  // -------------------------------------------------------------------------
  // Rendering

  private render(): void {
    const v = view(this.state, HUMAN);
    const t = this.targets();
    const prevUids = this.lastUids;
    const nowUids = new Set<number>();
    const humanTurn = !this.thinking && toAct(this.state) === HUMAN && this.state.phase === 'play' && !this.state.pending;
    const sel = this.selection;
    const selectedCard = sel?.kind === 'hand' ? this.state.players[HUMAN].hand.find((c) => c.uid === sel.uid) : undefined;
    const selectedDef = selectedCard ? def(selectedCard.id) : null;
    const coachResult = this.coachOn && humanTurn ? this.currentCoach() : null;
    const hint = hintTarget(coachResult);

    const unitTile = (side: PlayerId, row: Row, c: Card) => {
      nowUids.add(c.uid);
      const strength = cardStrength(v, side, row, c);
      const target = t.units.get(c.uid);
      return tile(c, {
        strength,
        classes: [prevUids.has(c.uid) ? '' : 'enter', target ? 'target' : ''],
        onClick: target ? () => this.act(target) : () => this.inspect(c, strength),
        onHover: () => this.inspect(c, strength),
      });
    };

    const rowEl = (side: PlayerId, row: Row) => {
      const r = v.players[side].rows[row];
      const target = t.rows.get(`${side}:${row}`);
      const weather = weatherOn(v, row) ? ` weather-${row}` : '';
      const el = h(
        target ? 'button' : 'div',
        {
          class: `row${weather}${target ? ' target' : ''}`,
          data: { side, row },
          aria: { label: `${side === HUMAN ? 'Your' : "Opponent's"} ${ROW_NAMES[row].toLowerCase()} row, ${rowScore(v, side, row)}` },
          type: target ? 'button' : undefined,
        },
        h('span', { class: 'row-score' }, rowScore(v, side, row)),
        h(
          'span',
          { class: 'row-special' },
          r.special ? tile(r.special, { onHover: () => this.inspect(r.special as Card) }) : null,
          r.leaderHorn ? h('img', { class: 'leader-horn', src: icon('card_special_horn'), alt: "Leader's horn", title: "Leader's horn" }) : null,
        ),
        h('span', { class: 'row-units', style: `--n:${Math.max(r.units.length, 1)}` }, ...r.units.map((c) => unitTile(side, row, c))),
        h('img', { class: 'row-icon', src: icon(`card_row_${row}`), alt: '' }),
      );
      if (target) el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.card.target')) return;
        this.act(target);
      });
      return el;
    };

    const playerPanel = (p: PlayerId) => {
      const P = v.players[p];
      const total = totalScore(v, p);
      const opTotal = totalScore(v, other(p));
      const leaderUsable = p === HUMAN && humanTurn && canUseLeader(this.state, HUMAN);
      const ld = def(P.leader.id);
      const leaderState = P.leaderDisabled ? 'disabled' : P.leaderUsed ? 'used' : ld.type === 'leader' && LEADER_TEXT[ld.leader].passive ? 'passive' : leaderUsable ? 'usable' : '';
      const leader = tile(P.leader, {
        classes: ['leader', leaderState, this.selection?.kind === 'leader' && p === HUMAN ? 'selected' : '', p === HUMAN && hint.leader ? 'hint' : ''],
        onClick: leaderUsable ? () => this.select({ kind: 'leader' }) : () => this.inspect(P.leader),
        onHover: () => this.inspect(P.leader),
      });
      return h(
        'section',
        { class: `player ${p === HUMAN ? 'me' : 'op'}${toAct(this.state) === p && this.state.phase === 'play' ? ' active' : ''}` },
        leader,
        h(
          'div',
          { class: 'player-info' },
          h('div', { class: 'who' }, h('img', { class: 'shield', src: shield(P.faction), alt: '' }), h('div', null, h('strong', null, P.name), h('span', null, FACTION_INFO[P.faction].name))),
          h(
            'div',
            { class: 'stats' },
            h('span', { class: 'hand-count', title: 'Cards in hand' }, h('img', { src: cardBack(P.faction), alt: '' }), P.hand.length),
            h(
              'span',
              { class: 'gems', aria: { label: `${P.lives} ${P.lives === 1 ? 'life' : 'lives'} left` } },
              h('img', { src: icon(P.lives >= 1 ? 'icon_gem_on' : 'icon_gem_off'), alt: '' }),
              h('img', { src: icon(P.lives >= 2 ? 'icon_gem_on' : 'icon_gem_off'), alt: '' }),
            ),
            P.passed && this.state.phase === 'play' ? h('span', { class: 'passed' }, 'Passed') : null,
          ),
          p === BOT ? h('button', { class: 'btn ghost small tracker-btn', on: { click: () => this.trackerModal() }, title: 'Cards they have not played yet' }, 'Their cards') : null,
        ),
        h('span', { class: `total${total > opTotal ? ' leading' : ''}`, aria: { label: `Total ${total}` } }, total),
      );
    };

    const pile = (p: PlayerId) => {
      const P = v.players[p];
      const top = P.discard[P.discard.length - 1];
      return h(
        'div',
        { class: `piles ${p === HUMAN ? 'me' : 'op'}` },
        h(
          'button',
          { class: 'pile discard', type: 'button', title: 'Discard pile', on: { click: () => this.pileModal(`${p === HUMAN ? 'Your' : `${P.name}'s`} discard pile`, P.discard) } },
          top ? tile(top) : h('span', { class: 'pile-empty' }),
          h('span', { class: 'pile-count' }, P.discard.length),
        ),
        h(
          'div',
          { class: 'pile deck', title: 'Deck' },
          P.deck.length ? h('img', { src: cardBack(P.faction), alt: '' }) : h('span', { class: 'pile-empty' }),
          h('span', { class: 'pile-count' }, P.deck.length),
        ),
      );
    };

    const status = this.thinking
      ? `${this.setup.opponentName} is thinking…`
      : this.state.phase === 'over'
        ? 'Match over'
        : toAct(this.state) === HUMAN
          ? this.state.phase === 'play'
            ? 'Your turn'
            : 'Your decision'
          : `${this.setup.opponentName}'s turn`;

    const primary = t.direct
      ? h(
          'button',
          { class: 'btn primary', on: { click: () => this.act(t.direct as Action) } },
          sel?.kind === 'leader' ? 'Use leader ability' : `Play ${selectedDef?.name ?? 'card'}`,
        )
      : null;

    const controls = h(
      'div',
      { class: 'controls' },
      h('div', { class: `status${humanTurn ? ' mine' : ''}` }, status),
      primary,
      h(
        'button',
        { class: `btn pass${this.passArmed ? ' armed' : ''}${hint.pass ? ' hint' : ''}`, disabled: !humanTurn, on: { click: () => this.pass() }, title: 'Pass (P)' },
        this.passArmed ? 'Confirm pass' : 'Pass',
      ),
    );

    const weatherBox = h(
      'section',
      { class: `weather${t.direct && selectedDef?.type === 'weather' ? ' target' : ''}`, aria: { label: 'Weather' } },
      ...v.weather.map((w) => tile(w.card, { onHover: () => this.inspect(w.card) })),
    );
    weatherBox.addEventListener('click', () => {
      if (weatherBox.classList.contains('target') && t.direct) this.act(t.direct);
    });

    // Cards with no legal play right now (a Decoy with nothing to swap) stay
    // inspectable but can't be selected.
    const playable = new Set(humanTurn ? legalActions(this.state).flatMap((a) => (a.type === 'play' ? [a.uid] : [])) : []);
    const hand = h(
      'div',
      { class: 'hand', style: `--n:${Math.max(v.players[HUMAN].hand.length, 1)}`, aria: { label: 'Your hand' } },
      ...v.players[HUMAN].hand.map((c) => {
        nowUids.add(c.uid);
        const selected = this.selection?.kind === 'hand' && this.selection.uid === c.uid;
        const canPlay = playable.has(c.uid);
        return tile(c, {
          classes: [selected ? 'selected' : '', prevUids.has(c.uid) ? '' : 'enter', hint.hand === c.uid ? 'hint' : '', humanTurn && !canPlay ? 'unplayable' : ''],
          disabled: !humanTurn,
          onClick: (e) => {
            if (!canPlay) {
              this.inspect(c);
              this.toast(`${def(c.id).name} has nothing to target right now.`);
              return;
            }
            if (e.detail === 2 && selected && t.direct) this.act(t.direct);
            else this.select({ kind: 'hand', uid: c.uid });
          },
          onHover: () => this.inspect(c),
        });
      }),
    );

    const toolbar = h(
      'nav',
      { class: 'toolbar', aria: { label: 'Match' } },
      h('button', { class: 'btn ghost', on: { click: () => this.undo() }, disabled: !this.history.length, title: 'Take back your last move (Z)' }, 'Undo'),
      h(
        'button',
        {
          class: `btn ghost${this.logOpen ? ' on' : ''}`,
          on: {
            click: () => {
              this.logOpen = !this.logOpen;
              this.render();
            },
          },
          title: 'Game log (L)',
        },
        'Log',
      ),
      h('button', { class: `btn ghost${this.coachOn ? ' on' : ''}`, on: { click: () => this.toggleCoach() }, title: 'Coach: hints and win chances (C)', aria: { pressed: String(this.coachOn) } }, 'Coach'),
      h('button', { class: 'btn ghost', on: { click: () => this.menuModal() }, title: 'Settings and quit', aria: { label: 'Menu' } }, '☰'),
    );

    const feed = h(
      'ol',
      { class: 'feed', aria: { hidden: 'true' } },
      ...this.log.slice(-4).map((l, i, arr) => h('li', { class: `${l.who}${i === arr.length - 1 ? ' latest' : ''}` }, l.text)),
    );

    const logPanel = this.logOpen
      ? h(
          'aside',
          { class: 'log', aria: { label: 'Game log' } },
          h('h3', null, 'Game log'),
          h('ol', null, ...this.log.map((l) => h('li', { class: l.who }, l.text))),
        )
      : null;

    const field = h(
      'main',
      { class: 'field' },
      h('div', { class: 'half op' }, rowEl(BOT, 'siege'), rowEl(BOT, 'ranged'), rowEl(BOT, 'close')),
      h('div', { class: 'half me' }, rowEl(HUMAN, 'close'), rowEl(HUMAN, 'ranged'), rowEl(HUMAN, 'siege')),
    );

    clear(this.root);
    this.root.append(
      h('aside', { class: 'side left' }, playerPanel(BOT), weatherBox, playerPanel(HUMAN)),
      field,
      h('aside', { class: 'side right' }, toolbar, pile(BOT), this.coachOn && humanTurn ? coachPanel(this.state, coachResult) : feed, controls, pile(HUMAN)),
      hand,
      h('div', { class: 'inspector-slot' }, inspector(this.inspected?.card ?? null, this.inspected?.strength)),
    );
    if (logPanel) this.root.append(logPanel);
    if (logPanel) logPanel.querySelector('ol')?.lastElementChild?.scrollIntoView({ block: 'end' });
    this.root.classList.toggle('selecting', !!this.selection);
    if (!this.selection && !this.modal) this.root.classList.remove('inspecting');
    this.lastUids = nowUids;
    this.requestCoach();
  }

  private menuModal(): void {
    const speed = h(
      'select',
      {
        on: {
          change: (e) => {
            this.settings.speed = (e.target as HTMLSelectElement).value as Settings['speed'];
            save('settings', this.settings);
          },
        },
      },
      ...(['normal', 'fast', 'instant'] as const).map((s) => {
        const o = h('option', null, s[0]!.toUpperCase() + s.slice(1));
        o.value = s;
        o.selected = this.settings.speed === s;
        return o;
      }),
    );
    const confirmBox = h('input', {
      type: 'checkbox',
      on: {
        change: (e) => {
          this.settings.confirmPass = (e.target as HTMLInputElement).checked;
          save('settings', this.settings);
        },
      },
    });
    confirmBox.checked = this.settings.confirmPass;
    this.openModal(
      'Menu',
      [
        h('label', { class: 'field-row' }, 'Opponent speed', speed),
        h('label', { class: 'field-row' }, confirmBox, 'Ask before passing with cards in hand'),
        h('p', { class: 'muted' }, 'Keys: Esc deselect · Enter play selected · P pass · Z undo · C coach · L log'),
        h(
          'div',
          { class: 'modal-actions' },
          h('button', { class: 'btn', on: { click: () => this.start(seedFrom(Date.now())) } }, 'Restart'),
          h('button', { class: 'btn', on: { click: () => this.exit() } }, 'Quit to menu'),
          h('button', { class: 'btn primary', on: { click: () => this.closeModal() } }, 'Back to game'),
        ),
      ],
      { dismissable: true },
    );
  }
}
