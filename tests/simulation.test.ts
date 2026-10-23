import { describe, expect, it } from 'vitest';
import { EMPTY_CONTROLS } from '../src/contracts';
import type { Controls, Save, SpeciesId } from '../src/contracts';
import { createSave, validateSave } from '../src/persistence';
import { Game, HOTSPOTS, QUESTS, UPGRADE_COSTS, bossUnlocked, catchTier, habitatAt, hotspotAt, isCastLegal, isWater, mastery } from '../src/simulation';

const neutral = EMPTY_CONTROLS;
const input = (values: Partial<Controls>): Controls => ({ ...neutral, ...values });
function tick(game: Game, seconds: number, controls = neutral) { game.update(seconds, controls); }
function cast(game: Game, charge = 0.7) {
  game.startCharge();
  tick(game, charge);
  game.releaseCast();
  tick(game, 0.92);
}
function bite(game: Game) {
  for (let i = 0; i < 500 && game.snapshot.phase !== 'bite'; i++) tick(game, 1 / 60);
  expect(game.snapshot.phase).toBe('bite');
}
function hook(game: Game) { bite(game); game.action(); tick(game, 1 / 60); }
function win(game: Game): Set<number> {
  const phases = new Set<number>();
  for (let i = 0; i < 15000 && game.snapshot.phase === 'fight'; i++) {
    phases.add(game.snapshot.bossPhase);
    const rest = game.snapshot.behavior === 'rest' || game.snapshot.behavior === 'tell';
    tick(game, 1 / 60, input({ reel: rest, slack: !rest, steer: game.snapshot.runDirection }));
  }
  expect(game.snapshot.phase, game.snapshot.message).toBe('land');
  return phases;
}
function landed(game = new Game(createSave(), () => 0.5)) {
  cast(game); hook(game); win(game); return game;
}
function discover(save: Save) {
  for (const id of ['perch', 'trout', 'bass', 'pike'] as const) save.journal[id] = { count: 1, record: 1 };
  save.caught = 4; save.nextCatchId = 5; save.released = 4;
}
function hotspotFight(species: SpeciesId, assist = true): Game {
  const save = createSave();
  save.settings.assist = assist;
  if (species === 'king') discover(save);
  const spot = HOTSPOTS.find(candidate => candidate.species === species)!;
  const game = new Game(save, () => 0.5);
  game.snapshot.boat.x = spot.x; game.snapshot.boat.z = spot.z + 10;
  game.setLure(spot.lure); cast(game, 0); hook(game);
  expect(game.snapshot.fish.species).toBe(species);
  return game;
}

