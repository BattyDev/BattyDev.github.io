// The Witcher 3 Gwent rules engine.
//
//   newGame(config)        → { state, events }
//   toAct(state)           → who must act next (or null when the game is over)
//   legalActions(state)    → every legal action for that player
//   apply(state, action)   → { state, events }   (throws IllegalAction)
//
// apply() never mutates its input. Cards are immutable values; a step clones
// the arrays it touches and nothing else, which keeps it cheap enough for the
// AI to call it hundreds of thousands of times.
//
// Rules we could not confirm against the real game are marked VERIFY and
// collected in docs/VERIFY.md.

import { Rng } from '../core/rng';
import { def, leaderDef, unitDef } from './cards';
import { cardStrength, isNormalUnit, leaderActive, rowScore, scores } from './score';
import type {
  Action,
  Card,
  GameConfig,
  GameEvent,
  GameState,
  LeaderAbility,
  PlayerId,
  PlayerState,
  Row,
  RowState,
  WeatherEffect,
} from './types';
import { ROWS } from './types';

export interface Step {
  state: GameState;
  events: GameEvent[];
}

export class IllegalAction extends Error {
  constructor(
    message: string,
    readonly action: Action,
  ) {
    super(message);
    this.name = 'IllegalAction';
  }
}

interface Ctx {
  s: GameState;
  rng: Rng;
  ev: GameEvent[];
}

const STARTING_HAND = 10;
const REDRAWS = 2;
const LIVES = 2;

export const other = (p: PlayerId): PlayerId => (p === 0 ? 1 : 0);

// ---------------------------------------------------------------------------
// Cloning

function cloneRow(r: RowState): RowState {
  return { units: r.units.slice(), special: r.special, leaderHorn: r.leaderHorn };
}

function clonePlayer(p: PlayerState): PlayerState {
  return {
    ...p,
    deck: p.deck.slice(),
    hand: p.hand.slice(),
    discard: p.discard.slice(),
    rows: { close: cloneRow(p.rows.close), ranged: cloneRow(p.rows.ranged), siege: cloneRow(p.rows.siege) },
  };
}

export function cloneState(s: GameState): GameState {
  return {
    ...s,
    players: [clonePlayer(s.players[0]), clonePlayer(s.players[1])],
    weather: s.weather.slice(),
    pending: s.pending ? { ...s.pending, options: s.pending.options.slice() } : null,
    rounds: s.rounds.slice(),
  };
}

// ---------------------------------------------------------------------------
// Setup

function emptyRows(): Record<Row, RowState> {
  return {
    close: { units: [], special: null, leaderHorn: false },
    ranged: { units: [], special: null, leaderHorn: false },
    siege: { units: [], special: null, leaderHorn: false },
  };
}

export function newGame(config: GameConfig): Step {
  const rng = new Rng(config.seed >>> 0);
  let uid = 1;
  const starts: number[] = [];
  const players = config.players.map((pc): PlayerState => {
    starts.push(uid);
    const leader = leaderDef(pc.deck.leader);
    const ids: string[] = [];
    for (const [id, n] of pc.deck.cards) {
      def(id); // throws on unknown ids
      for (let i = 0; i < n; i++) ids.push(id);
    }
    // Shuffle before assigning uids so a uid says nothing about the card.
    rng.shuffle(ids);
    return {
      name: pc.name,
      faction: leader.faction,
      leader: { uid: uid++, id: leader.id },
      leaderUsed: false,
      leaderDisabled: false,
      deck: ids.map((id) => ({ uid: uid++, id })),
      hand: [],
      discard: [],
      rows: emptyRows(),
      lives: LIVES,
      passed: false,
      redrawsLeft: REDRAWS,
      redrawDone: false,
    };
  }) as [PlayerState, PlayerState];

  const s: GameState = {
    rng: 0,
    nextUid: uid,
    phase: 'redraw',
    round: 0,
    current: 0,
    roundStarter: 0,
    chooser: null,
    players,
    weather: [],
    pending: null,
    rounds: [],
    randomRespawn: false,
    doubleSpies: false,
    winner: null,
    turn: 0,
    uidBounds: [starts[0] as number, starts[1] as number, uid],
  };
  const ctx: Ctx = { s, rng, ev: [] };

  // Emhyr, the White Flame cancels the other leader, passive or not.
  for (const p of [0, 1] as const) {
    s.players[p].leaderDisabled = leaderAbility(s, other(p)) === 'emhyr_whiteflame';
  }
  s.randomRespawn = leaderActive(s, 0, 'emhyr_invader') || leaderActive(s, 1, 'emhyr_invader');
  s.doubleSpies = leaderActive(s, 0, 'eredin_treacherous') || leaderActive(s, 1, 'eredin_treacherous');

  for (const p of [0, 1] as const) {
    const n = leaderActive(s, p, 'francesca_daisy') ? STARTING_HAND + 1 : STARTING_HAND;
    draw(ctx, p, n, 'start');
  }

  const scoia = ([0, 1] as const).filter((p) => s.players[p].faction === 'scoiatael');
  if (scoia.length === 1) {
    s.phase = 'chooseFirst';
    s.chooser = scoia[0] as PlayerId;
  } else {
    const first: PlayerId = rng.int(2) === 0 ? 0 : 1;
    s.roundStarter = first;
    s.current = first;
    ctx.ev.push({ type: 'coin', first, chosen: false });
  }
  s.rng = rng.state;
  return { state: s, events: ctx.ev };
}

