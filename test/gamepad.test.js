import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GAMEPAD_BUTTON, StandardGamepadInput, gamepadActionCode, gamepadAxis, gamepadBoatInput, gamepadButtonValue, readStandardGamepad } from '../src/gamepad.js';

const button = (value = 0) => ({ value, pressed: value > 0.5 });
const pad = (overrides = {}) => ({
  connected: true, mapping: 'standard', index: 0, id: 'Test Controller',
  axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => button()),
  ...overrides,
});

test('controller axes use a rescaled deadzone and triggers stay analogue', () => {
  assert.equal(gamepadAxis(0.1, 0.15), 0);
  assert.equal(gamepadAxis(-0.15, 0.15), 0);
  assert.ok(Math.abs(gamepadAxis(0.575, 0.15) - 0.5) < 1e-12);
  assert.equal(gamepadAxis(-1, 0.15), -1);
  assert.equal(gamepadButtonValue({ value: 0.42, pressed: false }), 0.42);
  assert.equal(gamepadButtonValue({ pressed: true }), 1);
  assert.equal(gamepadButtonValue({ value: 0, pressed: true }), 1);
});

test('standard controller sampling reuses the caller state record', () => {
  const source = pad({ axes: [0.575, -0.59, 0.585, -0.585] });
  source.buttons[GAMEPAD_BUTTON.LEFT_TRIGGER] = button(0.35);
  source.buttons[GAMEPAD_BUTTON.RIGHT_TRIGGER] = button(0.82);
  const state = {};
  assert.equal(readStandardGamepad(source, state), state);
  assert.deepEqual(
    { connected: state.connected, index: state.index, id: state.id, reverse: state.reverse, throttle: state.throttle },
    { connected: true, index: 0, id: 'Test Controller', reverse: 0.35, throttle: 0.82 },
  );
  assert.ok(state.steer > 0.49 && state.steer < 0.51);
  assert.ok(state.pitch < -0.49 && state.pitch > -0.51);
  assert.equal(readStandardGamepad(null, state), state);
  assert.deepEqual(state, { connected: false, index: -1, id: '', steer: 0, pitch: 0, lookX: 0, lookY: 0, reverse: 0, throttle: 0 });
});

test('analogue boat controls preserve the airboat reverse range and contextual face buttons', () => {
  const output = {};
  assert.equal(gamepadBoatInput({ throttle: 0.8, reverse: 0.2, steer: 0.45, pitch: -0.6 }, output), output);
  assert.deepEqual(output, { throttle: 0.8, steer: -0.45, pitch: -0.6 });
  gamepadBoatInput({ throttle: 0.1, reverse: 0.7, steer: -1, pitch: 1 }, output);
  assert.ok(Math.abs(output.throttle + 0.245) < 1e-12); assert.equal(output.steer, 1); assert.equal(output.pitch, 1);
  assert.equal(gamepadActionCode(GAMEPAD_BUTTON.SOUTH, { overlay: false }), 'KeyE');
  assert.equal(gamepadActionCode(GAMEPAD_BUTTON.SOUTH, { overlay: true }), 'Enter');
  assert.equal(gamepadActionCode(GAMEPAD_BUTTON.EAST, { fishing: true }), 'KeyX');
  assert.equal(gamepadActionCode(GAMEPAD_BUTTON.EAST, { fishing: false }), 'KeyF');
  assert.equal(gamepadActionCode(GAMEPAD_BUTTON.EAST, { overlay: true }), 'Escape');
  assert.equal(gamepadActionCode(GAMEPAD_BUTTON.NORTH, { result: true }), 'KeyR');
  assert.equal(gamepadActionCode(GAMEPAD_BUTTON.NORTH, { result: false }), 'KeyG');
  assert.equal(gamepadActionCode(GAMEPAD_BUTTON.MENU), 'Escape');
  assert.equal(gamepadActionCode(GAMEPAD_BUTTON.DPAD_UP, { overlay: false }), 'KeyM');
  assert.equal(gamepadActionCode(GAMEPAD_BUTTON.DPAD_UP, { overlay: true }), 'ArrowUp');
  assert.equal(gamepadActionCode(GAMEPAD_BUTTON.DPAD_LEFT, { overlay: false }), '');
  assert.equal(gamepadActionCode(GAMEPAD_BUTTON.DPAD_LEFT, { overlay: true }), 'ArrowLeft');
  assert.equal(gamepadActionCode(GAMEPAD_BUTTON.RIGHT_STICK), '');
});

test('button edges publish once and a disconnect releases held actions', () => {
  const source = pad(), slots = [source], events = [];
  const input = new StandardGamepadInput({
    getGamepads: () => slots,
    onButtonDown: index => events.push(`down:${index}`),
    onButtonUp: index => events.push(`up:${index}`),
    onConnect: state => events.push(`connect:${state.index}`),
    onDisconnect: state => events.push(`disconnect:${state.index}`),
  });
  const retained = input.state;
  assert.equal(input.poll(), retained);
  source.buttons[GAMEPAD_BUTTON.WEST] = button(1); input.poll(); input.poll();
  source.buttons[GAMEPAD_BUTTON.WEST] = button(0); input.poll();
  source.buttons[GAMEPAD_BUTTON.RIGHT_BUMPER] = button(1); input.poll();
  slots[0] = null; input.poll();
  assert.deepEqual(events, ['connect:0', 'down:2', 'up:2', 'down:5', 'up:5', 'disconnect:0']);
  assert.equal(input.state.connected, false); assert.equal(input.buttons[GAMEPAD_BUTTON.RIGHT_BUMPER], 0);
});

test('controller use is reported for analogue motion and haptics stay bounded', () => {
  const effects = [], source = pad({
    axes: [0.8, 0, 0, 0],
    vibrationActuator: { playEffect(type, options) { effects.push([type, options]); return Promise.resolve('complete'); } },
  });
  let uses = 0;
  const input = new StandardGamepadInput({ getGamepads: () => [source], onUse: () => { uses++; } });
  input.poll(); input.poll();
  assert.equal(uses, 2);
  assert.equal(input.rumble(0.8, 0.3, 140, 100), true);
  assert.equal(input.rumble(1, 1, 140, 130), false);
  assert.equal(input.rumble(2, -1, 900, 180), true);
  assert.deepEqual(effects, [
    ['dual-rumble', { startDelay: 0, duration: 140, strongMagnitude: 0.8, weakMagnitude: 0.3 }],
    ['dual-rumble', { startDelay: 0, duration: 500, strongMagnitude: 1, weakMagnitude: 0 }],
  ]);
  assert.equal(input.snapshot().haptics, 2);
});

test('the live loop polls one retained controller and ships prompts for both input modes', () => {
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const game = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');
  const construction = main.indexOf('controller = new StandardGamepadInput('), frameStart = main.indexOf('  function frame() {'), frameEnd = main.indexOf('  const hibernatePage =', frameStart);
  assert.ok(construction >= 0 && construction < frameStart && frameEnd > frameStart);
  const frame = main.slice(frameStart, frameEnd);
  assert.match(frame, /controller\.poll\(\)/); assert.match(frame, /gamepadBoatInput\(controllerState, controllerBoatInput\)/);
  assert.doesNotMatch(frame, /new StandardGamepadInput|new Array\(/);
  assert.match(frame, /controller\.rumble\(/);
  assert.match(index, /data-input="gamepad"/); assert.match(index, /A \/ Cross/); assert.match(game, /D-pad ↑ ↓/);
});