describe('precision habitats and shared progression', () => {
  it('exposes readable reachable habitat targets and matches lure without changing habitat rules', () => {
    expect(HOTSPOTS).toHaveLength(5);
    expect(HOTSPOTS.find(spot => spot.species === 'bass')).toMatchObject({ x: 0, z: 12, radius: 5 });
    for (const spot of HOTSPOTS) {
      expect(spot.name.length).toBeGreaterThan(3);
      expect(hotspotAt(spot)).toBe(spot);
      expect(isCastLegal({ x: spot.x, z: spot.z + 10 }, spot)).toBe(true);
    }
    expect(hotspotAt({ x: 0, z: 17 })).toBe(HOTSPOTS[0]);
    expect(hotspotAt({ x: 0, z: 17.01 })).toBeUndefined();
    expect(hotspotAt({ x: NaN, z: 12 })).toBeUndefined();
    const game = new Game(createSave(), () => 0.5);
    game.startCharge(); tick(game, 0.4);
    expect(game.snapshot.target.z).toBeCloseTo(12);
    expect(game.snapshot.precision).toBe(true);
    expect(game.snapshot.hotspot).toBe(HOTSPOTS[0].name);
    game.cancelInput(); game.setLure('fly');
    game.startCharge(); tick(game, 0.4);
    expect(game.snapshot.precision).toBe(false);
    expect(game.snapshot.lureHint).toContain('spinner');
    game.releaseCast();
    expect(game.snapshot.message).not.toContain('Precision');
  });
  it('rewards a matched landing with a quicker bite and larger catch, not mere proximity', () => {
    const precise = new Game(createSave(), () => 0.9);
    const ordinary = new Game(createSave(), () => 0.9);
    const mismatch = new Game(createSave(), () => 0.9);
    mismatch.setLure('fly');
    cast(precise, 0.4); cast(ordinary, 0.7); cast(mismatch, 0.4);
    expect(precise.snapshot.message).toMatch(/matched lure/);
    expect(precise.snapshot.precision).toBe(true);
    expect(mismatch.snapshot.precision).toBe(false);
    tick(precise, 2.4); tick(ordinary, 2.4); tick(mismatch, 2.4);
    expect(precise.snapshot.phase).toBe('bite');
    expect(ordinary.snapshot.phase).toBe('wait');
    expect(mismatch.snapshot.phase).toBe('wait');
    precise.action(); tick(precise, 1 / 60);
    hook(ordinary); hook(mismatch);
    for (const game of [precise, ordinary, mismatch]) win(game);
    expect(precise.snapshot.catch!.weight).toBeGreaterThan(ordinary.snapshot.catch!.weight);
    expect(mismatch.snapshot.catch!.weight).toBe(ordinary.snapshot.catch!.weight);
    expect(catchTier(precise.snapshot.catch!)).toBe('Legendary');
    expect(catchTier(ordinary.snapshot.catch!)).toBe('Trophy');
  });
  it.each([0, 0.999999])('keeps every bite in the 1.5–4 second active waiting window at roll %s', roll => {
    for (const charge of [0.4, 0.7]) {
      const game = new Game(createSave(), () => roll);
      cast(game, charge);
      const start = game.snapshot.time;
      bite(game);
      const elapsed = game.snapshot.time - start;
      expect(elapsed).toBeGreaterThanOrEqual(1.48);
      expect(elapsed).toBeLessThanOrEqual(4.01);
    }
  });
  it.each([
    ['perch', 0.6], ['trout', 1.1], ['bass', 1.8], ['pike', 3.2], ['king', 8],
  ] as const)('uses species-relative rounded tier thresholds for %s', (species, base) => {
    const trophy = Math.round(base * 125) / 100;
    const legendary = Math.round(base * 160) / 100;
    expect(catchTier({ species, weight: trophy - 0.01 })).toBe('Standard');
    expect(catchTier({ species, weight: trophy })).toBe('Trophy');
    expect(catchTier({ species, weight: legendary - 0.01 })).toBe('Trophy');
    expect(catchTier({ species, weight: legendary })).toBe('Legendary');
  });
  it('quotes tier and personal-best market premiums, then resolves and sells them exactly once', () => {
    const game = new Game(createSave(), () => 0.9);
    cast(game, 0.4); hook(game); win(game);
    const caught = { ...game.snapshot.catch! };
    expect(caught.record).toBe(true);
    expect(caught.value).toBe(Math.round(caught.weight * 19 * 1.8 * 1.15));
    expect(game.snapshot.message).toMatch(/Legendary.*Personal best/);
    expect(game.save.caught).toBe(0);
    game.resolveCatch(true); game.resolveCatch(true);
    expect(game.save.inventory).toEqual([caught]);
    expect(game.save.caught).toBe(1);
    expect(game.sell()).toBe(caught.value);
    expect(game.sell()).toBe(0);
    game.returnToDock();
    cast(game, 0.4); hook(game); win(game);
    expect(game.snapshot.catch!.record).toBe(false);
    expect(game.snapshot.catch!.value).toBe(Math.round(caught.weight * 19 * 1.8));
    game.resolveCatch(false); game.resolveCatch(false);
    expect(game.save.coins).toBe(caught.value);
    expect(game.save.caught).toBe(2);
    expect(game.save.released).toBe(1);
    expect(validateSave(game.save)).not.toBeNull();
  });
  it.each([true, false])('derives persistent mastery from counts for keep=%s without new save fields', keep => {
    const save = createSave();
    save.caught = 4; save.nextCatchId = 5; save.journal.bass = { count: 4, record: 1 };
    const keys = Object.keys(save).sort();
    const game = landed(new Game(save, () => 0.5));
    expect(mastery(save)).toMatchObject({ level: 0, progress: 4, goal: 5 });
    game.resolveCatch(keep); game.resolveCatch(keep);
    expect(mastery(save)).toMatchObject({ level: 1, progress: keep ? 0 : 1, goal: 5 });
    expect(mastery(save).title).not.toBe('Newcomer');
    expect(Object.keys(save).sort()).toEqual(keys);
    expect(mastery(validateSave(save)!)).toEqual(mastery(save));
  });
  it('caps mastery and grants useful but bounded passive fight power', () => {
    const novice = hotspotFight('bass');
    const expert = hotspotFight('bass');
    expert.save.caught = 100000; expert.save.released = 100000;
    expect(mastery(expert.save)).toMatchObject({ level: 5, progress: 5, goal: 5 });
    tick(novice, 0.5, input({ reel: true })); tick(expert, 0.5, input({ reel: true }));
    const noviceGain = 1 - novice.snapshot.stamina;
    const expertGain = 1 - expert.snapshot.stamina;
    expect(expertGain).toBeGreaterThan(noviceGain);
    expect(expertGain / noviceGain).toBeCloseTo(1.15);
  });
});

