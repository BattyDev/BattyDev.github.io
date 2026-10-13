/* BattyDev · Baby · Savings — item illustrations
   Simple line drawings on a 64×64 grid. Each is drawn four times: a muted fill,
   the gold fill clipped to the funded fraction (rising from the bottom, like a
   fundraising thermometer), then the outline, with the clipped part of the
   outline in gold too. Elements marked fill="none" are lines only.

   A goal's `icon` field picks one of these by name; anything unknown gets the
   gift box. Add a new drawing here and it is available to every goal. */

'use strict';

const ICON_LINE = 'fill="none"';

const BABY_ICONS = {
  crib: `
    <rect x="6" y="8" width="6" height="50" rx="2"/><rect x="52" y="8" width="6" height="50" rx="2"/>
    <rect x="12" y="14" width="40" height="4" rx="1"/><rect x="12" y="40" width="40" height="8" rx="1"/>
    <rect x="16.5" y="18" width="3" height="22"/><rect x="23.5" y="18" width="3" height="22"/>
    <rect x="30.5" y="18" width="3" height="22"/><rect x="37.5" y="18" width="3" height="22"/>
    <rect x="44.5" y="18" width="3" height="22"/>`,
  stroller: `
    <path d="M8 28 H48 A20 16 0 0 1 8 28 Z"/><path d="M8 28 A20 20 0 0 1 28 8 V28 Z"/>
    <path ${ICON_LINE} d="M48 28 L54 12 H60"/><path ${ICON_LINE} d="M22 42 L17 49 M36 42 L41 49"/>
    <circle cx="16" cy="54" r="6"/><circle cx="42" cy="54" r="6"/>`,
  carseat: `
    <path ${ICON_LINE} d="M10 32 A22 20 0 0 1 54 32"/>
    <path d="M8 32 H56 Q56 50 42 54 H22 Q8 50 8 32 Z"/><path d="M8 32 Q10 18 26 14 V32 Z"/>
    <rect x="14" y="54" width="36" height="5" rx="2"/>`,
  bassinet: `
    <path d="M8 22 H56 Q54 40 32 40 Q10 40 8 22 Z"/><path d="M8 22 Q10 10 24 8 V22 Z"/>
    <path ${ICON_LINE} d="M22 40 L16 58 M42 40 L48 58 M18 52 H46"/>`,
  dresser: `
    <rect x="12" y="12" width="40" height="8" rx="4"/><rect x="8" y="20" width="48" height="36" rx="2"/>
    <path ${ICON_LINE} d="M8 32 H56 M8 44 H56 M12 56 V60 M52 56 V60 M29 26 H35 M29 38 H35 M29 50 H35"/>`,
  monitor: `
    <path ${ICON_LINE} d="M40 12 V4"/><rect x="18" y="12" width="28" height="46" rx="5"/>
    <rect ${ICON_LINE} x="22" y="18" width="20" height="22" rx="2"/><circle ${ICON_LINE} cx="32" cy="49" r="3.5"/>`,
  bottle: `
    <path d="M28 6 Q32 2 36 6 L38 16 H26 Z"/><rect x="22" y="16" width="20" height="6" rx="2"/>
    <rect x="21" y="22" width="22" height="36" rx="6"/><path ${ICON_LINE} d="M27 32 H32 M27 40 H32 M27 48 H32"/>`,
  diapers: `
    <path d="M6 16 H58 V26 Q48 28 44 40 Q40 54 32 54 Q24 54 20 40 Q16 28 6 26 Z"/>
    <path ${ICON_LINE} d="M6 21 H14 M50 21 H58"/>`,
  bag: `
    <path ${ICON_LINE} d="M22 22 V15 Q22 11 26 11 H38 Q42 11 42 15 V22"/>
    <rect x="7" y="22" width="50" height="34" rx="6"/><path ${ICON_LINE} d="M32 31 V47 M24 39 H40"/>`,
  piggy: `
    <path d="M22 22 L26 12 L32 21 Z"/><ellipse cx="30" cy="36" rx="22" ry="16"/>
    <rect x="48" y="30" width="9" height="10" rx="3"/>
    <rect x="16" y="48" width="7" height="10" rx="2"/><rect x="34" y="48" width="7" height="10" rx="2"/>
    <path ${ICON_LINE} d="M24 27 H34"/>`,
  onesie: `
    <path d="M22 8 Q32 16 42 8 L56 16 L50 28 L44 24 V50 Q44 58 36 58 H28 Q20 58 20 50 V24 L14 28 L8 16 Z"/>
    <path ${ICON_LINE} d="M28 53 H36"/>`,
  highchair: `
    <rect x="20" y="6" width="24" height="22" rx="4"/><rect x="18" y="28" width="28" height="8" rx="2"/>
    <rect x="10" y="24" width="18" height="5" rx="2"/><path ${ICON_LINE} d="M22 36 L16 58 M42 36 L48 58 M19 48 H45"/>`,
  jar: `
    <rect x="22" y="6" width="20" height="7" rx="2"/>
    <path d="M18 13 H46 Q52 17 52 25 V52 Q52 58 46 58 H18 Q12 58 12 52 V25 Q12 17 18 13 Z"/>
    <path ${ICON_LINE} d="M28 9.5 H36 M32 26 V48 M37 30 Q32 26 27 30 Q25 35 32 37 Q39 39 37 44 Q32 48 27 44"/>`,
  gift: `
    <rect x="10" y="26" width="44" height="32" rx="2"/><rect x="6" y="18" width="52" height="9" rx="2"/>
    <path ${ICON_LINE} d="M32 18 V58 M32 18 Q22 6 18 12 Q16 18 32 18 Q48 18 46 12 Q42 6 32 18"/>`,
};

let iconSeq = 0;

/* An item drawing filled to `frac` (0..1) from the bottom. Decorative: the
   caller always prints the name and the numbers beside it. */
function iconSVG(name, frac, cls = '') {
  const id = `ic${(iconSeq += 1)}`;
  const shape = BABY_ICONS[name] || BABY_ICONS.gift;
  const f = Math.max(0, Math.min(1, Number(frac) || 0));
  const top = (64 * (1 - f)).toFixed(2);
  return `
    <svg class="item-art ${cls}" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <g id="${id}s">${shape}</g>
        <clipPath id="${id}c"><rect x="-2" y="${top}" width="68" height="${(66 - top).toFixed(2)}"/></clipPath>
      </defs>
      <use href="#${id}s" class="art-base"/>
      <use href="#${id}s" class="art-fill" clip-path="url(#${id}c)"/>
      <use href="#${id}s" class="art-line"/>
      <use href="#${id}s" class="art-line-fill" clip-path="url(#${id}c)"/>
    </svg>`;
}