// ---------------------------------------------------------------------------
// Queries

export function toAct(s: GameState): PlayerId | null {
  if (s.phase === 'over') return null;
  if (s.pending) return s.pending.player;
  if (s.phase === 'chooseFirst') return s.chooser;
  if (s.phase === 'redraw') return s.players[0].redrawDone ? 1 : 0;
  return s.current;
}

function leaderAbility(s: GameState, p: PlayerId): LeaderAbility {
  return leaderDef(s.players[p].leader.id).leader;
}

function findOnSide(s: GameState, side: PlayerId, uid: number): { row: Row; index: number } | null {
  for (const row of ROWS) {
    const index = s.players[side].rows[row].units.findIndex((c) => c.uid === uid);
    if (index >= 0) return { row, index };
  }
  return null;
}

/** Units a Medic (or the Skellige perk) can bring back: non-hero units. */
function revivable(cards: readonly Card[]): Card[] {
  return cards.filter((c) => isNormalUnit(def(c.id)));
}

function decoyTargets(s: GameState, p: PlayerId): { card: Card; row: Row }[] {
  const out: { card: Card; row: Row }[] = [];
  for (const row of ROWS) {
    for (const c of s.players[p].rows[row].units) {
      const d = def(c.id);
      // VERIFY: tokens (summoned/transformed) are treated as not decoyable,
      // except a transformed Berserker, which returns to hand as itself.
      if (d.type === 'unit' && !d.hero && (!d.token || c.base)) out.push({ card: c, row });
    }
  }
  return out;
}

function slotFree(r: RowState): boolean {
  return r.special === null && !r.leaderHorn;
}

/** The unit(s) a row-limited Scorch would destroy, or [] when it would fizzle. */
function rowScorchTargets(s: GameState, side: PlayerId, row: Row): Card[] {
  if (rowScore(s, side, row) < 10) return [];
  let max = -1;
  let out: Card[] = [];
  for (const c of s.players[side].rows[row].units) {
    if (!isNormalUnit(def(c.id))) continue;
    const st = cardStrength(s, side, row, c);
    if (st > max) {
      max = st;
      out = [c];
    } else if (st === max) out.push(c);
  }
  return out;
}

function deckHasWeather(s: GameState, p: PlayerId, effect: WeatherEffect): boolean {
  return s.players[p].deck.some((c) => {
    const d = def(c.id);
    return d.type === 'weather' && d.effect === effect;
  });
}

function agileUnits(s: GameState, p: PlayerId): { card: Card; row: Row }[] {
  const out: { card: Card; row: Row }[] = [];
  for (const row of ['close', 'ranged'] as const) {
    for (const c of s.players[p].rows[row].units) {
      const d = def(c.id);
      if (d.type === 'unit' && d.rows.length > 1) out.push({ card: c, row });
    }
  }
  return out;
}

/**
 * Whether the leader can be activated now. VERIFY: we only allow activations
 * that would do something, which also keeps the AI from "passing without
 * passing" through a no-op leader.
 */
export function canUseLeader(s: GameState, p: PlayerId): boolean {
  const P = s.players[p];
  if (P.leaderUsed || P.leaderDisabled) return false;
  const o = s.players[other(p)];
  switch (leaderAbility(s, p)) {
    case 'foltest_king':
      return deckHasWeather(s, p, 'fog');
    case 'emhyr_imperial':
      return deckHasWeather(s, p, 'rain');
    case 'francesca_pureblood':
      return deckHasWeather(s, p, 'frost');
    case 'foltest_lord':
      return s.weather.length > 0;
    case 'foltest_siegemaster':
      return slotFree(P.rows.siege);
    case 'eredin_commander':
      return slotFree(P.rows.close);
    case 'francesca_beautiful':
      return slotFree(P.rows.ranged);
    case 'foltest_steelforged':
      return rowScorchTargets(s, other(p), 'siege').length > 0;
    case 'foltest_son':
      return rowScorchTargets(s, other(p), 'ranged').length > 0;
    case 'francesca_queen':
      return rowScorchTargets(s, other(p), 'close').length > 0;
    case 'emhyr_emperor':
      return o.hand.length > 0;
    case 'emhyr_relentless':
      return revivable(o.discard).length > 0;
    case 'eredin_bringer_of_death':
      return revivable(P.discard).length > 0;
    case 'eredin_destroyer':
      return P.hand.length >= 2 && P.deck.length > 0;
    case 'eredin_king':
      return P.deck.some((c) => def(c.id).type === 'weather');
    case 'francesca_hope':
      return agileUnits(s, p).length > 0;
    case 'crach_an_craite':
      return P.discard.length > 0 || o.discard.length > 0;
    case 'emhyr_whiteflame':
    case 'emhyr_invader':
    case 'eredin_treacherous':
    case 'francesca_daisy':
    case 'king_bran':
      return false;
  }
}

