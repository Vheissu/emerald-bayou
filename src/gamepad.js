const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, Number(value) || 0));

export const GAMEPAD_BUTTON = Object.freeze({
  SOUTH: 0,
  EAST: 1,
  WEST: 2,
  NORTH: 3,
  LEFT_BUMPER: 4,
  RIGHT_BUMPER: 5,
  LEFT_TRIGGER: 6,
  RIGHT_TRIGGER: 7,
  VIEW: 8,
  MENU: 9,
  LEFT_STICK: 10,
  RIGHT_STICK: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
  HOME: 16,
});

export const STANDARD_GAMEPAD_BUTTONS = 17;

export function gamepadAxis(value, deadzone = 0.16) {
  const axis = Math.max(-1, Math.min(1, Number(value) || 0));
  const threshold = clamp(deadzone, 0, 0.95), magnitude = Math.abs(axis);
  if (magnitude <= threshold) return 0;
  return Math.sign(axis) * (magnitude - threshold) / (1 - threshold);
}

export function gamepadButtonValue(button) {
  if (typeof button === 'number') return clamp(button);
  if (!button) return 0;
  const value = Number(button.value);
  if (Number.isFinite(value) && value > 0) return clamp(value);
  return button.pressed ? 1 : clamp(value);
}

export function gamepadBoatInput(state, out = {}) {
  const forward = clamp(state?.throttle), reverse = clamp(state?.reverse);
  out.throttle = forward >= reverse ? forward : -reverse * 0.35;
  out.steer = Math.max(-1, Math.min(1, -(Number(state?.steer) || 0)));
  out.pitch = Math.max(-1, Math.min(1, Number(state?.pitch) || 0));
  return out;
}

export function gamepadActionCode(index, context = {}) {
  if (index === GAMEPAD_BUTTON.SOUTH) return context.overlay ? 'Enter' : 'KeyE';
  if (index === GAMEPAD_BUTTON.EAST) return context.overlay ? 'Escape' : context.fishing || context.cageFouled ? 'KeyX' : 'KeyF';
  if (index === GAMEPAD_BUTTON.WEST) return 'KeyC';
  if (index === GAMEPAD_BUTTON.NORTH) return context.result ? 'KeyR' : 'KeyG';
  if (index === GAMEPAD_BUTTON.LEFT_BUMPER) return 'KeyL';
  if (index === GAMEPAD_BUTTON.RIGHT_BUMPER) return 'KeyH';
  if (index === GAMEPAD_BUTTON.VIEW) return 'Tab';
  if (index === GAMEPAD_BUTTON.MENU) return 'Escape';
  if (index === GAMEPAD_BUTTON.DPAD_UP) return context.overlay ? 'ArrowUp' : 'KeyM';
  if (index === GAMEPAD_BUTTON.DPAD_DOWN) return context.overlay ? 'ArrowDown' : '';
  if (index === GAMEPAD_BUTTON.DPAD_LEFT) return context.overlay ? 'ArrowLeft' : '';
  if (index === GAMEPAD_BUTTON.DPAD_RIGHT) return context.overlay ? 'ArrowRight' : '';
  return '';
}

export function readStandardGamepad(pad, out = {}) {
  const connected = Boolean(pad?.connected !== false && pad && (pad.mapping === 'standard' || (pad.axes?.length >= 2 && pad.buttons?.length >= 10)));
  out.connected = connected;
  out.index = connected ? Math.max(0, Math.trunc(Number(pad.index) || 0)) : -1;
  out.id = connected ? String(pad.id || 'Gamepad') : '';
  out.steer = connected ? gamepadAxis(pad.axes?.[0], 0.15) : 0;
  out.pitch = connected ? gamepadAxis(pad.axes?.[1], 0.18) : 0;
  out.lookX = connected ? gamepadAxis(pad.axes?.[2], 0.17) : 0;
  out.lookY = connected ? gamepadAxis(pad.axes?.[3], 0.17) : 0;
  out.reverse = connected ? gamepadButtonValue(pad.buttons?.[GAMEPAD_BUTTON.LEFT_TRIGGER]) : 0;
  out.throttle = connected ? gamepadButtonValue(pad.buttons?.[GAMEPAD_BUTTON.RIGHT_TRIGGER]) : 0;
  return out;
}

