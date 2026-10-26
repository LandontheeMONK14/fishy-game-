import type { Catch, Controls, Lure, Point, Save, Snapshot, SpeciesId } from './contracts';

export const UPGRADE_COSTS = [90, 180, 320] as const;
export const HOTSPOTS: { name: string; x: number; z: number; radius: number; lure: Lure; species: SpeciesId }[] = [
  { name: 'Emerald pool', x: 0, z: 12, radius: 5, lure: 'spinner', species: 'bass' },
  { name: 'Sunset reeds', x: -36, z: 2, radius: 6, lure: 'spinner', species: 'perch' },
  { name: 'Silverfin spring', x: 36, z: -2, radius: 6, lure: 'fly', species: 'trout' },
  { name: 'Northern channel', x: 0, z: -27, radius: 6, lure: 'minnow', species: 'pike' },
  { name: 'Gilded crown', x: 0, z: -46, radius: 5, lure: 'minnow', species: 'king' },
];
const BASE_WEIGHT: Record<SpeciesId, number> = { perch: 0.6, trout: 1.1, bass: 1.8, pike: 3.2, king: 8 };
const FIGHT_PROFILES = {
  perch: { rest: 2.2, tell: 0.9, run: 1.1, jump: 0, recovery: 1.2, drain: 0.105, surge: 0.13 },
  bass: { rest: 1.2, tell: 0.75, run: 1.4, jump: 0.45, recovery: 1.1, drain: 0.09, surge: 0.21 },
  trout: { rest: 1.3, tell: 0.85, run: 0.7, jump: 1.15, recovery: 0.8, drain: 0.095, surge: 0.17 },
  pike: { rest: 1.5, tell: 1, run: 2.7, jump: 0, recovery: 1.2, drain: 0.085, surge: 0.23 },
};
const KING_PROFILES = [
  { rest: 1.8, tell: 1, run: 2.6, jump: 0, recovery: 1.4, drain: 0.07, surge: 0.22 },
  { rest: 1.1, tell: 0.9, run: 0.8, jump: 1.3, recovery: 1.2, drain: 0.075, surge: 0.19 },
  { rest: 0.85, tell: 0.7, run: 1.1, jump: 0.55, recovery: 1.6, drain: 0.085, surge: 0.2 },
];

export function hotspotAt(point: Point): typeof HOTSPOTS[number] | undefined {
  return isWater(point) ? HOTSPOTS.find(spot => distance(point, spot) <= spot.radius) : undefined;
}

export function catchTier(caught: Pick<Catch, 'species' | 'weight'>): 'Standard' | 'Trophy' | 'Legendary' {
  const base = BASE_WEIGHT[caught.species];
  return caught.weight >= Math.round(base * 160) / 100 ? 'Legendary'
    : caught.weight >= Math.round(base * 125) / 100 ? 'Trophy' : 'Standard';
}

export function mastery(save: Save): { title: string; level: number; progress: number; goal: number } {
  const experience = save.caught + save.released;
  const level = Math.min(5, Math.floor(experience / 5));
  return {
    title: ['Newcomer', 'Water reader', 'Reed keeper', 'Lake guide', 'Master angler', 'Stillwater guardian'][level],
    level, progress: level === 5 ? 5 : experience % 5, goal: 5,
  };
}
export const QUESTS = [
  { id: 'first-catches', title: 'A patient angler', goal: 3, reward: 75, description: 'Catch three fish after accepting this task.' },
  { id: 'gentle-release', title: 'Leave a little wonder', goal: 2, reward: 60, description: 'Release two fish after accepting this task.' },
  { id: 'lake-explorer', title: 'Read the water', goal: 2, reward: 100, description: 'Record two species in your journal.' },
] as const;