/** Every legal action for the player who must act. Order is stable. */
export function legalActions(s: GameState): Action[] {
  const p = toAct(s);
  if (p === null) return [];
  const P = s.players[p];

  if (s.pending) {
    const out: Action[] = [];
    for (const uid of s.pending.options) {
      if (s.pending.kind === 'medic') {
        const card = P.discard.find((c) => c.uid === uid);
        const d = card && unitDef(card.id);
        if (d && d.rows.length > 1) {
          for (const row of d.rows) out.push({ type: 'choose', uid, row });
          continue;
        }
      }
      out.push({ type: 'choose', uid });
    }
    return out;
  }

  if (s.phase === 'chooseFirst') {
    return [
      { type: 'chooseFirst', first: p },
      { type: 'chooseFirst', first: other(p) },
    ];
  }

  if (s.phase === 'redraw') {
    const out: Action[] = [];
    if (P.redrawsLeft > 0 && P.deck.length > 0) for (const c of P.hand) out.push({ type: 'redraw', uid: c.uid });
    out.push({ type: 'endRedraw' });
    return out;
  }

  const out: Action[] = [];
  for (const card of P.hand) {
    const d = def(card.id);
    switch (d.type) {
      case 'unit':
        for (const row of d.rows) out.push({ type: 'play', uid: card.uid, row });
        break;
      case 'weather':
        out.push({ type: 'play', uid: card.uid });
        break;
      case 'special':
        switch (d.effect) {
          case 'decoy':
            for (const t of decoyTargets(s, p)) out.push({ type: 'play', uid: card.uid, target: t.card.uid });
            break;
          case 'horn':
          case 'mardroeme':
            for (const row of ROWS) if (slotFree(P.rows[row])) out.push({ type: 'play', uid: card.uid, row });
            break;
          case 'scorch':
            out.push({ type: 'play', uid: card.uid });
            break;
        }
        break;
      case 'leader':
        break;
    }
  }
  if (canUseLeader(s, p)) out.push({ type: 'leader' });
  out.push({ type: 'pass' });
  return out;
}

/** Fills in what an action leaves implicit (the row of a one-row unit). */
export function normalise(s: GameState, a: Action): Action {
  if (a.type === 'play' && a.row === undefined) {
    const p = toAct(s);
    const card = p === null ? undefined : s.players[p].hand.find((c) => c.uid === a.uid);
    const d = card && def(card.id);
    if (d && d.type === 'unit' && d.rows.length === 1) return { ...a, row: d.rows[0] as Row };
  }
  return a;
}

export function sameAction(a: Action, b: Action): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'chooseFirst':
      return a.first === (b as typeof a).first;
    case 'redraw':
      return a.uid === (b as typeof a).uid;
    case 'play': {
      const o = b as typeof a;
      return a.uid === o.uid && a.row === o.row && a.target === o.target;
    }
    case 'choose': {
      const o = b as typeof a;
      return a.uid === o.uid && a.row === o.row;
    }
    default:
      return true;
  }
}

export function isLegal(s: GameState, a: Action): boolean {
  const n = normalise(s, a);
  return legalActions(s).some((l) => sameAction(l, n));
}

// ---------------------------------------------------------------------------
// Applying actions

export function apply(state: GameState, action: Action): Step {
  const a = normalise(state, action);
  if (!isLegal(state, a)) throw new IllegalAction(`illegal action ${JSON.stringify(action)}`, action);
  return applyUnchecked(state, a);
}

/** apply() without the legality check, for callers that got `a` from legalActions(). */
export function applyUnchecked(state: GameState, a: Action): Step {
  const s = cloneState(state);
  const ctx: Ctx = { s, rng: new Rng(s.rng), ev: [] };
  const p = toAct(s) as PlayerId;
  s.turn++;

  switch (a.type) {
    case 'chooseFirst':
      s.roundStarter = a.first;
      s.current = a.first;
      s.phase = 'redraw';
      s.chooser = null;
      ctx.ev.push({ type: 'coin', first: a.first, chosen: true });
      break;
    case 'redraw':
      redraw(ctx, p, a.uid);
      break;
    case 'endRedraw':
      s.players[p].redrawDone = true;
      maybeStartGame(ctx);
      break;
    case 'play':
      playCard(ctx, p, a.uid, a.row, a.target);
      if (!s.pending) endTurn(ctx);
      break;
    case 'leader':
      useLeader(ctx, p);
      if (!s.pending) endTurn(ctx);
      break;
    case 'pass':
      s.players[p].passed = true;
      ctx.ev.push({ type: 'pass', player: p, auto: false });
      endTurn(ctx);
      break;
    case 'choose':
      resolvePending(ctx, a.uid, a.row);
      if (!s.pending) endTurn(ctx);
      break;
  }

  s.rng = ctx.rng.state;
  return { state: s, events: ctx.ev };
}

