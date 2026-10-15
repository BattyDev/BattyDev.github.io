// The fan-content notice, shown on every page. One copy, so it can't drift.
//
// CD PROJEKT RED's Fan Content Guidelines (cdprojektred.com/en/fan-content)
// allow fan sites so long as nothing is sold or paywalled and nothing implies
// an official partnership. No mandated wording could be confirmed when this
// was written; if the guidelines gain one, put it in NOTICE_TEXT.

import { h } from './dom';

export const GUIDELINES_URL = 'https://www.cdprojektred.com/en/fan-content';

export const NOTICE_TEXT =
  'Batty Gwent is unofficial fan content, made for free and not for profit. It is not approved, endorsed or sponsored by CD PROJEKT RED. ' +
  'The Witcher, Gwent and related names, logos, card art and icons are trademarks or copyrighted material of CD PROJEKT S.A., used under the ';

/** The notice as a paragraph, with a link to the guidelines. */
export function fanNotice(): HTMLElement {
  return h(
    'p',
    { class: 'fan-notice' },
    NOTICE_TEXT,
    h('a', { href: GUIDELINES_URL, rel: 'noopener' }, 'CD PROJEKT RED Fan Content Guidelines'),
    '. Nothing here is sold and there are no ads.',
  );
}

/** Footer for the menu and other full pages. */
export function siteFooter(): HTMLElement {
  return h(
    'footer',
    { class: 'menu-foot' },
    fanNotice(),
    h('p', null, h('a', { href: '#/about' }, 'About this simulator'), ' · ', h('a', { href: '../' }, 'battydev.com')),
  );
}
