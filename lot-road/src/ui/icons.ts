/** Original two-color icons. Not traced from any other game. */

const ink = "#1C1915";

function svg(body: string): string {
  return `<svg viewBox="0 0 28 28" width="28" height="28" aria-hidden="true">${body}</svg>`;
}

export const icons: Record<string, string> = {
  coin: svg(`<circle cx="14" cy="14" r="10" fill="#E6B325"/><circle cx="14" cy="14" r="6" fill="none" stroke="${ink}" stroke-width="1.6"/>`),
  reed: svg(`<path d="M8 22c2-8 3-12 6-16" fill="none" stroke="#3E6B24" stroke-width="2.4" stroke-linecap="round"/><path d="M14 22c1-7 2-10 5-14" fill="none" stroke="#6E9440" stroke-width="2.4" stroke-linecap="round"/><path d="M11 22c0-6 1-9 2-12" fill="none" stroke="#2F5518" stroke-width="2" stroke-linecap="round"/>`),
  clay: svg(`<ellipse cx="14" cy="18" rx="9" ry="5" fill="#D08A5A"/><circle cx="11" cy="14" r="4" fill="#E0A070"/><circle cx="16" cy="13" r="3.2" fill="#C47848"/>`),
  mat: svg(`<rect x="5" y="8" width="18" height="12" rx="2" fill="#E6D2A8" stroke="#8A4E2A" stroke-width="1.6"/><path d="M5 12h18M5 16h18M11 8v12M17 8v12" stroke="#C47A4A" stroke-width="1"/>`),
  crock: svg(`<path d="M9 12h10l-1 10H10L9 12z" fill="#F2E2C4" stroke="${ink}" stroke-width="1.4"/><rect x="8" y="9" width="12" height="3" rx="1" fill="#E7D3B0" stroke="${ink}" stroke-width="1.2"/>`),
  scrub: svg(`<circle cx="10" cy="16" r="4" fill="#8FB456"/><circle cx="16" cy="14" r="5" fill="#6E9440"/><path d="M14 18v6" stroke="#8C5A32" stroke-width="1.6"/>`),
  stone: svg(`<path d="M6 18l4-8 6-2 6 5-2 7H8z" fill="#D9D2C8" stroke="${ink}" stroke-width="1.3"/>`),
  brick: svg(`<rect x="5" y="8" width="18" height="6" fill="#A33B24"/><rect x="7" y="15" width="16" height="6" fill="#C45A40"/>`),
  salt: svg(`<path d="M8 20l6-12 6 12z" fill="#F7F4EC" stroke="${ink}" stroke-width="1.2"/><circle cx="14" cy="16" r="1" fill="${ink}"/>`),
  kelp: svg(`<path d="M14 24c0-8 6-10 4-16" fill="none" stroke="#2E7D4F" stroke-width="2.4" stroke-linecap="round"/><path d="M12 24c-2-6-6-8-4-14" fill="none" stroke="#3E9A62" stroke-width="2" stroke-linecap="round"/>`),
  crate: svg(`<rect x="6" y="8" width="16" height="13" fill="#E6C56A" stroke="${ink}" stroke-width="1.4"/><path d="M6 14h16M14 8v13" stroke="${ink}" stroke-width="1.2"/>`),
  fruit: svg(`<circle cx="14" cy="16" r="7" fill="#E07A8A"/><path d="M14 9c1-3 4-3 4-1" fill="none" stroke="#2E7D4F" stroke-width="1.5"/>`),
  nectar: svg(`<path d="M14 5c4 6 6 8 6 12a6 6 0 1 1-12 0c0-4 2-6 6-12z" fill="#F2B134"/>`),
  jar: svg(`<rect x="10" y="6" width="8" height="3" rx="1" fill="#E7D3B0"/><path d="M9 11h10l-1 11H10L9 11z" fill="#E07A3D" stroke="${ink}" stroke-width="1.2"/>`),
  lantern: svg(`<rect x="10" y="4" width="8" height="2" fill="${ink}"/><path d="M9 8h10l-1 12H10L9 8z" fill="#F2B134" stroke="${ink}" stroke-width="1.2"/>`),
};

export function icon(name: string): string {
  return icons[name] ?? icons.coin;
}