function redraw(ctx: Ctx, p: PlayerId, uid: number): void {
  const P = ctx.s.players[p];
  const i = P.hand.findIndex((c) => c.uid === uid);
  const [out] = P.hand.splice(i, 1) as [Card];
  const drawn = P.deck.pop() ?? null;
  if (drawn) P.hand.splice(i, 0, drawn);
  P.deck.splice(ctx.rng.int(P.deck.length + 1), 0, out);
  P.redrawsLeft--;
  ctx.ev.push({ type: 'redraw', player: p, out, in: drawn });
  if (P.redrawsLeft === 0) {
    P.redrawDone = true;
    maybeStartGame(ctx);
  }
}

function maybeStartGame(ctx: Ctx): void {
  const s = ctx.s;
  if (s.players[0].redrawDone && s.players[1].redrawDone) {
    s.phase = 'play';
    startRound(ctx, null);
  }
}

function draw(ctx: Ctx, p: PlayerId, n: number, reason: string): Card[] {
  const P = ctx.s.players[p];
  const cards: Card[] = [];
  for (let i = 0; i < n && P.deck.length > 0; i++) {
    const c = P.deck.pop() as Card;
    P.hand.push(c);
    cards.push(c);
  }
  if (cards.length) ctx.ev.push({ type: 'draw', player: p, cards, reason });
  return cards;
}

function takeFromHand(ctx: Ctx, p: PlayerId, uid: number): Card {
  const hand = ctx.s.players[p].hand;
  const i = hand.findIndex((c) => c.uid === uid);
  if (i < 0) throw new Error(`card ${uid} not in hand`);
  return hand.splice(i, 1)[0] as Card;
}

function playCard(ctx: Ctx, p: PlayerId, uid: number, row: Row | undefined, target: number | undefined): void {
  const s = ctx.s;
  const P = s.players[p];
  const card = takeFromHand(ctx, p, uid);
  const d = def(card.id);

  if (d.type === 'unit') {
    const r = row ?? (d.rows[0] as Row);
    const side = d.abilities.includes('spy') ? other(p) : p;
    s.players[side].rows[r].units.push(card);
    ctx.ev.push({ type: 'play', player: p, card, side, row: r });
    onPlaced(ctx, p, side, r, card);
    return;
  }

  if (d.type === 'weather') {
    ctx.ev.push({ type: 'play', player: p, card, side: p, row: null });
    if (d.effect === 'clear') {
      clearWeather(ctx, p);
      P.discard.push(card);
    } else {
      s.weather.push({ card, owner: p });
      ctx.ev.push({ type: 'weather', player: p, effect: d.effect });
    }
    return;
  }

  if (d.type === 'special') {
    switch (d.effect) {
      case 'decoy': {
        const at = findOnSide(s, p, target as number);
        if (!at) throw new Error('decoy target missing');
        const rowUnits = P.rows[at.row].units;
        const returned = rowUnits[at.index] as Card;
        rowUnits[at.index] = card;
        const back = returned.base ? { uid: returned.uid, id: returned.base } : returned;
        P.hand.push(back);
        ctx.ev.push({ type: 'decoy', player: p, card, returned: back, row: at.row });
        return;
      }
      case 'horn':
        P.rows[row as Row].special = card;
        ctx.ev.push({ type: 'play', player: p, card, side: p, row: row as Row });
        return;
      case 'mardroeme':
        P.rows[row as Row].special = card;
        ctx.ev.push({ type: 'play', player: p, card, side: p, row: row as Row });
        transformRow(ctx, p, row as Row);
        return;
      case 'scorch':
        ctx.ev.push({ type: 'play', player: p, card, side: p, row: null });
        scorchAll(ctx, null);
        P.discard.push(card);
        return;
    }
  }
  throw new Error(`cannot play ${card.id}`);
}

/** Triggers a unit's on-play ability. `actor` is who played it; `side` is where it landed. */
function onPlaced(ctx: Ctx, actor: PlayerId, side: PlayerId, row: Row, card: Card): void {
  const d = unitDef(card.id);
  if (!d) return;
  for (const ability of d.abilities) {
    switch (ability) {
      case 'berserker':
        if (rowHasMardroeme(ctx.s, side, row)) transform(ctx, side, row, card);
        break;
      case 'mardroeme':
        transformRow(ctx, side, row);
        break;
      case 'muster':
        if (d.musterPulls) muster(ctx, actor, d.musterPulls);
        break;
      case 'spy':
        draw(ctx, actor, 2, 'spy');
        break;
      case 'medic':
        startMedic(ctx, actor);
        break;
      case 'scorch':
        // VERIFY: Clan Dimun Pirate does not count itself when finding the
        // strongest units (it can never scorch itself).
        scorchAll(ctx, card);
        break;
      case 'scorch_close':
        scorchRow(ctx, other(actor), 'close', 'ability');
        break;
      case 'scorch_ranged':
        scorchRow(ctx, other(actor), 'ranged', 'ability');
        break;
      case 'scorch_siege':
        scorchRow(ctx, other(actor), 'siege', 'ability');
        break;
      default:
        break; // passive: bond, morale, horn, avenger
    }
  }
}