const PAINTS = ['teal', 'ivory', 'ember'];
const ISLANDS = [{ x: -46, z: -20, rx: 10, rz: 8 }, { x: 42, z: 24, rx: 12, rz: 8 }];
const STEP = 1 / 60;
const BOAT_MAX_SPEED = 5;
const BOAT_ACCELERATION = 2.6;
const BOAT_BRAKING = 3.6;
const BOAT_TURN_RATE = 1.15;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const finite = (n: number) => Number.isFinite(n) ? n : 0;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z);
const heading = (a: Point, b: Point) => Math.atan2(b.x - a.x, a.z - b.z);
const angleDelta = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));
const approach = (value: number, target: number, amount: number) =>
  value < target ? Math.min(value + amount, target) : Math.max(value - amount, target);
const EMPTY_BOAT_CONTROLS: Controls = { move: 0, turn: 0, steer: 0, reel: false, slack: false };
const discovered = (save: Save) => Object.values(save.journal).filter(entry => entry && entry.count > 0).length;

export function questProgress(save: Save, id: string): number {
  return id === 'first-catches' ? save.caught : id === 'gentle-release' ? save.released : discovered(save);
}

function water(point: Point, margin = 0): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.z)
    && (point.x / (85 - margin)) ** 2 + (point.z / (60 - margin)) ** 2 < 1
    && ISLANDS.every(i => ((point.x - i.x) / (i.rx + margin)) ** 2 + ((point.z - i.z) / (i.rz + margin)) ** 2 > 1);
}

export function isWater(point: Point): boolean { return water(point); }

function segmentLegal(from: Point, to: Point, margin = 0): boolean {
  if (!water(from, margin) || !water(to, margin)) return false;
  // The lake is convex. Only island intersections need an interior segment test.
  return ISLANDS.every(i => {
    const x = (from.x - i.x) / (i.rx + margin);
    const z = (from.z - i.z) / (i.rz + margin);
    const dx = (to.x - from.x) / (i.rx + margin);
    const dz = (to.z - from.z) / (i.rz + margin);
    const length = dx * dx + dz * dz;
    const t = length === 0 ? 0 : clamp(-(x * dx + z * dz) / length, 0, 1);
    return (x + dx * t) ** 2 + (z + dz * t) ** 2 > 1;
  });
}

export function isCastLegal(from: Point, to: Point): boolean { return segmentLegal(from, to); }
export function habitatAt(point: Point): string {
  if (!isWater(point)) return 'Shore';
  if (point.z < -38) return 'Far north';
  if (point.z < -15) return 'Northern depths';
  if (point.x < -22) return 'Western reeds';
  if (point.x > 22) return 'Eastern shallows';
  return 'Open water';
}
export function bossUnlocked(save: Save): boolean {
  return (['perch', 'trout', 'bass', 'pike'] as const).every(id => (save.journal[id]?.count ?? 0) > 0);
}

export class Game {
  public snapshot: Snapshot;
  private course: Point | null = null;
  private accumulator = 0;
  private phaseTime = 0;
  private biteAt = 3;
  private castFrom: Point = { x: 0, z: 30 };
  private blockedInput = false;
  private cycleTime = 0;
  private cycleCount = 0;
  private dangerTime = 0;
  private looseTime = 0;
  private runSeed = 0;
  private lastBehavior = '';
  private collisionStopped = false;
  private pending: Catch | null = null;

  constructor(public save: Save, private random: () => number = Math.random) {
    this.snapshot = {
      phase: 'aim', time: 0, boat: { x: 0, z: 30, yaw: 0, speed: 0 }, aimYaw: 0,
      target: { x: 0, z: 20 }, legalTarget: true, charge: 0,
      float: { x: 0, z: 20, y: 0 }, fish: { x: 0, z: 20, y: -0.4, species: 'bass', heading: 0 },
      tension: 0, stamina: 1, distance: 10, runDirection: 0, behavior: 'rest',
      bossPhase: 0, biteRemaining: 0, catch: null, lure: 'spinner', message: 'Find your water. Hold to cast.',
      habitat: 'Open water', paused: false, precision: false, hotspot: null, lureHint: '', surgeIn: 0,
    };
    this.refreshTarget();
  }