describe('lake geometry and boats', () => {
  it('has elliptical shores, islands and exact segment collision including tangency', () => {
    expect(isWater({ x: 0, z: 0 })).toBe(true);
    for (const point of [{ x: 85, z: 0 }, { x: 0, z: -60 }, { x: -46, z: -20 }, { x: 42, z: 24 }, { x: NaN, z: 0 }]) expect(isWater(point)).toBe(false);
    expect(isCastLegal({ x: -65, z: -20 }, { x: -25, z: -20 })).toBe(false);
    expect(isCastLegal({ x: 20, z: 24 }, { x: 65, z: 24 })).toBe(false);
    expect(isCastLegal({ x: -65, z: -12 }, { x: -25, z: -12 })).toBe(false);
    expect(isCastLegal({ x: 0, z: 30 }, { x: 0, z: -40 })).toBe(true);
    expect(isCastLegal({ x: 0, z: 0 }, { x: 0, z: 0 })).toBe(true);
  });
  it('labels habitats consistently', () => {
    expect(habitatAt({ x: -40, z: 0 })).toBe('Western reeds');
    expect(habitatAt({ x: 40, z: 0 })).toBe('Eastern shallows');
    expect(habitatAt({ x: 0, z: -25 })).toBe('Northern depths');
    expect(habitatAt({ x: 0, z: -45 })).toBe('Far north');
    expect(habitatAt({ x: 100, z: 0 })).toBe('Shore');
  });
  it('moves camera-relative at at most six units per second, even diagonally', () => {
    const game = new Game(createSave());
    tick(game, 1, input({ move: 1, turn: 1 }));
    expect(Math.hypot(game.snapshot.boat.x, game.snapshot.boat.z - 30)).toBeCloseTo(6, 6);
    expect(game.snapshot.boat.speed).toBeCloseTo(6, 6);
    game.aim(Math.PI / 2);
    const x = game.snapshot.boat.x;
    tick(game, 1, input({ move: 1 }));
    expect(game.snapshot.boat.x - x).toBeCloseTo(6, 6);
  });
  it('stops at the shore and refuses direct routes through islands', () => {
    const game = new Game(createSave());
    game.setCourse({ x: -65, z: 20 });
    tick(game, 15);
    expect(game.snapshot.boat.x).toBeCloseTo(-65, 5);
    expect(game.snapshot.boat.z).toBeCloseTo(20, 5);
    game.setCourse({ x: -30, z: -40 });
    tick(game, 10);
    expect(game.snapshot.boat.x).toBeCloseTo(-65, 5);
    expect(game.snapshot.message).toMatch(/crosses land/);
    game.returnToDock();
    tick(game, 0.02);
    tick(game, 30, input({ move: -1 }));
    expect(isWater(game.snapshot.boat)).toBe(true);
    expect(game.snapshot.boat.z).toBeLessThan(59);
    expect(game.snapshot.boat.speed).toBe(0);
  });
  it('blocks island-crossing casts despite a legal endpoint', () => {
    const game = new Game(createSave());
    game.snapshot.boat.x = -63; game.snapshot.boat.z = -20;
    game.aim(Math.PI / 2);
    game.startCharge(); tick(game, 1.4);
    expect(isWater(game.snapshot.target)).toBe(true);
    expect(game.snapshot.legalTarget).toBe(false);
    game.releaseCast();
    expect(game.snapshot.phase).toBe('aim');
    expect(game.snapshot.message).toMatch(/blocked/);
  });
});

