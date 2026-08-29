import test from 'node:test';
import assert from 'node:assert/strict';
import { bindPageLifecycle } from '../src/pagelifecycle.js';

test('page lifecycle hibernates on background and pagehide, then resumes on return', () => {
  const doc = new EventTarget(), win = new EventTarget(), calls = [];
  doc.hidden = false;
  const release = bindPageLifecycle({ document: doc, window: win, hibernate: () => calls.push('hibernate'), resume: () => calls.push('resume') });
  assert.deepEqual(calls, ['resume']);

  doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
  win.dispatchEvent(new Event('pagehide'));
  doc.hidden = false; doc.dispatchEvent(new Event('visibilitychange'));
  win.dispatchEvent(new Event('pageshow'));
  assert.deepEqual(calls, ['resume', 'hibernate', 'hibernate', 'resume', 'resume']);

  release();
  doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange'));
  win.dispatchEvent(new Event('pagehide'));
  assert.equal(calls.length, 5);
});

test('page lifecycle is a safe no-op without browser event targets', () => {
  const release = bindPageLifecycle({ document: null, window: null, hibernate() {}, resume() {} });
  assert.equal(typeof release, 'function');
  assert.doesNotThrow(release);
});