// The browser owns the Gamepad objects. This adapter keeps one fixed state record and one fixed button array, then
// publishes only edges to the existing keyboard action handlers. No controller object is created in the frame loop.
export class StandardGamepadInput {
  constructor(options = {}) {
    this.getGamepads = options.getGamepads || (() => globalThis.navigator?.getGamepads?.() || []);
    this.onButtonDown = typeof options.onButtonDown === 'function' ? options.onButtonDown : null;
    this.onButtonUp = typeof options.onButtonUp === 'function' ? options.onButtonUp : null;
    this.onConnect = typeof options.onConnect === 'function' ? options.onConnect : null;
    this.onDisconnect = typeof options.onDisconnect === 'function' ? options.onDisconnect : null;
    this.onUse = typeof options.onUse === 'function' ? options.onUse : null;
    this.state = { connected: false, index: -1, id: '', steer: 0, pitch: 0, lookX: 0, lookY: 0, reverse: 0, throttle: 0 };
    this.buttons = new Uint8Array(STANDARD_GAMEPAD_BUTTONS);
    this.pad = null; this.lastRumbleAt = -Infinity; this.polls = 0; this.connectionCount = 0; this.hapticCount = 0;
  }

  findPad(pads) {
    const preferred = this.state.index;
    if (preferred >= 0) {
      const held = pads?.[preferred];
      if (held?.connected !== false && (held?.mapping === 'standard' || (held?.axes?.length >= 2 && held?.buttons?.length >= 10))) return held;
    }
    for (let index = 0; index < (pads?.length || 0); index++) {
      const candidate = pads[index];
      if (candidate?.connected === false || !candidate) continue;
      if (candidate.mapping === 'standard' || (candidate.axes?.length >= 2 && candidate.buttons?.length >= 10)) return candidate;
    }
    return null;
  }

  releaseButtons() {
    for (let index = 0; index < this.buttons.length; index++) {
      if (!this.buttons[index]) continue;
      this.buttons[index] = 0; this.onButtonUp?.(index, this.state);
    }
  }

  poll() {
    this.polls++;
    let pads = null;
    try { pads = this.getGamepads() || []; } catch (error) { pads = []; }
    const wasConnected = this.state.connected, pad = this.findPad(pads);
    if (!pad) {
      if (wasConnected) { this.releaseButtons(); this.onDisconnect?.(this.state); }
      this.pad = null; readStandardGamepad(null, this.state); return this.state;
    }

    this.pad = pad; readStandardGamepad(pad, this.state);
    if (!wasConnected) { this.connectionCount++; this.onConnect?.(this.state); }
    let used = Math.abs(this.state.steer) > 0.04 || Math.abs(this.state.pitch) > 0.04 || Math.abs(this.state.lookX) > 0.04 || Math.abs(this.state.lookY) > 0.04 || this.state.throttle > 0.03 || this.state.reverse > 0.03;
    for (let index = 0; index < this.buttons.length; index++) {
      const pressed = gamepadButtonValue(pad.buttons?.[index]) > 0.5 ? 1 : 0;
      if (pressed === this.buttons[index]) continue;
      this.buttons[index] = pressed;
      if (pressed) { used = true; this.onButtonDown?.(index, this.state); }
      else this.onButtonUp?.(index, this.state);
    }
    if (used) this.onUse?.(this.state);
    return this.state;
  }

  rumble(strong = 0.5, weak = 0.35, duration = 110, now = globalThis.performance?.now?.() || Date.now()) {
    const pad = this.pad, elapsed = Number(now) - this.lastRumbleAt;
    if (!pad || (Number.isFinite(this.lastRumbleAt) && (!Number.isFinite(elapsed) || elapsed < 55))) return false;
    const milliseconds = Math.max(20, Math.min(500, Math.round(Number(duration) || 0)));
    const strongMagnitude = clamp(strong), weakMagnitude = clamp(weak);
    try {
      let result = null;
      if (typeof pad.vibrationActuator?.playEffect === 'function') {
        result = pad.vibrationActuator.playEffect('dual-rumble', { startDelay: 0, duration: milliseconds, strongMagnitude, weakMagnitude });
      } else if (typeof pad.hapticActuators?.[0]?.pulse === 'function') {
        result = pad.hapticActuators[0].pulse(Math.max(strongMagnitude, weakMagnitude), milliseconds);
      } else return false;
      result?.catch?.(() => {}); this.lastRumbleAt = Number(now); this.hapticCount++; return true;
    } catch (error) { return false; }
  }

  snapshot() {
    return {
      ...this.state,
      pressedButtons: Array.from(this.buttons).reduce((count, pressed) => count + pressed, 0),
      polls: this.polls, connections: this.connectionCount, haptics: this.hapticCount,
    };
  }
}
