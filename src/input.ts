import type { Controls, Point, Snapshot } from './contracts';

interface InputActions {
  charge(): void;
  release(): void;
  action(): void;
  cancel(): void;
  orbit(yaw: number, pitch: number): void;
  aim(delta: number): void;
  course(point: Point): void;
  pick(x: number, y: number): Point | null;
  pause(): void;
  camera(): void;
  interact?(): void;
  intent?(): void;
  phase(): Snapshot['phase'];
  blocked(): boolean;
}

export class GameInput {
  readonly controls: Controls = { move: 0, turn: 0, reel: false, slack: false, steer: 0 };
  private keys = new Set<string>();
  private touch = new Set<string>();
  private abort = new AbortController();
  private pointer: { id: number; x: number; y: number; distance: number } | null = null;
  private charging = false;
  private touchPointers = new Map<number, { control: string; target: HTMLElement }>();

  constructor(private canvas: HTMLCanvasElement, private actions: InputActions) {
    const options = { signal: this.abort.signal };
    window.addEventListener('keydown', (event) => {
      if (this.typing(event.target)) return;
      if (event.code === 'Escape') { this.clear(); actions.pause(); return; }
      if (actions.blocked()) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
      if (event.repeat) return;
      actions.intent?.();
      this.keys.add(event.code);
      if (event.code === 'Space') this.pressAction();
      if (event.code === 'KeyC') actions.camera();
      if (event.code === 'KeyE') { this.clear(); actions.interact?.(); }
      this.sync();
    }, options);
    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.code);
      if (event.code === 'Space') this.releaseAction();
      this.sync();
    }, options);
    canvas.addEventListener('pointerdown', (event) => {
      if (actions.blocked() || event.button !== 0) return;
      if (this.pointer) return;
      actions.intent?.();
      canvas.setPointerCapture(event.pointerId);
      this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, distance: 0 };
    }, options);
    canvas.addEventListener('pointermove', (event) => {
      const pointer = this.pointer;
      if (!pointer || pointer.id !== event.pointerId || actions.blocked()) return;
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      pointer.distance += Math.abs(dx) + Math.abs(dy);
      pointer.x = event.clientX; pointer.y = event.clientY;
      actions.orbit(-dx * .004, dy * .003);
      actions.aim(-dx * .004);
    }, options);
    canvas.addEventListener('pointerup', (event) => {
      if (this.pointer?.id !== event.pointerId) return;
      if (this.pointer?.id === event.pointerId && this.pointer.distance < 8 && !actions.blocked()) {
        const point = actions.pick(event.clientX, event.clientY);
        if (point && actions.phase() === 'aim') actions.course(point);
      }
      this.endPointer();
    }, options);
    canvas.addEventListener('pointercancel', (event) => {
      if (this.pointer?.id === event.pointerId) this.clear();
    }, options);
    canvas.addEventListener('lostpointercapture', () => { this.pointer = null; }, options);
    document.addEventListener('pointerdown', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-control]');
      if (!target || actions.blocked()) return;
      actions.intent?.();
      event.preventDefault();
      const control = target.dataset.control!;
      this.touchPointers.set(event.pointerId, { control, target });
      this.touch.add(control);
      target.setPointerCapture(event.pointerId);
      if (control === 'action') this.pressAction();
      this.sync();
    }, options);
    const releaseTouch = (event: PointerEvent) => {
      const pointer = this.touchPointers.get(event.pointerId);
      if (!pointer) return;
      const { control } = pointer;
      this.touchPointers.delete(event.pointerId);
      if (pointer.target.hasPointerCapture(event.pointerId)) pointer.target.releasePointerCapture(event.pointerId);
      if (![...this.touchPointers.values()].some(p => p.control === control)) this.touch.delete(control);
      if (event.type === 'pointercancel' || event.type === 'lostpointercapture') this.clear();
      else if (control === 'action' && !this.touch.has('action')) this.releaseAction();
      this.sync();
    };
    document.addEventListener('pointerup', releaseTouch, options);
    document.addEventListener('pointercancel', releaseTouch, options);
    document.addEventListener('lostpointercapture', releaseTouch, options);
    window.addEventListener('blur', () => this.clear(), options);
    // Keyboard activation of buttons is deliberate and never starts a pointer charge.
    document.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-control]');
      if (!target || event.detail !== 0 || actions.blocked()) return;
      actions.intent?.();
      const control = target.dataset.control;
      if (control === 'action') {
        if (actions.phase() === 'aim') { actions.charge(); actions.release(); }
        else if (actions.phase() === 'bite') actions.action();
      }
    }, options);
  }

  private typing(target: EventTarget | null) {
    return target instanceof HTMLElement && (!!target.closest('dialog, input, textarea, select, button, [contenteditable="true"]'));
  }
  private pressAction() {
    const phase = this.actions.phase();
    if (phase === 'aim') { this.charging = true; this.actions.charge(); }
    else if (phase === 'bite') this.actions.action();
    this.sync();
  }
  private releaseAction() {
    if (this.charging && !this.actions.blocked()) this.actions.release();
    this.charging = false;
  }
  private sync() {
    const held = (key: string, touch: string) => this.keys.has(key) || this.touch.has(touch);
    this.controls.move = Number(held('KeyW', 'forward') || this.keys.has('ArrowUp')) - Number(held('KeyS', 'back') || this.keys.has('ArrowDown'));
    this.controls.turn = Number(held('KeyD', 'right') || this.keys.has('ArrowRight')) - Number(held('KeyA', 'left') || this.keys.has('ArrowLeft'));
    this.controls.steer = this.controls.turn;
    this.controls.reel = this.keys.has('Space') || this.touch.has('action');
    this.controls.slack = held('KeyR', 'slack');
  }
  private endPointer() {
    if (this.pointer && this.canvas.hasPointerCapture(this.pointer.id)) this.canvas.releasePointerCapture(this.pointer.id);
    this.pointer = null;
  }
  clear() {
    this.charging = false;
    const pointers = [...this.touchPointers];
    this.touchPointers.clear();
    for (const [id, { target }] of pointers) {
      if (target.hasPointerCapture(id)) target.releasePointerCapture(id);
    }
    this.keys.clear(); this.touch.clear(); this.endPointer(); this.sync(); this.actions.cancel();
  }
  dispose() { this.clear(); this.abort.abort(); }
}