function rowHasMardroeme(s: GameState, side: PlayerId, row: Row): boolean {
  const r = s.players[side].rows[row];
  if (r.special) {
    const d = def(r.special.id);
    if (d.type === 'special' && d.effect === 'mardroeme') return true;
  }
  return r.units.some((c) => unitDef(c.id)?.abilities.includes('mardroeme') ?? false);
}

function transform(ctx: Ctx, side: PlayerId, row: Row, card: Card): void {
  const d = unitDef(card.id);
  if (!d?.summons || card.base) return;
  const units = ctx.s.players[side].rows[row].units;
  const i = units.findIndex((c) => c.uid === card.uid);
  const to: Card = { uid: card.uid, id: d.summons, base: card.id };
  units[i] = to;
  ctx.ev.push({ type: 'transform', side, from: card, to, row });
}

function transformRow(ctx: Ctx, side: PlayerId, row: Row): void {
  for (const c of ctx.s.players[side].rows[row].units.slice()) {
    if (unitDef(c.id)?.abilities.includes('berserker')) transform(ctx, side, row, c);
  }
}

function muster(ctx: Ctx, p: PlayerId, group: string): void {
  const P = ctx.s.players[p];
  const pulled: Card[] = [];
  const rest: Card[] = [];
  for (const c of P.deck) (unitDef(c.id)?.group === group ? pulled : rest).push(c);
  if (!pulled.length) return;
  P.deck = rest;
  for (const c of pulled) P.rows[unitDef(c.id)?.rows[0] as Row].units.push(c);
  ctx.ev.push({ type: 'muster', player: p, cards: pulled });
}

function startMedic(ctx: Ctx, p: PlayerId): void {
  const options = revivable(ctx.s.players[p].discard);
  if (!options.length) return;
  if (ctx.s.randomRespawn) {
    revive(ctx, p, ctx.rng.pick(options).uid, undefined, 'medic');
    return;
  }
  ctx.s.pending = { kind: 'medic', player: p, options: options.map((c) => c.uid) };
}

function revive(ctx: Ctx, p: PlayerId, uid: number, row: Row | undefined, reason: string): void {
  const P = ctx.s.players[p];
  const i = P.discard.findIndex((c) => c.uid === uid);
  const [card] = P.discard.splice(i, 1) as [Card];
  const d = unitDef(card.id) as NonNullable<ReturnType<typeof unitDef>>;
  const side = d.abilities.includes('spy') ? other(p) : p;
  const r = row ?? bestRow(ctx.s, side, card);
  ctx.s.players[side].rows[r].units.push(card);
  ctx.ev.push({ type: 'revive', player: p, card, side, row: r, reason });
  onPlaced(ctx, p, side, r, card);
}

