import assert from 'node:assert/strict';
import test from 'node:test';
import { layout, GAP } from '../src/content/layout';
import { isMediaViewerPath, type RailGeometry } from '../src/content/rail';

const rail: RailGeometry = { left: 1080, right: 1380, top: 60, contentBottom: 200 };
const settings = { railMode: 'below', wide: false, view: 'contacts' } as const;

test('a native chat covering the column reserves space, including when under 320px remains', () => {
  const chat = { left: 1070, right: 1400, top: 300, bottom: 900 };
  const box = layout({ ...rail, chatWindows: [chat] }, settings, 900)!;
  assert.equal(box.top, 72);
  assert.equal(box.top + box.height, chat.top - GAP);
  assert.ok(box.height > 44 && box.height < 320);
});

test('left-side chats do not shorten the column, and closing all chats restores the height', () => {
  const original = layout(rail, settings, 900);
  assert.deepEqual(layout({ ...rail, chatWindows: [{ left: 600, right: 950, top: 300, bottom: 900 }] }, settings, 900), original);
  assert.deepEqual(layout({ ...rail, chatWindows: [] }, settings, 900), original);
});

test('the highest overlapping chat wins and a tiny viewport never overlaps it', () => {
  const chatWindows = [{ left: 1070, right: 1400, top: 480, bottom: 900 },
    { left: 1070, right: 1400, top: 420, bottom: 900 }];
  const box = layout({ ...rail, chatWindows }, settings, 900)!;
  assert.equal(box.top + box.height, 408);
  assert.equal(layout({ ...rail, chatWindows: [{ ...chatWindows[0]!, top: 100 }] }, settings, 900), null);
});

test('media viewer routes never host the panel; feeds and profiles still do', () => {
  for (const path of ['/photo/', '/photo', '/someone/photos/a.1/2/', '/someone/videos/123/', '/reel/456', '/stories/789/', '/watch/live/']) {
    assert.equal(isMediaViewerPath(path), true, path);
  }
  for (const path of ['/', '/groups/feed/', '/someone', '/someone/posts/123', '/photographer.page', '/watch/']) {
    assert.equal(isMediaViewerPath(path), false, path);
  }
});
