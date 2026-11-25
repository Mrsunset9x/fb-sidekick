/** A tiny element builder. No framework: the extension has two small views. */
import { extensionValue } from './runtime';

type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') el.addEventListener(name.replace(/^on/, ''), value);
    else el.setAttribute(name, value === true ? '' : String(value));
  }
  el.append(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false));
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * A 16px outline icon from path data. Built with createElementNS rather than
 * innerHTML so it works on pages that enforce Trusted Types.
 */
export function icon(paths: readonly string[], size = 16): SVGSVGElement {
  const root = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  })) root.setAttribute(k, String(v));
  for (const d of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    root.append(path);
  }
  return root;
}

/** One outline icon set, drawn on a 16px grid. */
export const ICONS = {
  widen: ['M6 3H3v10h3', 'M10 8H14', 'M12 6l2 2-2 2'],
  narrow: ['M6 3H3v10h3', 'M14 8H9', 'M11 6L9 8l2 2'],
  reload: ['M13 8a5 5 0 1 1-1.5-3.6', 'M13 3v2.5h-2.5'],
  external: ['M9 3h4v4', 'M13 3L7.5 8.5', 'M11 9.5V13H3V5h3.5'],
  fold: ['M4 10l4-4 4 4'],
  unfold: ['M4 6l4 4 4-4'],
  back: ['M10 3.5L5.5 8l4.5 4.5'],
  search: ['M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10z', 'M10.6 10.6L14 14'],
  pin: ['M9.5 2.5l4 4-2.5 1-1.5 3.5-1.25 1.25-4.5-4.5L5 6.5 8.5 5z', 'M6 10l-3.5 3.5'],
  unchecked: ['M4 2.5h8A1.5 1.5 0 0 1 13.5 4v8a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5z'],
  checked: ['M4 2.5h8A1.5 1.5 0 0 1 13.5 4v8a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V4A1.5 1.5 0 0 1 4 2.5z', 'M5 8l2 2 4-4'],
  hide: ['M2 2l12 12', 'M6.4 3.8A7.4 7.4 0 0 1 14 8c-.6 1-1.2 1.7-2 2.3', 'M9.6 12.2A7.4 7.4 0 0 1 2 8c.6-1 1.2-1.7 2-2.3'],
  trash: ['M2.5 4.5h11', 'M6 4.5V2.75h4V4.5', 'M4 4.5l.65 8a1 1 0 0 0 1 .9h4.7a1 1 0 0 0 1-.9l.65-8', 'M7 7v3.5m2-3.5v3.5'],
  more: [
    'M2.25 8a.75.75 0 1 0 1.5 0a.75.75 0 1 0-1.5 0',
    'M7.25 8a.75.75 0 1 0 1.5 0a.75.75 0 1 0-1.5 0',
    'M12.25 8a.75.75 0 1 0 1.5 0a.75.75 0 1 0-1.5 0',
  ],
} as const satisfies Record<string, readonly string[]>;

export const t = (key: string, ...subs: string[]): string =>
  extensionValue(() => chrome.i18n.getMessage(key, subs) || key, key);
