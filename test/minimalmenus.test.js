import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Game } from '../src/game.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function menu(tab = 'system', controlsOpen = false, armed = false) {
  const element = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
  const game = Object.assign(Object.create(Game.prototype), {
    el: { menu: element }, menuTab: tab, controlsOpen, sel: 0, systemSel: 0,
    missions: [{ title: 'Fixture job', id: 'fixture', reward: 75, gold: 60, desc: 'The optional job briefing.' }],
    save: { best: {}, rec: {}, camps: [], traps: [], done: [], cash: 0 },
    bounties: { today: () => [] }, tricks: { total: 0 }, unlocked: () => true,
    hasProgress: () => armed, newGameArmed: () => armed, getQualityLabel: () => 'Auto',
  });
  game.renderMenu(); return { game, html: element.innerHTML };
}

test('the title contains only its wordmark and short actions', () => {
  const title = html.slice(html.indexOf('<div id="start"'), html.indexOf('<div id="menu"'));
  assert.doesNotMatch(title, /<p|action-detail|title-foot|kicker|deck|meta|controls/);
  assert.match(title, />Play</); assert.match(title, />Jobs</); assert.match(title, />Graphics</);
  assert.deepEqual([...title.matchAll(/data-title-action="([^"]+)"/g)].map(m => m[1]), ['continue', 'jobs', 'new', 'graphics']);
  assert.ok(html.indexOf('/src/menu-screen.css') > html.indexOf('</style>'));
});

test('loading keeps accessible progress and retry without visible captions, stage copy or percentages', () => {
  const loading = html.slice(html.indexOf('<div id="loading"'), html.indexOf('<div id="start"'));
  assert.doesNotMatch(loading, /loading-story|loading-scene-meta|loadpct|loadchapter|loadnote/);
  assert.match(loading, /id="loadtext" class="screen-reader-only"/);
  assert.match(loading, /role="progressbar"/); assert.match(loading, /id="loadRetry" type="button" hidden/);
  const script = readFileSync(new URL('../src/loading-screen.js', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /offsetWidth|loadchapter|loaddistrict|loadpct/);
  assert.match(script, /retry.hidden = false/); assert.match(script, /window.location.reload\(\)/);
});

test('pause opens with short actions and no controls paragraph', () => {
  const result = menu();
  assert.doesNotMatch(result.html, /controls-panel|menu-copy|rail-status|<small>|Tower radio|rendering budget/);
  const words = result.html.replace(/<[^>]+>/g, ' ').trim().split(/\s+/);
  assert.ok(words.length < 20);
  assert.match(result.html, /data-action="controls" aria-expanded="false"/);
});

test('both input modes remain available through the explicit Controls action', () => {
  const result = menu('system', true);
  assert.match(result.html, /controls-panel/); assert.match(result.html, /aria-expanded="true"/);
  assert.match(result.html, /RT \/ LT/); assert.match(result.html, /W \/ S/); assert.match(result.html, /A \/ Cross/);
});

test('job briefings are behind a collapsed disclosure and new-game confirmation stays explicit', () => {
  const jobs = menu('jobs').html;
  assert.match(jobs, /<details class="menu-extra"><summary>Details<\/summary>/);
  assert.doesNotMatch(jobs, /<details[^>]*\bopen\b|class="d"|Bankroll|Work the water/);
  assert.match(jobs, /data-brief>The optional job briefing/);
  assert.match(jobs, /data-brief-goal >Gold 1:00.0/);
  const armed = menu('system', false, true).html;
  assert.match(armed, /Delete save\?/); assert.match(armed, /Jobs, cash and progress/);
});

test('Tab remains native focus navigation inside the pause menu', () => {
  let prevented = 0;
  const game = { playing: true, menuOpen: true, resultOpen: false, menuTab: 'system' };
  Game.prototype.onKey.call(game, { code: 'Tab', preventDefault() { prevented++; } });
  assert.equal(prevented, 0); assert.equal(game.menuTab, 'system');
});

test('world and statistics logs open as collapsed categories rather than text panels', () => {
  for (const tab of ['world', 'records']) {
    const result = menu(tab).html;
    assert.match(result, /<details class="menu-extra menu-log/);
    assert.doesNotMatch(result, /<details[^>]*\bopen\b|<section class="menu-card|menu-copy|Water remembers/);
  }
});

test('directional job navigation reaches Details and wraps back to the job list', () => {
  let detailFocus = 0, renders = 0;
  const summary = { focus() { detailFocus++; } };
  const game = { missions: [{}, {}], sel: 1, unlocked: () => true,
    el: { menu: { querySelector: () => summary, focus() {} } }, renderMenu() { renders++; } };
  Game.prototype.moveJobSelection.call(game, 1, {});
  assert.equal(detailFocus, 1); assert.equal(game.sel, 1);
  Game.prototype.moveJobSelection.call(game, 1, summary);
  assert.equal(game.sel, 0); assert.equal(renders, 1);
});

test('title navigation supports pointer and arrow selection without steering the boat', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(source, /startEl.addEventListener\('pointerover'/);
  assert.match(source, /keys\[event.code\] = false;\s+moveTitleFocus/);
  const css = readFileSync(new URL('../src/menu-screen.css', import.meta.url), 'utf8');
  assert.match(css, /#start \.title-action:focus \{/);
  assert.doesNotMatch(css, /:has\(\.title-action:hover\)/);
});

test('long menu details stay in a bounded scroll area instead of covering navigation', () => {
  const css = readFileSync(new URL('../src/menu-screen.css', import.meta.url), 'utf8');
  assert.match(css, /align-items:stretch; justify-items:stretch/);
  assert.match(css, /\.menu-stage \{ grid-row:2; min-height:0; box-sizing:border-box/);
});