  private roll(): number { return clamp(finite(this.random()), 0, 0.999999); }
  private transition(phase: Snapshot['phase']): void {
    this.snapshot.phase = phase;
    this.phaseTime = 0;
    this.blockedInput = true;
  }
  private refreshTarget(): void {
    const s = this.snapshot;
    const range = 10 + 28 * s.charge;
    s.target = { x: s.boat.x + Math.sin(s.aimYaw) * range, z: s.boat.z - Math.cos(s.aimYaw) * range };
    s.legalTarget = isCastLegal(s.boat, s.target);
    s.habitat = habitatAt(s.target);
    const spot = hotspotAt(s.target);
    s.hotspot = spot?.name ?? null;
    s.precision = s.legalTarget && spot?.lure === s.lure;
    s.lureHint = spot
      ? `${spot.name} · ${spot.lure}${spot.species === 'king' && !bossUnlocked(this.save) ? ' · discover four species first' : ''}`
      : 'Find a glowing habitat ring for a precision cast.';
  }
  setPaused(paused: boolean): void {
    if (this.snapshot.paused === paused) return;
    this.cancelInput();
    this.snapshot.paused = paused;
    this.accumulator = 0;
  }
  aim(deltaYaw: number): void {
    if (this.snapshot.paused || !['aim', 'charge'].includes(this.snapshot.phase)) return;
    this.snapshot.aimYaw = Math.atan2(Math.sin(this.snapshot.aimYaw + finite(deltaYaw)), Math.cos(this.snapshot.aimYaw + finite(deltaYaw)));
    this.refreshTarget();
  }
  startCharge(): void {
    if (this.snapshot.paused || this.snapshot.phase !== 'aim') return;
    this.course = null;
    this.snapshot.charge = 0;
    this.transition('charge');
    this.snapshot.message = 'Hold for range; release to cast.';
    this.refreshTarget();
  }
  releaseCast(): void {
    const s = this.snapshot;
    if (s.paused || s.phase !== 'charge') return;
    this.refreshTarget();
    if (!s.legalTarget) {
      this.reset('Cast blocked by shore or island. Try another angle.');
      return;
    }
    this.castFrom = { x: s.boat.x, z: s.boat.z };
    s.float = { ...this.castFrom, y: 1.3 };
    this.biteAt = s.precision ? 1.5 + this.roll() : 2.5 + this.roll() * 1.5;
    this.transition('cast');
    s.message = s.precision ? `Precision cast! ${s.hotspot}: faster bites and larger fish.` : 'The lure sails over the water.';
  }
  action(): void {
    const s = this.snapshot;
    if (s.paused) return;
    if (s.phase === 'cast' || s.phase === 'wait') this.reset('Lure retrieved. Try another cast.');
    else if (s.phase === 'bite') this.hook();
  }
  cancelInput(): void {
    this.blockedInput = true;
    this.course = null;
    if (this.snapshot.phase === 'charge') this.reset('Cast cancelled.');
  }
  private reset(message: string): void {
    this.pending = null;
    this.snapshot.catch = null;
    this.snapshot.charge = 0;
    this.snapshot.biteRemaining = 0;
    this.snapshot.tension = 0;
    this.snapshot.bossPhase = 0;
    this.snapshot.behavior = 'rest';
    this.snapshot.surgeIn = 0;
    this.transition('aim');
    this.snapshot.message = message;
    this.refreshTarget();
  }
  setLure(lure: Lure): void {
    if (this.snapshot.phase === 'aim' && ['spinner', 'fly', 'minnow'].includes(lure)) {
      this.snapshot.lure = lure;
      this.refreshTarget();
      this.snapshot.message = `${lure[0].toUpperCase()}${lure.slice(1)} equipped.`;
    }
  }
  setCourse(point: Point | null): void {
    if (this.snapshot.paused || this.snapshot.phase !== 'aim') return;
    if (point === null) { this.course = null; return; }
    if (!segmentLegal(this.snapshot.boat, point, 1.2)) {
      this.course = null;
      this.snapshot.message = 'That route crosses land. Choose clear water.';
      return;
    }
    this.course = { ...point };
  }
  returnToDock(): void {
    if (this.snapshot.phase !== 'aim') return;
    this.course = null;
    this.snapshot.boat = { x: 0, z: 30, yaw: 0, speed: 0 };
    this.snapshot.aimYaw = 0;
    this.cancelInput();
    this.refreshTarget();
    this.snapshot.message = 'Back at the dock.';
  }

