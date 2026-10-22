import { describe, expect, it } from 'vitest';
import { EMPTY_CONTROLS } from '../src/contracts';
import type { Controls, Save } from '../src/contracts';
import { createSave, validateSave } from '../src/persistence';
import { Game, QUESTS, UPGRADE_COSTS, bossUnlocked, habitatAt, isCastLegal, isWater } from '../src/simulation';

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
    const rest = game.snapshot.behavior === 'rest';
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
      tick(game, 0.55);
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
