/**
 * Settings popup (also the options page). Every control saves itself on
 * change; open Facebook tabs pick the change up from storage at once.
 */
import { h, t } from '../shared/dom';
import { settings, type RailMode, type Settings } from '../shared/settings';

const FACEBOOK = /^https:\/\/(www|web)\.facebook\.com\//;

function preview(): HTMLElement {
  const lines = (n: number) => Array.from({ length: n }, () => h('div', { class: 'line' }));
  return h('div', { class: 'preview', 'aria-hidden': 'true' },
    h('div', { class: 'bar' }),
    h('div', { class: 'col' }, ...lines(5)),
    h('div', { class: 'col' }, h('div', { class: 'feed', style: 'height:22px' }), h('div', { class: 'feed' })),
    h('div', { class: 'col' }, h('div', { class: 'item' }), h('div', { class: 'dock' }, h('span'), h('span'), h('span'))),
  );
}

function switchRow(id: keyof Settings, title: string, desc: string): [HTMLElement, HTMLInputElement] {
  const input = h('input', { type: 'checkbox', class: 'switch', id, role: 'switch', 'aria-describedby': `${id}-desc` });
  const row = h('div', { class: 'row' },
    h('div', { class: 'text' }, h('label', { for: id }, title), h('p', { class: 'desc', id: `${id}-desc` }, desc)),
    input,
  );
  return [row, input];
}

function placement(): [HTMLFieldSetElement, Record<RailMode, HTMLInputElement>] {
  const option = (value: RailMode, label: string) => {
    const input = h('input', { type: 'radio', name: 'railMode', value });
    return [h('label', {}, input, h('span', {}, label)), input] as const;
  };
  const [below, belowInput] = option('below', t('placeBelow'));
  const [full, fullInput] = option('full', t('placeFull'));
  const fieldset = h('fieldset', {},
    h('legend', { class: 'legend' }, t('placement')),
    h('div', { class: 'segmented' }, below, full),
  );
  return [fieldset, { below: belowInput, full: fullInput }];
}

async function currentTabIsFacebook(): Promise<boolean> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return FACEBOOK.test(tab?.url ?? '');
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  document.title = t('extShortName');

  const view = preview();
  const [enabledRow, enabled] = switchRow('enabled', t('showPanel'), t('showPanelDesc'));
  const [place, modes] = placement();
  const [compactRow, compact] = switchRow('compact', t('compact'), t('compactDesc'));
  const [onlineOnlyRow, onlineOnly] = switchRow('onlineOnly', t('onlyActive'), t('onlyActiveDesc'));
  const [pauseRow, pauseHidden] = switchRow('pauseHidden', t('pauseHidden'), t('pauseHiddenDesc'));
  const [hubRow, hub] = switchRow('hub', t('hub'), t('hubDesc'));

  const statusText = h('p', {});
  const openButton = h('button', { class: 'action', type: 'button', hidden: true }, t('openFacebook'));
  openButton.addEventListener('click', () => {
    void chrome.tabs.create({ url: 'https://www.facebook.com/' });
    close();
  });

  document.getElementById('app')!.append(
    h('header', { class: 'brand' },
      h('img', { src: 'icons/48.png', alt: '' }),
      h('div', {}, h('h1', {}, t('extShortName')), h('p', {}, t('tagline'))),
    ),
    view,
    h('div', { class: 'group' }, enabledRow, place, compactRow, onlineOnlyRow, pauseRow, hubRow),
    h('div', { class: 'status' }, statusText, openButton),
    h('p', { class: 'tip' }, t('tipEsc')),
  );

  const render = (s: Settings) => {
    enabled.checked = s.enabled;
    compact.checked = s.compact;
    onlineOnly.checked = s.onlineOnly;
    pauseHidden.checked = s.pauseHidden;
    hub.checked = s.hub;
    modes[s.railMode].checked = true;
    place.disabled = !s.enabled;
    compact.disabled = !s.enabled;
    onlineOnly.disabled = !s.enabled;
    pauseHidden.disabled = !s.enabled;
    view.dataset.mode = s.railMode;
    view.dataset.enabled = String(s.enabled);
  };

  enabled.addEventListener('change', () => void settings.set({ enabled: enabled.checked }));
  compact.addEventListener('change', () => void settings.set({ compact: compact.checked }));
  onlineOnly.addEventListener('change', () => void settings.set({ onlineOnly: onlineOnly.checked }));
  pauseHidden.addEventListener('change', () => void settings.set({ pauseHidden: pauseHidden.checked }));
  hub.addEventListener('change', () => void settings.set({ hub: hub.checked }));
  for (const [mode, input] of Object.entries(modes) as [RailMode, HTMLInputElement][]) {
    input.addEventListener('change', () => input.checked && void settings.set({ railMode: mode }));
  }

  settings.subscribe(render);
  render(await settings.get());

  const onFacebook = await currentTabIsFacebook();
  statusText.textContent = t(onFacebook ? 'statusActive' : 'statusIdle');
  openButton.hidden = onFacebook;

  const report = (await chrome.storage.local.get('deleteDiagnostic')).deleteDiagnostic;
  if (report) {
    const output = h('textarea', { readonly: true, rows: 7, class: 'diagnostic', 'aria-label': t('deleteDiagnostic') });
    output.value = JSON.stringify(report, null, 2);
    output.addEventListener('focus', () => output.select());
    document.getElementById('app')!.append(h('details', { class: 'tip' },
      h('summary', {}, t('deleteDiagnostic')), output,
    ));
  }
}

void main();
