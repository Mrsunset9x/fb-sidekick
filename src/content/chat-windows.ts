/** Geometry of Facebook's native bottom-docked chat windows; no message content is read. */
export interface ChatBox { left: number; right: number; top: number; bottom: number }
export interface ChatWindow { element: HTMLElement; box: ChatBox }

export function findChatWindows(): ChatWindow[] {
  const windows = new Map<HTMLElement, ChatBox>();
  for (const log of document.querySelectorAll<HTMLElement>('[role="log"]')) {
    const logBox = log.getBoundingClientRect();
    if (!logBox.width || !logBox.height || getComputedStyle(log).visibility !== 'visible') continue;
    let candidate: ChatWindow | null = null;
    let fixed = false;
    for (let el = log.parentElement; el && el !== document.body; el = el.parentElement) {
      const style = getComputedStyle(el);
      if (style.position === 'fixed') fixed = true;
      const box = el.getBoundingClientRect();
      // The complete chat contains its transcript and composer. Its shared fixed dock can
      // span the page, so retain the narrower window while looking upward for that dock.
      if (box.width >= 220 && box.width <= 600 && box.height >= 160 && box.top >= 56 &&
          box.bottom >= innerHeight - 24 && box.bottom <= innerHeight + 24 && style.visibility === 'visible') {
        candidate = { element: el, box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom } };
      }
    }
    if (fixed && candidate) windows.set(candidate.element, candidate.box);
  }
  return [...windows].map(([element, box]) => ({ element, box }));
}
