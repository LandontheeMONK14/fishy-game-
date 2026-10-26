import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameInput } from '../src/input';

class Element extends EventTarget {
  dataset: Record<string, string> = {};
  captures = new Set<number>();
  closest() { return null; }
  setPointerCapture(id: number) { this.captures.add(id); }
  hasPointerCapture(id: number) { return this.captures.has(id); }
  releasePointerCapture(id: number) { this.captures.delete(id); }
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
    pause: vi.fn(), camera: vi.fn(), interact: vi.fn(), intent: vi.fn(), phase: () => phase, blocked: () => blocked,
  };
  const canvas = new Element();
  const input = new GameInput(canvas as unknown as HTMLCanvasElement, actions);
  const key = (type: string, code: string, target?: Element) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, { code: { value: code }, repeat: { value: false } });
    if (target) Object.defineProperty(event, 'target', { value: target });
    window.dispatchEvent(event);
  };
  const pointer = (target: EventTarget, type: string, id: number, element?: Element, x = 0) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, {
      pointerId: { value: id }, button: { value: 0 },
      clientX: { value: x }, clientY: { value: 0 },
      ...(element ? { target: { value: element } } : {}),
    });
    target.dispatchEvent(event);
  };
  return { input, actions, key, pointer, canvas, window, document, phase: (value: typeof phase) => { phase = value; }, block: () => { blocked = true; } };
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

  it('clears held movement and charge on blur without casting', () => {
    const { input, actions, key, window } = setup();
    key('keydown', 'KeyW'); key('keydown', 'Space');
    window.dispatchEvent(new Event('blur'));
    key('keyup', 'Space');
    expect(input.controls.move).toBe(0);
    expect(actions.release).not.toHaveBeenCalled();
    input.dispose();
  });

  it('makes E an intentional interaction and guards it while typing', () => {
    const { input, actions, key } = setup();
    key('keydown', 'KeyE');
    expect(actions.interact).toHaveBeenCalledOnce();
    const field = new Element();
    field.closest = () => field as never;
    key('keydown', 'KeyE', field);
    expect(actions.interact).toHaveBeenCalledOnce();
    input.dispose();
  });

  it('rearms only fresh intentional input, never keyup or blocked shortcuts', () => {
    const { input, actions, key, block } = setup();
    key('keydown', 'KeyW');
    expect(actions.intent).toHaveBeenCalledOnce();
    input.clear();
    key('keyup', 'KeyW');
    expect(actions.intent).toHaveBeenCalledOnce();
    key('keydown', 'KeyD');
    expect(actions.intent).toHaveBeenCalledTimes(2);
    block();
    key('keydown', 'Space');
    expect(actions.intent).toHaveBeenCalledTimes(2);
    input.dispose();
  });

  it('does not replace or release the active look pointer with a second finger', () => {
    const { input, actions, pointer, canvas } = setup();
    pointer(canvas, 'pointerdown', 1);
    pointer(canvas, 'pointerdown', 2);
    pointer(canvas, 'pointerup', 2);
    pointer(canvas, 'pointermove', 1, undefined, 30);
    expect(actions.orbit).toHaveBeenCalledOnce();
    expect(actions.aim).toHaveBeenCalledOnce();
    pointer(canvas, 'pointercancel', 1);
    pointer(canvas, 'pointermove', 1, undefined, 50);
    expect(actions.orbit).toHaveBeenCalledOnce();
    expect(canvas.captures.size).toBe(0);
    input.dispose();
  });

  it('releases touch captures on cancellation without accidentally casting', () => {
    const { input, actions, pointer, document } = setup();
    const cast = new Element();
    cast.dataset.control = 'action';
    cast.closest = () => cast as never;
    pointer(document, 'pointerdown', 7, cast);
    expect(actions.charge).toHaveBeenCalledOnce();
    expect(cast.captures.has(7)).toBe(true);
    pointer(document, 'pointercancel', 7, cast);
    expect(actions.release).not.toHaveBeenCalled();
    expect(input.controls.reel).toBe(false);
    expect(cast.captures.size).toBe(0);
    input.dispose();
  });

  it('stops touch movement when pointer capture is lost', () => {
    const { input, pointer, document } = setup();
    const forward = new Element();
    forward.dataset.control = 'forward';
    forward.closest = () => forward as never;
    pointer(document, 'pointerdown', 8, forward);
    expect(input.controls.move).toBe(1);
    pointer(document, 'lostpointercapture', 8, forward);
    expect(input.controls.move).toBe(0);
    input.dispose();
  });
});