/** For agile cards placed without a choice: the row that scores more (close on a tie). */
function bestRow(s: GameState, side: PlayerId, card: Card): Row {
  const d = unitDef(card.id);
  if (!d || d.rows.length === 1) return (d?.rows[0] ?? 'close') as Row;
  let best: Row = d.rows[0] as Row;
  let bestScore = -Infinity;
  for (const row of d.rows) {
    const trial = { ...s, players: [...s.players] as [PlayerState, PlayerState] };
    const P = { ...s.players[side], rows: { ...s.players[side].rows } };
    P.rows[row] = { ...P.rows[row], units: [...P.rows[row].units, card] };
    trial.players[side] = P;
    const score = rowScore(trial, side, 'close') + rowScore(trial, side, 'ranged');
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  return best;
}

function scorchAll(ctx: Ctx, exclude: Card | null): void {
  const s = ctx.s;
  let max = -1;
  let targets: { side: PlayerId; row: Row; card: Card }[] = [];
  for (const side of [0, 1] as const) {
    for (const row of ROWS) {
      for (const c of s.players[side].rows[row].units) {
        if (c === exclude || !isNormalUnit(def(c.id))) continue;
        const st = cardStrength(s, side, row, c);
        if (st > max) {
          max = st;
          targets = [{ side, row, card: c }];
        } else if (st === max) targets.push({ side, row, card: c });
      }
    }
  }
  for (const t of targets) destroy(ctx, t.side, t.row, t.card, 'scorch');
}

function scorchRow(ctx: Ctx, side: PlayerId, row: Row, reason: string): void {
  for (const c of rowScorchTargets(ctx.s, side, row)) destroy(ctx, side, row, c, reason);
}

function destroy(ctx: Ctx, side: PlayerId, row: Row, card: Card, reason: string): void {
  const units = ctx.s.players[side].rows[row].units;
  units.splice(
    units.findIndex((c) => c.uid === card.uid),
    1,
  );
  ctx.ev.push({ type: 'destroy', side, card, row, reason });
  const summon = leaveBoard(ctx, side, card);
  if (summon) summonToken(ctx, side, summon);
}

/**
 * A card leaving the battlefield: tokens vanish, transformed cards revert,
 * everything else goes to the discard pile of the side it was on. Returns the
 * token an Avenger summons, for the caller to place.
 */
function leaveBoard(ctx: Ctx, side: PlayerId, card: Card): string | null {
  const d = def(card.id);
  if (d.type === 'unit' && d.token && !card.base) return null;
  const back: Card = card.base ? { uid: card.uid, id: card.base } : card;
  ctx.s.players[side].discard.push(back);
  const o = unitDef(back.id);
  return o && o.abilities.includes('avenger') && o.summons ? o.summons : null;
}

function summonToken(ctx: Ctx, side: PlayerId, id: string): void {
  const d = unitDef(id);
  if (!d) return;
  const card: Card = { uid: ctx.s.nextUid++, id };
  const row = d.rows[0] as Row;
  ctx.s.players[side].rows[row].units.push(card);
  ctx.ev.push({ type: 'summon', side, card, row });
}

function clearWeather(ctx: Ctx, p: PlayerId): void {
  for (const w of ctx.s.weather) ctx.s.players[w.owner].discard.push(w.card);
  ctx.s.weather = [];
  ctx.ev.push({ type: 'weather', player: p, effect: 'clear' });
}

function weatherFromDeck(ctx: Ctx, p: PlayerId, uid: number): void {
  const P = ctx.s.players[p];
  const i = P.deck.findIndex((c) => c.uid === uid);
  const [card] = P.deck.splice(i, 1) as [Card];
  const d = def(card.id);
  if (d.type !== 'weather') throw new Error('not a weather card');
  ctx.ev.push({ type: 'play', player: p, card, side: p, row: null });
  if (d.effect === 'clear') {
    clearWeather(ctx, p);
    P.discard.push(card);
  } else {
    ctx.s.weather.push({ card, owner: p });
    ctx.ev.push({ type: 'weather', player: p, effect: d.effect });
  }
}

function firstWeatherInDeck(s: GameState, p: PlayerId, effect: WeatherEffect): number {
  const c = s.players[p].deck.find((x) => {
    const d = def(x.id);
    return d.type === 'weather' && d.effect === effect;
  });
  if (!c) throw new Error(`no ${effect} in deck`);
  return c.uid;
}

function leaderHorn(ctx: Ctx, p: PlayerId, row: Row): void {
  ctx.s.players[p].rows[row].leaderHorn = true;
  ctx.ev.push({ type: 'leaderHorn', player: p, row });
}

function useLeader(ctx: Ctx, p: PlayerId): void {
  const s = ctx.s;
  const P = s.players[p];
  const o = s.players[other(p)];
  const ability = leaderAbility(s, p);
  P.leaderUsed = true;
  ctx.ev.push({ type: 'leader', player: p, ability });
  switch (ability) {
    case 'foltest_king':
      weatherFromDeck(ctx, p, firstWeatherInDeck(s, p, 'fog'));
      break;
    case 'emhyr_imperial':
      weatherFromDeck(ctx, p, firstWeatherInDeck(s, p, 'rain'));
      break;
    case 'francesca_pureblood':
      weatherFromDeck(ctx, p, firstWeatherInDeck(s, p, 'frost'));
      break;
    case 'foltest_lord':
      clearWeather(ctx, p);
      break;
    case 'foltest_siegemaster':
      leaderHorn(ctx, p, 'siege');
      break;
    case 'eredin_commander':
      leaderHorn(ctx, p, 'close');
      break;
    case 'francesca_beautiful':
      leaderHorn(ctx, p, 'ranged');
      break;
    case 'foltest_steelforged':
      scorchRow(ctx, other(p), 'siege', 'leader');
      break;
    case 'foltest_son':
      scorchRow(ctx, other(p), 'ranged', 'leader');
      break;
    case 'francesca_queen':
      scorchRow(ctx, other(p), 'close', 'leader');
      break;
    case 'emhyr_emperor':
      ctx.ev.push({ type: 'reveal', player: p, cards: ctx.rng.sample(o.hand, 3) });
      break;
    case 'emhyr_relentless':
      // VERIFY: limited to non-hero units, as for Medic.
      s.pending = { kind: 'relentless', player: p, options: revivable(o.discard).map((c) => c.uid) };
      break;
    case 'eredin_bringer_of_death':
      // VERIFY: limited to non-hero units, as for Medic.
      s.pending = { kind: 'bringer', player: p, options: revivable(P.discard).map((c) => c.uid) };
      break;
    case 'eredin_destroyer':
      s.pending = { kind: 'destroyerDiscard', player: p, remaining: 2, options: P.hand.map((c) => c.uid) };
      break;
    case 'eredin_king': {
      // One option per distinct weather effect: which copy is irrelevant.
      const seen = new Set<string>();
      const options: number[] = [];
      for (const c of P.deck) {
        const d = def(c.id);
        if (d.type === 'weather' && !seen.has(d.effect)) {
          seen.add(d.effect);
          options.push(c.uid);
        }
      }
      s.pending = { kind: 'kingWeather', player: p, options };
      break;
    }
    case 'francesca_hope':
      hope(ctx, p);
      break;
    case 'crach_an_craite':
      for (const X of s.players) {
        X.deck.push(...X.discard);
        X.discard = [];
        ctx.rng.shuffle(X.deck);
      }
      ctx.ev.push({ type: 'shuffleDiscards' });
      break;
    default:
      throw new Error(`${ability} has no activation`);
  }
}

function resolvePending(ctx: Ctx, uid: number, row: Row | undefined): void {
  const s = ctx.s;
  const pend = s.pending;
  if (!pend) throw new Error('nothing pending');
  s.pending = null;
  const p = pend.player;
  const P = s.players[p];
  switch (pend.kind) {
    case 'medic':
      revive(ctx, p, uid, row, 'medic');
      break;
    case 'bringer': {
      const i = P.discard.findIndex((c) => c.uid === uid);
      const [card] = P.discard.splice(i, 1) as [Card];
      P.hand.push(card);
      ctx.ev.push({ type: 'toHand', player: p, card, from: 'discard' });
      break;
    }
    case 'relentless': {
      const o = s.players[other(p)];
      const i = o.discard.findIndex((c) => c.uid === uid);
      const [card] = o.discard.splice(i, 1) as [Card];
      P.hand.push(card);
      ctx.ev.push({ type: 'toHand', player: p, card, from: 'opponentDiscard' });
      break;
    }
    case 'destroyerDiscard': {
      const card = takeFromHand(ctx, p, uid);
      P.discard.push(card);
      ctx.ev.push({ type: 'discard', player: p, card });
      if (pend.remaining > 1) {
        s.pending = { kind: 'destroyerDiscard', player: p, remaining: pend.remaining - 1, options: P.hand.map((c) => c.uid) };
      } else if (P.deck.length > 0) {
        s.pending = { kind: 'destroyerDraw', player: p, options: P.deck.map((c) => c.uid) };
      }
      break;
    }
    case 'destroyerDraw': {
      const i = P.deck.findIndex((c) => c.uid === uid);
      const [card] = P.deck.splice(i, 1) as [Card];
      P.hand.push(card);
      ctx.rng.shuffle(P.deck);
      ctx.ev.push({ type: 'toHand', player: p, card, from: 'deck' });
      break;
    }
    case 'kingWeather':
      weatherFromDeck(ctx, p, uid);
      break;
  }
}

/** Francesca, Hope of the Aen Seidhe: put every agile unit on its best row. */
function hope(ctx: Ctx, p: PlayerId): void {
  const s = ctx.s;
  const P = s.players[p];
  const agile = agileUnits(s, p);
  const fixedClose = P.rows.close.units.filter((c) => !agile.some((a) => a.card === c));
  const fixedRanged = P.rows.ranged.units.filter((c) => !agile.some((a) => a.card === c));
  const n = agile.length;
  const score = (mask: number): number => {
    const close = fixedClose.slice();
    const ranged = fixedRanged.slice();
    agile.forEach((a, i) => ((mask >> i) & 1 ? ranged : close).push(a.card));
    const trialP = { ...P, rows: { ...P.rows, close: { ...P.rows.close, units: close }, ranged: { ...P.rows.ranged, units: ranged } } };
    const trial = { ...s, players: [...s.players] as [PlayerState, PlayerState] };
    trial.players[p] = trialP;
    return rowScore(trial, p, 'close') + rowScore(trial, p, 'ranged');
  };
  let current = 0;
  agile.forEach((a, i) => {
    if (a.row === 'ranged') current |= 1 << i;
  });
  // Exhaustive up to 2^12 arrangements; beyond that, improve one card at a time.
  let best = current;
  let bestScore = score(current);
  if (n <= 12) {
    for (let mask = 0; mask < 1 << n; mask++) {
      const sc = score(mask);
      if (sc > bestScore) {
        bestScore = sc;
        best = mask;
      }
    }
  } else {
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < n; i++) {
        const sc = score(best ^ (1 << i));
        if (sc > bestScore) {
          bestScore = sc;
          best ^= 1 << i;
          improved = true;
        }
      }
    }
  }
  agile.forEach((a, i) => {
    const to: Row = (best >> i) & 1 ? 'ranged' : 'close';
    if (to !== a.row) {
      const from = P.rows[a.row].units;
      from.splice(
        from.findIndex((c) => c.uid === a.card.uid),
        1,
      );
      P.rows[to].units.push(a.card);
      ctx.ev.push({ type: 'move', side: p, card: a.card, from: a.row, to });
    }
  });
}

