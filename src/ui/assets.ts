import { def } from '../classic/cards';
import type { Faction } from '../classic/types';

const BASE = import.meta.env.BASE_URL;

export const artSm = (id: string) => `${BASE}art/sm/${def(id).art}.webp`;
export const artLg = (id: string) => `${BASE}art/lg/${def(id).art}.webp`;
export const icon = (name: string) => `${BASE}art/icons/${name}.webp`;
export const factionArt = (f: Faction) => `${BASE}art/lg/faction_${f}.webp`;
export const shield = (f: Faction) => icon(`deck_shield_${f}`);
export const cardBack = (f: Faction) => icon(`deck_back_${f}`);
