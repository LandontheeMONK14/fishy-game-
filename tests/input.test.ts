import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameInput } from '../src/input';

class Element extends EventTarget {
  dataset: Record<string, string> = {};
  closest() { return null; }
  hasPointerCapture() { return false; }
  releasePointerCapture() {}
}

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const window = new EventTarget();
  const document = new EventTarget();
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('HTMLElement', Element);
  let phase: 'aim' | 'charge' | 'fight' | 'bite' = 'aim';
  let blocked = false;
  const actions = {
    charge: vi.fn(() => { phase = 'charge'; }),
    release: vi.fn(), action: vi.fn(), cancel: vi.fn(),
    orbit: vi.fn(), aim: vi.fn(), course: vi.fn(), pick: vi.fn(() => null),
    pause: vi.fn(), camera: vi.fn(), phase: () => phase, blocked: () => blocked,
  };
  const input = new GameInput(new Element() as unknown as HTMLCanvasElement, actions);
  const key = (type: string, code: string, target?: Element) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, { code: { value: code }, repeat: { value: false } });
    if (target) Object.defineProperty(event, 'target', { value: target });
    window.dispatchEvent(event);
  };
  return { input, actions, key, phase: (value: typeof phase) => { phase = value; }, block: () => { blocked = true; } };
}

describe('input lifecycle', () => {
  it('charges only on initial intentional keydown and releases on keyup', () => {
    const { input, actions, key } = setup();
    key('keydown', 'Space');
    expect(actions.charge).toHaveBeenCalledOnce();
    key('keyup', 'Space');
    expect(actions.release).toHaveBeenCalledOnce();
    expect(input.controls.reel).toBe(false);
    input.dispose();
  });

  it('cancels a charge and clears movement without casting on a later release', () => {
    const { input, actions, key } = setup();
    key('keydown', 'KeyW'); key('keydown', 'Space');
    expect(input.controls.move).toBe(1);
    input.clear(); key('keyup', 'Space');
    expect(actions.release).not.toHaveBeenCalled();
    expect(actions.cancel).toHaveBeenCalledOnce();
    expect(input.controls.move).toBe(0);
    expect(input.controls.reel).toBe(false);
    input.dispose();
  });

  it('does not process game shortcuts from buttons or typing controls', () => {
    const { input, actions, key } = setup();
    const button = new Element();
    button.closest = () => button as never;
    key('keydown', 'Space', button);
    key('keydown', 'KeyW', button);
    expect(actions.charge).not.toHaveBeenCalled();
    expect(input.controls.move).toBe(0);
    input.dispose();
  });

  it('blocks paused input and prevents a held hook from continuing after transition clear', () => {
    const { input, actions, key, phase, block } = setup();
    phase('bite'); key('keydown', 'Space');
    expect(actions.action).toHaveBeenCalledOnce();
    phase('fight'); input.clear();
    expect(input.controls.reel).toBe(false);
    block(); key('keydown', 'Space'); key('keydown', 'KeyD');
    expect(input.controls.reel).toBe(false);
    expect(input.controls.steer).toBe(0);
    input.dispose();
  });

  it('removes listeners when disposed', () => {
    const { input, actions, key } = setup();
    input.dispose(); key('keydown', 'Space');
    expect(actions.charge).not.toHaveBeenCalled();
  });
});