// ---------------------------------------------------------------------------
// Turn and round flow

function hasAnyMove(s: GameState, p: PlayerId): boolean {
  const P = s.players[p];
  if (canUseLeader(s, p)) return true;
  for (const card of P.hand) {
    const d = def(card.id);
    if (d.type === 'unit' || d.type === 'weather') return true;
    if (d.type === 'special') {
      if (d.effect === 'scorch') return true;
      if (d.effect === 'decoy' && decoyTargets(s, p).length > 0) return true;
      if ((d.effect === 'horn' || d.effect === 'mardroeme') && ROWS.some((r) => slotFree(P.rows[r]))) return true;
    }
  }
  return false;
}

function autoPass(ctx: Ctx, p: PlayerId): void {
  ctx.s.players[p].passed = true;
  ctx.ev.push({ type: 'pass', player: p, auto: true });
}

function endTurn(ctx: Ctx): void {
  const s = ctx.s;
  for (;;) {
    if (s.phase !== 'play') return;
    if (s.players[0].passed && s.players[1].passed) {
      endRound(ctx);
      return;
    }
    const next = other(s.current);
    if (!s.players[next].passed) s.current = next;
    // A player with nothing playable passes automatically, as in the game.
    if (!hasAnyMove(s, s.current)) {
      autoPass(ctx, s.current);
      continue;
    }
    return;
  }
}

