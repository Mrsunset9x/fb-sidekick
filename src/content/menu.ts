import { h, icon } from '../shared/dom';

export function menuItem(label: string, run: () => void, paths?: readonly string[], checked?: boolean): HTMLButtonElement {
  return h('button', {
    class: 'menu-item', type: 'button', role: checked === undefined ? 'menuitem' : 'menuitemcheckbox',
    'aria-checked': checked === undefined ? undefined : String(checked), tabindex: -1, onclick: run,
  }, paths ? icon(paths) : null, label);
}

export function menuKeys(menu: HTMLElement, close: (restoreFocus: boolean) => void): void {
  menu.addEventListener('keydown', (event) => {
    const items = [...menu.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')];
    const current = items.indexOf(event.target as HTMLButtonElement);
    if (event.key === 'Tab') {
      close(true);
      return;
    }
    if (event.key === 'Escape') {
      event.stopPropagation();
      event.preventDefault();
      close(true);
      return;
    }
    if (!items.length) return;
    const targets: Record<string, number> = {
      ArrowUp: (current - 1 + items.length) % items.length,
      ArrowDown: (current + 1) % items.length,
      Home: 0,
      End: items.length - 1,
    };
    const next = targets[event.key];
    if (next === undefined) return;
    event.preventDefault();
    items[next]?.focus();
  });
}