  update(dt: number, controls: Controls): void {
    if (this.snapshot.paused || !Number.isFinite(dt) || dt <= 0) return;
    const input: Controls = {
      move: clamp(finite(controls.move), -1, 1), turn: clamp(finite(controls.turn), -1, 1),
      steer: clamp(finite(controls.steer), -1, 1), reel: controls.reel === true, slack: controls.slack === true,
    };
    if (!input.move && !input.turn && !input.steer && !input.reel && !input.slack) this.blockedInput = false;
    this.accumulator += Math.min(dt, 60);
    while (this.accumulator + 1e-10 >= STEP) {
      this.accumulator -= STEP;
      this.tick(this.blockedInput ? { move: 0, turn: 0, steer: 0, reel: false, slack: false } : input);
    }
  }
  private tick(input: Controls): void {
    const s = this.snapshot;
    const boatInput = s.phase === 'aim' ? input : EMPTY_BOAT_CONTROLS;
    s.time += STEP;
    this.phaseTime += STEP;
    if (s.phase === 'aim') {
      this.refreshTarget();
    } else if (s.phase === 'charge') {
      s.charge = clamp(this.phaseTime / 1.4, 0, 1);
      this.refreshTarget();
    } else if (s.phase === 'cast') {
      const t = clamp(this.phaseTime / 0.9, 0, 1);
      s.float = {
        x: this.castFrom.x + (s.target.x - this.castFrom.x) * t,
        z: this.castFrom.z + (s.target.z - this.castFrom.z) * t,
        y: 1.3 * (1 - t) + Math.sin(Math.PI * t) * (3 + s.charge * 5),
      };
      if (t >= 1) {
        this.transition('wait');
        s.message = s.precision ? `${s.hotspot}: matched lure! Watch for a quick bite.` : `Watch the float. ${s.lureHint}`;
      }
    } else if (s.phase === 'wait') {
      const nibble = this.phaseTime > 1 && Math.sin(this.phaseTime * 6) > 0.88;
      s.float.y = nibble ? -0.08 : Math.sin(s.time * 3) * 0.025;
      if (this.phaseTime + 1e-10 >= this.biteAt) {
        this.transition('bite');
        s.biteRemaining = 2.5;
        s.float.y = -0.2;
        s.message = 'BITE! Strike now!';
      }
    } else if (s.phase === 'bite') {
      s.biteRemaining = Math.max(0, 2.5 - this.phaseTime);
      if (s.biteRemaining <= 1e-9) this.reset('The fish slipped away. Another cast awaits.');
    } else if (s.phase === 'fight') this.fight(input);
    this.moveBoat(boatInput);
  }
  private moveBoat(input: Controls): void {
    const s = this.snapshot;
    if (input.move || input.turn) this.course = null;
    let desiredSpeed = input.move * BOAT_MAX_SPEED;
    if (this.course) {
      const remaining = distance(s.boat, this.course);
      if (remaining < 0.75) {
        this.course = null;
        desiredSpeed = 0;
      } else {
        const error = angleDelta(s.boat.yaw, heading(s.boat, this.course));
        s.boat.yaw += clamp(error, -BOAT_TURN_RATE * STEP, BOAT_TURN_RATE * STEP);
        const stoppingSpeed = Math.sqrt(2 * BOAT_BRAKING * Math.max(0, remaining - 0.35));
        desiredSpeed = Math.min(BOAT_MAX_SPEED, stoppingSpeed) * Math.max(0, Math.cos(error));
      }
    } else {
      s.boat.yaw += input.turn * BOAT_TURN_RATE * STEP;
    }
    s.boat.yaw = Math.atan2(Math.sin(s.boat.yaw), Math.cos(s.boat.yaw));
    const braking = desiredSpeed === 0 || s.boat.speed * desiredSpeed < 0 || Math.abs(desiredSpeed) < Math.abs(s.boat.speed);
    const rate = braking ? BOAT_BRAKING : BOAT_ACCELERATION;
    s.boat.speed = approach(s.boat.speed, desiredSpeed, rate * STEP);
    if (Math.abs(s.boat.speed) < 1e-4) s.boat.speed = 0;
    const next = {
      x: s.boat.x + Math.sin(s.boat.yaw) * s.boat.speed * STEP,
      z: s.boat.z - Math.cos(s.boat.yaw) * s.boat.speed * STEP,
    };
    if (!segmentLegal(s.boat, next, 1.2)) {
      this.course = null;
      s.boat.speed = 0;
      if (!this.collisionStopped) s.message = 'Shallow water ahead — the boat stops safely.';
      this.collisionStopped = true;
      return;
    }
    this.collisionStopped = false;
    s.boat.x = next.x;
    s.boat.z = next.z;
  }
  private chooseSpecies(): SpeciesId {
    const { target, lure } = this.snapshot;
    const spot = hotspotAt(target);
    if (spot?.lure === lure && (spot.species !== 'king' || bossUnlocked(this.save))) return spot.species;
    if (target.z < -38 && lure === 'minnow' && bossUnlocked(this.save)) return 'king';
    if (target.z < -15 && lure === 'minnow') return 'pike';
    if (target.x < -22 && target.z >= -15 && lure === 'spinner') return this.roll() < 0.8 ? 'perch' : 'bass';
    if (target.x > 22 && target.z >= -15 && lure === 'fly') return this.roll() < 0.85 ? 'trout' : 'bass';
    return 'bass';
  }
  private hook(): void {
    const s = this.snapshot;
    const species = this.chooseSpecies();
    s.fish = { ...s.target, y: -0.4, species, heading: heading(s.boat, s.target) };
    s.distance = distance(s.boat, s.target);
    s.stamina = 1;
    s.tension = 0.3;
    s.behavior = 'rest';
    s.bossPhase = species === 'king' ? 1 : 0;
    s.biteRemaining = 0;
    this.cycleTime = this.cycleCount = this.dangerTime = this.looseTime = 0;
    this.runSeed = this.roll() * Math.PI * 2;
    this.lastBehavior = '';
    this.transition('fight');
    s.message = species === 'king' ? 'The Gilded King! Phase 1: long golden runs. Reel through rests and tells.' : 'Hooked! Reel in rests and tells; ease and follow during runs or jumps.';
  }
  private fight(input: Controls): void {
    const s = this.snapshot;
    const king = s.fish.species === 'king';
    const nextPhase = king ? s.stamina > 0.66 ? 1 : s.stamina > 0.33 ? 2 : 3 : 0;
    const phaseChanged = nextPhase !== s.bossPhase;
    s.bossPhase = nextPhase;
    // Each burst has its own safe tell. King phases restart with recovery, never an unannounced attack.
    const profile = s.fish.species === 'king' ? KING_PROFILES[Math.max(0, s.bossPhase - 1)] : FIGHT_PROFILES[s.fish.species];
    if (phaseChanged) { this.cycleTime = 0; this.cycleCount++; }
    this.cycleTime += STEP;
    const stages: { behavior: Snapshot['behavior']; duration: number; next?: 'run' | 'jump' }[] = [
      { behavior: 'rest', duration: profile.rest },
      { behavior: 'tell', duration: profile.tell, next: 'run' },
      { behavior: 'run', duration: profile.run },
      ...(profile.jump ? [{ behavior: 'tell' as const, duration: profile.tell, next: 'jump' as const }, { behavior: 'jump' as const, duration: profile.jump }] : []),
      { behavior: 'rest', duration: profile.recovery },
    ];
    const duration = stages.reduce((sum, stage) => sum + stage.duration, 0);
    if (this.cycleTime >= duration) { this.cycleTime -= duration; this.cycleCount++; }
    let elapsed = this.cycleTime;
    let stageIndex = 0;
    while (stageIndex < stages.length - 1 && elapsed >= stages[stageIndex].duration) elapsed -= stages[stageIndex++].duration;
    const stage = stages[stageIndex];
    s.behavior = stage.behavior;
    s.surgeIn = stage.behavior === 'tell' ? stage.duration - elapsed
      : stage.behavior === 'rest' ? stage.duration - elapsed + (stageIndex === 0 ? profile.tell : profile.rest + profile.tell) : 0;
    const direction = Math.sin(this.runSeed + this.cycleCount * 2.1) >= 0 ? 1 : -1;
    s.runDirection = direction * (stageIndex >= 3 && king && s.bossPhase >= 2 ? -1 : 1);
    if (phaseChanged || s.behavior !== this.lastBehavior) {
      s.message = `${king ? `King phase ${s.bossPhase} (${['', 'long runs', 'turning leaps', 'quick bursts'][s.bossPhase]}): ` : ''}${s.behavior === 'rest' ? 'The fish rests — reel steadily.' : s.behavior === 'tell' ? `${stage.next === 'jump' ? 'Leap' : 'Run'} building! Keep reeling until the tell ends; prepare to ease and follow.` : s.behavior === 'run' ? 'Run! Ease or give line; steer with the fish.' : 'Jump! Ease or give line and follow its direction.'}`;
      this.lastBehavior = s.behavior;
    }
    const rest = s.behavior === 'rest' || s.behavior === 'tell';
    const slack = input.slack;
    const reel = input.reel && !slack;
    const assist = this.save.settings.assist;
    const resistance = 1 + this.save.line * 0.2 + (assist ? 0.25 : 0);
    const power = 1 + this.save.rod * 0.22 + mastery(this.save).level * 0.03;
    let pressure = rest ? -0.025 : profile.surge;
    if (reel) pressure += rest ? 0.04 : 0.24;
    if (slack) pressure -= rest ? 0.15 : 0.42;
    if (!rest && input.steer * s.runDirection > 0) pressure -= 0.055;
    if (!rest && input.steer * s.runDirection < 0) pressure += 0.06;
    s.tension = clamp(s.tension + pressure / resistance * STEP, 0, 1);
    if (rest && reel) {
      s.distance = Math.max(1.8, s.distance - (king ? 2.5 : 3.2) * power * STEP);
      s.stamina = Math.max(0, s.stamina - profile.drain * power * STEP);
    } else if (!rest) {
      s.distance += (slack ? 0.7 : 0.35) * STEP;
      if (reel) s.stamina = Math.max(0, s.stamina - 0.016 * power * STEP);
    }
    this.dangerTime = s.tension >= 0.98 ? this.dangerTime + STEP : Math.max(0, this.dangerTime - STEP * 2);
    this.looseTime = s.tension < 0.025 && !reel ? this.looseTime + STEP : Math.max(0, this.looseTime - STEP * 2);
    const looseLimit = 4 + (assist ? 3 : 0) + Math.min(this.save.released, 20) * 0.1;
    if (s.tension > 0.8) s.message = 'Line strain! Stop reeling and give line now.';
    if (this.looseTime > looseLimit - 1.5) s.message = 'Too much slack! Take up a little line before the hook slips.';
    if (s.distance > 55) s.message = 'The fish is getting too far away! Recover line during its next rest.';
    if (this.dangerTime > (assist ? 1.5 : 0.9) || this.looseTime > looseLimit || s.distance > 65) {
      this.reset(s.distance > 65 ? 'The fish escaped into deep water.' : this.looseTime > looseLimit ? 'The hook slipped. Try a steadier line.' : 'The line broke. Rest, then try again.');
      return;
    }
    // Runs curve around the boat; illegal shoreline motion is rejected.
    const angle = heading(s.boat, s.fish) + (rest ? 0 : s.runDirection * 0.2 * STEP);
    const next = { x: s.boat.x + Math.sin(angle) * s.distance, z: s.boat.z - Math.cos(angle) * s.distance };
    if (isCastLegal(s.boat, next)) {
      s.fish.x = next.x; s.fish.z = next.z; s.fish.heading = angle;
    } else {
      s.distance = distance(s.boat, s.fish);
    }
    s.fish.y = s.behavior === 'jump' ? Math.sin(elapsed / profile.jump * Math.PI) * (king ? 2 : 1.5) : -0.4;
    s.float = { x: s.fish.x, z: s.fish.z, y: 0 };
    if (s.stamina <= 0.001 && s.distance <= 2.2) this.land();
  }
  private land(): void {
    const s = this.snapshot;
    const base = BASE_WEIGHT[s.fish.species];
    const weight = Math.round(base * (0.8 + this.roll() * 0.8 + (s.precision ? 0.25 : 0)) * 100) / 100;
    const tier = catchTier({ species: s.fish.species, weight });
    const record = weight > (this.save.journal[s.fish.species]?.record ?? 0);
    const multiplier = (tier === 'Legendary' ? 1.8 : tier === 'Trophy' ? 1.35 : 1) * (record ? 1.15 : 1);
    const value = Math.round(weight * { perch: 16, trout: 22, bass: 19, pike: 26, king: 45 }[s.fish.species] * multiplier);
    this.pending = { id: this.save.nextCatchId, species: s.fish.species, weight, value, record };
    s.catch = { ...this.pending };
    this.transition('land');
    s.message = `${tier} landed!${record ? ' Personal best · +15% value.' : ''} Keep for market value or release for extra mastery.`;
  }
  resolveCatch(keep: boolean): void {
    if (this.snapshot.paused || this.snapshot.phase !== 'land' || !this.pending) return;
    if (keep && this.save.inventory.length >= 30) {
      this.snapshot.message = 'The hold is full (30 fish). Release this catch or sell fish first.';
      return;
    }
    const caught = this.pending;
    const previous = this.save.journal[caught.species];
    this.save.journal[caught.species] = { count: (previous?.count ?? 0) + 1, record: Math.max(previous?.record ?? 0, caught.weight) };
    this.save.caught++;
    this.save.nextCatchId++;
    if (keep) this.save.inventory.push({ ...caught });
    else this.save.released++;
    this.reset(`${keep ? 'Catch kept. Sell at the market when ready.' : 'Released gently. Extra mastery earned; no coins were awarded.'} ${mastery(this.save).title} · mastery ${mastery(this.save).progress}/${mastery(this.save).goal}.`);
  }
  sell(species?: SpeciesId): number {
    if (species !== undefined && !['perch', 'trout', 'bass', 'pike', 'king'].includes(species)) return 0;
    const selling = this.save.inventory.filter(c => species === undefined || c.species === species);
    const value = selling.reduce((sum, c) => sum + c.value, 0);
    if (this.save.coins + value > 1_000_000_000) return 0;
    this.save.inventory = this.save.inventory.filter(c => species !== undefined && c.species !== species);
    this.save.coins += value;
    return value;
  }
  upgrade(kind: 'rod' | 'line'): boolean {
    if (kind !== 'rod' && kind !== 'line') return false;
    const level = this.save[kind];
    if (level >= 3 || this.save.coins < UPGRADE_COSTS[level]) return false;
    this.save.coins -= UPGRADE_COSTS[level];
    this.save[kind]++;
    return true;
  }
  buyPaint(color: string): boolean {
    if (!PAINTS.includes(color) || this.save.paints.includes(color) || this.save.coins < 70) return false;
    this.save.coins -= 70;
    this.save.paints.push(color);
    return true;
  }
  equipPaint(color: string): boolean {
    if (!PAINTS.includes(color) || !this.save.paints.includes(color)) return false;
    this.save.paint = color;
    return true;
  }
  acceptQuest(id: string): void {
    if (!QUESTS.some(q => q.id === id) || this.save.quests[id]?.accepted) return;
    this.save.quests[id] = { accepted: true, claimed: false, base: id === 'lake-explorer' ? 0 : questProgress(this.save, id) };
  }
  claimQuest(id: string): boolean {
    const quest = QUESTS.find(q => q.id === id);
    const state = this.save.quests[id];
    if (!quest || !state?.accepted || state.claimed || questProgress(this.save, id) - state.base < quest.goal || this.save.coins + quest.reward > 1_000_000_000) return false;
    state.claimed = true;
    this.save.coins += quest.reward;
    return true;
  }
}
