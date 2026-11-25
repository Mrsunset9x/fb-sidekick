/** Where the panel goes, as a pure function of the column and the settings. */
import type { RailGeometry } from './rail';
import type { PanelBox } from './panel';
import type { Settings } from '../shared/settings';

export const GAP = 12;
/**
 * Rows reach 8px past the column's text on each side, as Facebook's own rows
 * do: avatars line up with the avatars above, hover fills bleed past them.
 */
export const BLEED = 8;
/** Below this height the list is too short to use; the panel takes the whole column instead. */
export const MIN_HEIGHT = 320;
export const WIDE_WIDTH = 720;

export function layout(
  rail: RailGeometry | null,
  s: Pick<Settings, 'railMode' | 'wide' | 'view'>,
  viewportHeight: number,
): PanelBox | null {
  if (!rail) return null;

  const right = rail.right + BLEED;
  const narrow = right - (rail.left - BLEED);
  const wide = s.view === 'inbox' && s.wide;
  const width = wide ? Math.max(narrow, Math.min(WIDE_WIDTH, right - GAP)) : narrow;
  const left = right - width;
  const covering = (rail.chatWindows ?? []).filter((chat) => chat.left < right && chat.right > left);
  const bottom = Math.min(viewportHeight - GAP, ...covering.map((chat) => chat.top - GAP));
  const fullTop = rail.top + GAP;
  const belowTop = Math.max(fullTop, rail.contentBottom + GAP);
  let top = s.railMode === 'full' ? fullTop : belowTop;
  if (bottom - top < MIN_HEIGHT) top = fullTop;
  // A minimum list height must never push it underneath an open chat window.
  const height = bottom - top;
  if (height < 44) return null;

  return {
    left,
    top,
    width,
    height,
  };
}