function endRound(ctx: Ctx): void {
  const s = ctx.s;
  const sc = scores(s);
  let winner: PlayerId | null = sc[0] > sc[1] ? 0 : sc[1] > sc[0] ? 1 : null;
  if (winner === null) {
    const nilf = ([0, 1] as const).filter((p) => s.players[p].faction === 'nilfgaard');
    if (nilf.length === 1) winner = nilf[0] as PlayerId;
  }
  if (winner === null) {
    s.players[0].lives--;
    s.players[1].lives--;
  } else {
    s.players[other(winner)].lives--;
  }
  s.rounds = [...s.rounds, { scores: sc, winner }];
  ctx.ev.push({ type: 'roundEnd', round: s.round, scores: sc, winner, lives: [s.players[0].lives, s.players[1].lives] });

  const over = s.players[0].lives <= 0 || s.players[1].lives <= 0;

  // Monsters: one random non-hero unit stays on the battlefield.
  const keep = new Set<number>();
  if (!over) {
    for (const p of [0, 1] as const) {
      if (s.players[p].faction !== 'monsters') continue;
      const units = ROWS.flatMap((row) => s.players[p].rows[row].units).filter((c) => isNormalUnit(def(c.id)));
      if (!units.length) continue;
      const kept = ctx.rng.pick(units);
      keep.add(kept.uid);
      ctx.ev.push({ type: 'perk', player: p, faction: 'monsters', cards: [kept] });
    }
  }

  const summons: { side: PlayerId; id: string }[] = [];
  for (const side of [0, 1] as const) {
    const P = s.players[side];
    for (const row of ROWS) {
      const r = P.rows[row];
      const stay: Card[] = [];
      for (const c of r.units) {
        if (keep.has(c.uid)) {
          stay.push(c);
          continue;
        }
        const summon = leaveBoard(ctx, side, c);
        if (summon) summons.push({ side, id: summon });
      }
      r.units = stay;
      if (r.special) P.discard.push(r.special);
      r.special = null;
      r.leaderHorn = false;
    }
  }
  for (const w of s.weather) s.players[w.owner].discard.push(w.card);
  s.weather = [];

  if (over) {
    s.phase = 'over';
    const [a, b] = [s.players[0].lives, s.players[1].lives];
    s.winner = a <= 0 && b <= 0 ? 'draw' : a <= 0 ? 1 : 0;
    ctx.ev.push({ type: 'gameOver', winner: s.winner });
    return;
  }

  // VERIFY: an Avenger removed at the end of a round summons its token at the
  // start of the next.
  for (const t of summons) summonToken(ctx, t.side, t.id);

  // VERIFY: the round winner starts the next round; after a draw, whoever
  // started this one starts again.
  if (winner !== null) s.roundStarter = winner;
  startRound(ctx, winner);
}

function startRound(ctx: Ctx, prevWinner: PlayerId | null): void {
  const s = ctx.s;
  s.round++;
  s.current = s.roundStarter;
  for (const P of s.players) P.passed = false;
  ctx.ev.push({ type: 'roundStart', round: s.round, first: s.roundStarter });

  if (prevWinner !== null && s.players[prevWinner].faction === 'realms') {
    const cards = draw(ctx, prevWinner, 1, 'perk');
    ctx.ev.push({ type: 'perk', player: prevWinner, faction: 'realms', cards });
  }

  if (s.round === 3) {
    for (const p of [0, 1] as const) {
      if (s.players[p].faction !== 'skellige') continue;
      // VERIFY: placed, not played: no Spy draw, Medic or Muster triggers.
      const P = s.players[p];
      const chosen = ctx.rng.sample(revivable(P.discard), 2);
      for (const card of chosen) {
        P.discard.splice(
          P.discard.findIndex((c) => c.uid === card.uid),
          1,
        );
        const row = bestRow(s, p, card);
        P.rows[row].units.push(card);
      }
      ctx.ev.push({ type: 'perk', player: p, faction: 'skellige', cards: chosen });
    }
  }

  for (const p of [s.roundStarter, other(s.roundStarter)]) {
    if (!hasAnyMove(s, p)) autoPass(ctx, p);
  }
  if (s.players[0].passed && s.players[1].passed) {
    endRound(ctx);
    return;
  }
  if (s.players[s.current].passed) s.current = other(s.current);
}
