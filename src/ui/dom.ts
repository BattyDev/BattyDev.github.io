// A very small hyperscript helper: enough to build the UI without a framework.

type Child = Node | string | number | null | undefined | false;

export interface Props {
  class?: string;
  id?: string;
  title?: string;
  role?: string;
  type?: string;
  tabIndex?: number;
  disabled?: boolean;
  src?: string;
  alt?: string;
  href?: string;
  rel?: string;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
  draggable?: boolean;
  style?: string;
  aria?: Record<string, string>;
  data?: Record<string, string | number>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (e: HTMLElementEventMap[K]) => void }>;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    const { aria, data, on, style, ...rest } = props;
    for (const [k, v] of Object.entries(rest)) {
      if (v === undefined) continue;
      if (k === 'class') el.className = v as string;
      else (el as unknown as Record<string, unknown>)[k] = v;
    }
    if (style) el.setAttribute('style', style);
    if (aria) for (const [k, v] of Object.entries(aria)) el.setAttribute(`aria-${k}`, v);
    if (data) for (const [k, v] of Object.entries(data)) el.dataset[k] = String(v);
    if (on) for (const [k, fn] of Object.entries(on)) el.addEventListener(k, fn as EventListener);
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'number' ? String(c) : c);
  }
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