describe('deterministic casts and input boundaries', () => {
  it('has a visible arc then nibbles and a generous true bite window', () => {
    const game = new Game(createSave(), () => 0);
    game.startCharge(); tick(game, 0.7);
    expect(game.snapshot.charge).toBeCloseTo(0.5);
    expect(game.snapshot.target.z).toBeCloseTo(6);
    game.releaseCast(); tick(game, 0.45);
    expect(game.snapshot.phase).toBe('cast');
    expect(game.snapshot.float.y).toBeGreaterThan(3);
    tick(game, 0.47);
    expect(game.snapshot.phase).toBe('wait');
    tick(game, 2);
    expect(game.snapshot.phase).toBe('wait');
    bite(game);
    expect(game.snapshot.biteRemaining).toBeCloseTo(2.5, 1);
    tick(game, 2);
    expect(game.snapshot.phase).toBe('bite');
    tick(game, 0.6);
    expect(game.snapshot.phase).toBe('aim');
    expect(game.save.caught).toBe(0);
  });
  it('uses fixed steps regardless of frame partition', () => {
    const a = new Game(createSave(), () => 0.3);
    const b = new Game(createSave(), () => 0.3);
    a.startCharge(); b.startCharge();
    tick(a, 1.2);
    for (let i = 0; i < 72; i++) tick(b, 1 / 60);
    a.releaseCast(); b.releaseCast();
    tick(a, 4);
    for (let i = 0; i < 240; i++) tick(b, 1 / 60);
    expect(a.snapshot).toEqual(b.snapshot);
  });
  it('cancels charges but preserves fights and freezes on pause', () => {
    const game = new Game(createSave(), () => 0.5);
    game.startCharge(); tick(game, 0.5); game.cancelInput();
    expect(game.snapshot.phase).toBe('aim');
    expect(game.snapshot.charge).toBe(0);
    cast(game); hook(game);
    game.cancelInput();
    expect(game.snapshot.phase).toBe('fight');
    game.setPaused(true);
    const snapshot = structuredClone(game.snapshot);
    tick(game, 20, input({ reel: true })); game.action(); game.returnToDock(); game.aim(2);
    expect(game.snapshot).toEqual(snapshot);
    game.setPaused(false);
    const stamina = game.snapshot.stamina;
    tick(game, 1, input({ reel: true }));
    expect(game.snapshot.stamina).toBe(stamina);
    tick(game, 1 / 60);
    tick(game, 0.2, input({ reel: true }));
    expect(game.snapshot.stamina).toBeLessThan(stamina);
  });
  it('does not allow held fight controls to cross hook transitions', () => {
    const game = new Game(createSave(), () => 0);
    cast(game); bite(game);
    tick(game, 0.1, input({ reel: true }));
    game.action();
    tick(game, 1, input({ reel: true }));
    expect(game.snapshot.stamina).toBe(1);
    tick(game, 0.02);
    tick(game, 0.2, input({ reel: true }));
    expect(game.snapshot.stamina).toBeLessThan(1);
  });
  it('action retracts cast/wait, hooks bite only, never keeps a landed fish', () => {
    const game = new Game(createSave(), () => 0);
    game.action(); expect(game.snapshot.phase).toBe('aim');
    game.startCharge(); game.releaseCast(); game.action();
    expect(game.snapshot.phase).toBe('aim');
    cast(game); game.action(); expect(game.snapshot.phase).toBe('aim');
    landed(game);
    game.action(); game.action();
    expect(game.snapshot.phase).toBe('land');
    expect(game.save.caught).toBe(0);
    expect(game.save.inventory).toHaveLength(0);
  });
  it('rejects invalid delta time and clamps corrupt control values', () => {
    const game = new Game(createSave());
    for (const dt of [NaN, Infinity, -2, 0]) tick(game, dt);
    expect(game.snapshot.time).toBe(0);
    tick(game, 1, input({ move: Infinity, turn: NaN }));
    expect(game.snapshot.boat).toEqual({ x: 0, z: 30, yaw: 0, speed: 0 });
  });
});

