// Card tiles (board and hand) and the large card inspector.

import { ABILITY_TEXT, def, describe, FACTION_INFO, LEADER_TEXT } from '../classic/cards';
import type { Card, CardDef, Faction } from '../classic/types';
import { HIDDEN } from '../classic/view';
import { artLg, artSm, cardBack, icon } from './assets';
import { h } from './dom';

const ROW_LABEL = { close: 'close combat', ranged: 'ranged', siege: 'siege' } as const;

/** The small icon in a tile's corner: its main ability, or its row. */
function cornerIcon(d: CardDef): string | null {
  if (d.type === 'unit') {
    const a = d.abilities[0];
    if (a) return icon(`card_ability_${a.startsWith('scorch') ? 'scorch' : a}`);
    if (d.rows.length > 1) return icon('card_ability_agile');
    return icon(`card_row_${d.rows[0]}`);
  }
  if (d.type === 'weather') return d.effect === 'clear' ? null : icon(`card_weather_${d.effect}`);
  if (d.type === 'special') return d.effect === 'horn' || d.effect === 'mardroeme' ? icon(`card_special_${d.effect}`) : icon(`card_ability_${d.effect}`);
  return null;
}

export function ariaLabel(c: Card, strength?: number): string {
  if (c.id === HIDDEN) return 'Face-down card';
  const d = def(c.id);
  if (d.type === 'unit') {
    const s = strength ?? d.strength;
    const rows = d.rows.map((r) => ROW_LABEL[r]).join(' or ');
    return `${d.name}, ${s} strength${d.hero ? ', hero' : ''}, ${rows}${d.abilities.length ? `, ${d.abilities.map((a) => ABILITY_TEXT[a].name).join(', ')}` : ''}`;
  }
  return d.name;
}

export interface TileOptions {
  strength?: number;
  faction?: Faction;
  classes?: string[];
  onClick?: (e: MouseEvent) => void;
  onHover?: () => void;
  disabled?: boolean;
  tag?: 'button' | 'div';
}

export function tile(c: Card, o: TileOptions = {}): HTMLElement {
  const classes = ['card', ...(o.classes ?? [])];
  if (c.id === HIDDEN) {
    return h('div', { class: [...classes, 'card-back'].join(' '), aria: { label: 'Face-down card' } }, h('img', { src: cardBack(o.faction ?? 'realms'), alt: '', loading: 'lazy', decoding: 'async', draggable: false }));
  }
  const d = def(c.id);
  if (d.type === 'unit' && d.hero) classes.push('hero');
  const corner = cornerIcon(d);
  const tag = o.tag ?? (o.onClick ? 'button' : 'div');
  const el = h(
    tag,
    {
      class: classes.join(' '),
      data: { uid: c.uid, id: c.id },
      aria: { label: ariaLabel(c, o.strength) },
      disabled: o.disabled,
      type: tag === 'button' ? 'button' : undefined,
    },
    h('img', { class: 'art', src: artSm(c.id), alt: '', loading: 'lazy', decoding: 'async', draggable: false }),
    d.type === 'unit' ? strengthBadge(d.strength, o.strength ?? d.strength, d.hero) : null,
    corner ? h('img', { class: 'corner', src: corner, alt: '', draggable: false }) : null,
  );
  const onClick = o.onClick;
  if (onClick) el.addEventListener('click', (e) => onClick(e as MouseEvent));
  if (o.onHover) {
    el.addEventListener('mouseenter', o.onHover);
    el.addEventListener('focus', o.onHover);
  }
  return el;
}

function strengthBadge(base: number, now: number, hero: boolean): HTMLElement {
  const cls = ['power'];
  if (hero) cls.push('hero');
  else if (now > base) cls.push('up');
  else if (now < base) cls.push('down');
  return h('span', { class: cls.join(' ') }, now);
}

/** Large view of one card: framed art plus its rules text. */
export function inspector(c: Card | null, strength?: number): HTMLElement {
  if (!c || c.id === HIDDEN) return h('div', { class: 'inspector empty' });
  const d = def(c.id);
  const lines = describe(d);
  const kind =
    d.type === 'leader'
      ? `Leader · ${FACTION_INFO[d.faction].name}`
      : d.type === 'unit'
        ? `${d.hero ? 'Hero · ' : ''}${d.rows.map((r) => ROW_LABEL[r]).join(' / ')} · ${d.strength} strength${strength !== undefined && strength !== d.strength ? ` (now ${strength})` : ''}`
        : d.type === 'weather'
          ? 'Weather'
          : 'Special';
  return h(
    'div',
    { class: 'inspector' },
    h('img', { class: 'inspector-art', src: artLg(c.id), alt: d.name, decoding: 'async' }),
    h(
      'div',
      { class: 'inspector-text' },
      h('strong', null, d.name),
      h('span', { class: 'inspector-kind' }, kind),
      ...lines.map((l) => h('p', null, l)),
      d.type === 'leader' && LEADER_TEXT[d.leader].passive ? h('p', { class: 'muted' }, 'Passive: always on.') : null,
    ),
  );
}