describe('physical fights, catches, and progression', () => {
  it.each([0, 0.65, -0.8, Math.PI])('keeps the hooked fish at its cast point instead of reflecting it across the boat, yaw=%s', yaw => {
    const game = new Game(createSave(), () => 0.5);
    game.aim(yaw); cast(game, 0.4); bite(game);
    const target = { ...game.snapshot.target };
    const boat = { ...game.snapshot.boat };
    game.action();
    expect(game.snapshot.fish.heading).toBeCloseTo(Math.atan2(target.x - boat.x, boat.z - target.z));
    for (let i = 0; i < 20; i++) {
      tick(game, 1 / 60);
      expect(game.snapshot.fish.x).toBeCloseTo(target.x, 8);
      expect(game.snapshot.fish.z).toBeCloseTo(target.z, 8);
    }
    tick(game, 0.2, input({ reel: true }));
    expect(Math.hypot(game.snapshot.fish.x - target.x, game.snapshot.fish.z - target.z)).toBeCloseTo(0.64);
    expect(game.snapshot.distance).toBeCloseTo(Math.hypot(game.snapshot.fish.x - boat.x, game.snapshot.fish.z - boat.z));
  });
  it('gives species genuinely different cyclic fight signatures with a safe tell before every burst', () => {
    const signatures = new Set<string>();
    for (const species of ['perch', 'bass', 'trout', 'pike'] as const) {
      const game = hotspotFight(species);
      const signature: string[] = [];
      let previous = game.snapshot.behavior;
      for (let i = 0; i < 540; i++) {
        const safe = game.snapshot.behavior === 'rest' || game.snapshot.behavior === 'tell';
        const stamina = game.snapshot.stamina;
        const wasTell = game.snapshot.behavior === 'tell';
        tick(game, 1 / 60, input({ reel: safe, slack: !safe, steer: game.snapshot.runDirection }));
        expect(game.snapshot.phase).toBe('fight');
        if (wasTell && game.snapshot.behavior === 'tell') {
          expect(game.snapshot.stamina).toBeLessThan(stamina);
          expect(game.snapshot.surgeIn).toBeGreaterThan(0);
          expect(game.snapshot.message).toMatch(/building/);
        }
        if (game.snapshot.behavior !== previous) {
          if (game.snapshot.behavior === 'run' || game.snapshot.behavior === 'jump') expect(previous).toBe('tell');
          signature.push(`${game.snapshot.behavior}:${i}`);
          previous = game.snapshot.behavior;
        }
      }
      expect(signature.filter(stage => stage.startsWith('tell')).length).toBeGreaterThanOrEqual(2);
      expect(signature.some(stage => stage.startsWith('jump'))).toBe(species === 'bass' || species === 'trout');
      signatures.add(signature.join('|'));
    }
    expect(signatures.size).toBe(4);
  });
  it('preserves telegraphs, combat pressure and bite timers across frame partitions and pause', () => {
    const a = hotspotFight('trout');
    const b = hotspotFight('trout');
    tick(a, 2, input({ reel: true }));
    for (let i = 0; i < 120; i++) tick(b, 1 / 60, input({ reel: true }));
    expect(a.snapshot.behavior).toBe('tell');
    expect(a.snapshot).toEqual(b.snapshot);
    a.setPaused(true);
    const frozen = structuredClone(a.snapshot);
    tick(a, 60, input({ reel: true })); a.action();
    expect(a.snapshot).toEqual(frozen);
    a.setPaused(false);
    b.cancelInput();
    tick(a, 1 / 60); tick(b, 1 / 60);
    tick(a, 0.5);
    for (let i = 0; i < 30; i++) tick(b, 1 / 60);
    expect(a.snapshot).toEqual(b.snapshot);
    const waiting = new Game(createSave(), () => 0.5);
    cast(waiting, 0.4);
    waiting.setPaused(true);
    const before = structuredClone(waiting.snapshot);
    tick(waiting, 60);
    expect(waiting.snapshot).toEqual(before);
    waiting.setPaused(false); bite(waiting);
    waiting.setPaused(true);
    const remaining = waiting.snapshot.biteRemaining;
    tick(waiting, 60);
    expect(waiting.snapshot.biteRemaining).toBe(remaining);
  });
  it.each([true, false])('makes every King phase distinct, telegraphed and winnable with base gear, assist=%s', assist => {
    const game = hotspotFight('king', assist);
    // Start at maximum casting distance to exercise recovery as well as stamina.
    game.snapshot.distance = 38;
    const events = new Map<number, Set<string>>();
    const durations = new Map<number, number>();
    const runDirections = new Map<number, Set<number>>();
    let previous = game.snapshot.behavior;
    for (let i = 0; i < 15000 && game.snapshot.phase === 'fight'; i++) {
      const phase = game.snapshot.bossPhase;
      if (!events.has(phase)) events.set(phase, new Set());
      events.get(phase)!.add(game.snapshot.behavior);
      durations.set(phase, (durations.get(phase) ?? 0) + 1);
      if (game.snapshot.behavior === 'run' || game.snapshot.behavior === 'jump') {
        if (!runDirections.has(phase)) runDirections.set(phase, new Set());
        runDirections.get(phase)!.add(game.snapshot.runDirection);
      }
      const safe = game.snapshot.behavior === 'rest' || game.snapshot.behavior === 'tell';
      tick(game, 1 / 60, input({ reel: safe, slack: !safe, steer: game.snapshot.runDirection }));
      if (game.snapshot.phase === 'fight' && (game.snapshot.behavior === 'run' || game.snapshot.behavior === 'jump') && game.snapshot.behavior !== previous) expect(previous).toBe('tell');
      previous = game.snapshot.behavior;
    }
    expect(game.save.rod).toBe(0); expect(game.save.line).toBe(0);
    expect(game.snapshot.phase, game.snapshot.message).toBe('land');
    expect([...events.keys()]).toEqual([1, 2, 3]);
    for (const phase of [1, 2, 3]) {
      for (const behavior of ['rest', 'tell', 'run']) expect(events.get(phase)!.has(behavior)).toBe(true);
    }
    expect(events.get(1)!.has('jump')).toBe(false);
    expect(events.get(2)!.has('jump')).toBe(true);
    expect(events.get(3)!.has('jump')).toBe(true);
    expect(runDirections.get(2)!.size).toBe(2);
    expect(new Set(durations.values()).size).toBe(3);
    expect(game.save.caught).toBe(4);
    game.resolveCatch(false); game.resolveCatch(false);
    expect(game.save.caught).toBe(5);
    expect(game.save.journal.king!.count).toBe(1);
    expect(bossUnlocked(game.save)).toBe(true);
  });
  it('is winnable at baseline with assist either on or off and warns before loss', () => {
    for (const assist of [true, false]) {
      const save = createSave(); save.settings.assist = assist;
      const game = new Game(save, () => 0.5);
      cast(game); hook(game); win(game);
      expect(game.save.caught).toBe(0);
    }
    const game = new Game(createSave(), () => 0.5);
    cast(game); hook(game);
    let warned = false;
    for (let i = 0; i < 1200 && game.snapshot.phase === 'fight'; i++) {
      tick(game, 1 / 60, input({ reel: true }));
      warned ||= /strain/.test(game.snapshot.message);
    }
    expect(warned).toBe(true);
    expect(game.snapshot.phase).toBe('aim');
    expect(game.save.caught).toBe(0);
  });
  it('keeps, releases, updates journal and sells exactly once', () => {
    const game = landed();
    const caught = { ...game.snapshot.catch! };
    game.resolveCatch(true); game.resolveCatch(true); game.resolveCatch(false);
    expect(game.save.caught).toBe(1);
    expect(game.save.nextCatchId).toBe(2);
    expect(game.save.inventory).toEqual([caught]);
    expect(game.save.journal[caught.species]).toEqual({ count: 1, record: caught.weight });
    expect(game.save.coins).toBe(0);
    expect(game.sell('perch')).toBe(0);
    expect(game.sell(caught.species)).toBe(caught.value);
    expect(game.sell()).toBe(0);
    landed(game); game.resolveCatch(false); game.resolveCatch(false);
    expect(game.save.caught).toBe(2);
    expect(game.save.released).toBe(1);
    expect(game.save.coins).toBe(caught.value);
    expect(validateSave(game.save)).not.toBeNull();
  });
  it('warns about excessive slack before a hook slips, without awarding a catch', () => {
    const game = new Game(createSave(), () => 0.5);
    cast(game); hook(game);
    let warned = false;
    for (let i = 0; i < 1500 && game.snapshot.phase === 'fight'; i++) {
      tick(game, 1 / 60, input({ slack: true }));
      warned ||= /Too much slack/.test(game.snapshot.message);
    }
    expect(warned).toBe(true);
    expect(game.snapshot.phase).toBe('aim');
    expect(game.snapshot.message).toMatch(/hook slipped/);
    expect(game.save.caught).toBe(0);
    expect(game.save.journal).toEqual({});
  });
  it('makes directional steering, slack, and upgraded equipment physically useful', () => {
    const make = (upgraded = false) => {
      const save = createSave();
      if (upgraded) { save.rod = 3; save.line = 3; }
      const game = new Game(save, () => 0.5);
      cast(game); hook(game); return game;
    };
    const correct = make(); const wrong = make(); const slack = make(); const upgraded = make(true);
    for (const game of [correct, wrong, slack, upgraded]) {
      tick(game, 1, input({ reel: true }));
      tick(game, 1.05);
    }
    expect(upgraded.snapshot.stamina).toBeLessThan(correct.snapshot.stamina);
    for (let i = 0; i < 30; i++) {
      tick(correct, 1 / 60, input({ reel: true, steer: correct.snapshot.runDirection }));
      tick(wrong, 1 / 60, input({ reel: true, steer: -wrong.snapshot.runDirection }));
      tick(slack, 1 / 60, input({ slack: true }));
      tick(upgraded, 1 / 60, input({ reel: true, steer: upgraded.snapshot.runDirection }));
    }
    expect(correct.snapshot.tension).toBeLessThan(wrong.snapshot.tension);
    expect(slack.snapshot.tension).toBeLessThan(correct.snapshot.tension);
    expect(upgraded.snapshot.tension).toBeLessThan(correct.snapshot.tension);
    expect(slack.snapshot.distance).toBeGreaterThan(correct.snapshot.distance);
  });
  it('does not navigate or change lure while the line is out', () => {
    const game = new Game(createSave(), () => 0);
    cast(game);
    const boat = { ...game.snapshot.boat };
    game.setCourse({ x: 10, z: 20 }); game.returnToDock(); game.setLure('fly');
    tick(game, 1, input({ move: 1, turn: 1 }));
    expect(game.snapshot.boat).toEqual(boat);
    expect(game.snapshot.lure).toBe('spinner');
    expect(game.snapshot.phase).toBe('wait');
  });
  it('allows dock-menu equipment changes and dock return while paused in aim only', () => {
    const game = new Game(createSave(), () => 0);
    tick(game, 1, input({ turn: 1 }));
    game.setPaused(true);
    game.setLure('minnow');
    expect(game.snapshot.lure).toBe('minnow');
    game.returnToDock();
    expect(game.snapshot.boat).toEqual({ x: 0, z: 30, yaw: 0, speed: 0 });
    expect(game.snapshot.paused).toBe(true);
    game.setPaused(false);
    cast(game); hook(game);
    const boat = { ...game.snapshot.boat };
    game.setPaused(true); game.setLure('fly'); game.returnToDock();
    expect(game.snapshot.lure).toBe('minnow');
    expect(game.snapshot.boat).toEqual(boat);
    expect(game.snapshot.phase).toBe('fight');
  });
  it('maintains records on smaller subsequent catches and creates increasing ids only on resolution', () => {
    let roll = 0.99;
    const game = new Game(createSave(), () => roll);
    landed(game);
    const first = { ...game.snapshot.catch! };
    expect(game.save.nextCatchId).toBe(1);
    expect(first.record).toBe(true);
    game.resolveCatch(true);
    roll = 0;
    landed(game);
    expect(game.snapshot.catch!.id).toBe(2);
    expect(game.snapshot.catch!.record).toBe(false);
    expect(game.save.caught).toBe(1);
    game.resolveCatch(false);
    expect(game.save.journal.bass!.record).toBe(first.weight);
    expect(game.save.journal.bass!.count).toBe(2);
    expect(validateSave(game.save)).not.toBeNull();
  });
  it('keeps a full hold choice pending and permits release instead', () => {
    const save = createSave();
    save.caught = 30; save.nextCatchId = 31; save.journal.bass = { count: 30, record: 2 };
    save.inventory = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, species: 'bass', weight: 1, value: 20, record: false }));
    const game = landed(new Game(save, () => 0.5));
    game.resolveCatch(true);
    expect(game.snapshot.phase).toBe('land');
    expect(game.snapshot.message).toMatch(/full/);
    expect(game.save.caught).toBe(30);
    game.resolveCatch(false);
    expect(game.save.released).toBe(1);
    expect(game.save.caught).toBe(31);
    expect(game.save.inventory).toHaveLength(30);
    expect(validateSave(game.save)).not.toBeNull();
  });
  it('tracks acceptance baselines, rewards atomically, and ignores unknown quests', () => {
    const game = new Game(createSave());
    game.save.caught = 5; game.save.nextCatchId = 6; game.save.journal.bass = { count: 5, record: 2 };
    game.acceptQuest('first-catches'); game.acceptQuest('first-catches'); game.acceptQuest('__proto__');
    expect(game.save.quests['first-catches'].base).toBe(5);
    expect(game.claimQuest('first-catches')).toBe(false);
    game.save.caught += 3;
    expect(game.claimQuest('first-catches')).toBe(true);
    expect(game.claimQuest('first-catches')).toBe(false);
    expect(game.save.coins).toBe(QUESTS[0].reward);
    game.acceptQuest('gentle-release');
    game.save.released += 2;
    expect(game.claimQuest('gentle-release')).toBe(true);
    game.acceptQuest('lake-explorer');
    expect(game.claimQuest('lake-explorer')).toBe(false);
    game.save.journal.perch = { count: 1, record: 1 };
    expect(game.claimQuest('lake-explorer')).toBe(true);
    game.save.journal.trout = { count: 1, record: 1 };
    expect(game.claimQuest('lake-explorer')).toBe(false);
    expect(game.claimQuest('unknown')).toBe(false);
    expect(Object.keys(game.save.quests)).toHaveLength(3);
  });
  it('permits late acceptance of journal discovery quests without impossible new-species requirements', () => {
    const save = createSave();
    discover(save);
    const game = new Game(save);
    game.acceptQuest('lake-explorer');
    expect(game.save.quests['lake-explorer'].base).toBe(0);
    expect(game.claimQuest('lake-explorer')).toBe(true);
    expect(game.claimQuest('lake-explorer')).toBe(false);
    expect(game.save.coins).toBe(QUESTS[2].reward);
    expect(validateSave(game.save)).not.toBeNull();
  });
  it('charges upgrade and paint ownership exactly once and caps levels', () => {
    const game = new Game(createSave());
    expect(game.upgrade('rod')).toBe(false);
    expect(game.buyPaint('ivory')).toBe(false);
    expect(game.equipPaint('ivory')).toBe(false);
    game.save.coins = 5000;
    for (const kind of ['rod', 'line'] as const) {
      for (let i = 0; i < 3; i++) {
        const before = game.save.coins;
        expect(game.upgrade(kind)).toBe(true);
        expect(before - game.save.coins).toBe(UPGRADE_COSTS[i]);
      }
      expect(game.upgrade(kind)).toBe(false);
    }
    const before = game.save.coins;
    expect(game.buyPaint('ivory')).toBe(true);
    expect(game.buyPaint('ivory')).toBe(false);
    expect(game.buyPaint('#fff')).toBe(false);
    expect(game.save.coins).toBe(before - 70);
    expect(game.equipPaint('ivory')).toBe(true);
    expect(game.save.paint).toBe('ivory');
    expect(game.equipPaint('ember')).toBe(false);
    expect(validateSave(game.save)).not.toBeNull();
  });
  it.each([
    ['perch', -40, 10, 'spinner'], ['trout', 40, -5, 'fly'],
    ['pike', 0, -15, 'minnow'], ['bass', 0, 30, 'spinner'],
  ] as const)('selects %s only in the right habitat and lure', (id, x, z, lure) => {
    const game = new Game(createSave(), () => 0);
    game.snapshot.boat.x = x; game.snapshot.boat.z = z;
    game.setLure(lure); cast(game, 0); hook(game);
    expect(game.snapshot.fish.species).toBe(id);
  });
  it('requires four discoveries for the King, telegraphs all three phases and permits retries forever', () => {
    const save = createSave();
    const game = new Game(save, () => 0.5);
    game.snapshot.boat.z = -30; game.setLure('minnow'); cast(game, 0); hook(game);
    expect(game.snapshot.fish.species).toBe('pike');
    expect(bossUnlocked(save)).toBe(false);
    game.snapshot.phase = 'aim';
    discover(save);
    expect(bossUnlocked(save)).toBe(true);
    game.setLure('minnow'); cast(game, 0); hook(game);
    expect(game.snapshot.fish.species).toBe('king');
    const phases = win(game);
    expect([...phases].sort()).toEqual([1, 2, 3]);
    game.resolveCatch(false);
    expect(save.journal.king?.count).toBe(1);
    expect(bossUnlocked(save)).toBe(true);
    cast(game, 0); hook(game);
    expect(game.snapshot.fish.species).toBe('king');
    tick(game, 20, input({ reel: true }));
    expect(game.snapshot.phase).toBe('aim');
    expect(bossUnlocked(save)).toBe(true);
    cast(game, 0); hook(game);
    expect(game.snapshot.fish.species).toBe('king');
    expect(validateSave(save)).not.toBeNull();
  });
});
