import { afterEach, describe, expect, it, vi } from 'vitest';
import { SAVE_KEY, createSave, exportSave, importSave, loadSave, persistSave, validateSave } from '../src/persistence';
import { catchTier, mastery } from '../src/simulation';

afterEach(() => vi.unstubAllGlobals());
const storage = () => {
  const data = new Map<string, string>();
  const api = {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { data.set(key, value); }),
    removeItem: vi.fn((key: string) => { data.delete(key); }),
  };
  vi.stubGlobal('localStorage', api);
  return { data, api };
};

describe('versioned validated saves', () => {
  it('uses safe settings, independent defaults, and deep-clones validated input', () => {
    const save = createSave();
    expect(save.settings).toEqual({ quality: 'medium', assist: true, reducedMotion: false, volume: 0.35, muted: true });
    const copy = validateSave(save)!;
    expect(copy).toEqual(save);
    copy.paints.push('ivory'); copy.settings.volume = 1;
    expect(save.paints).toEqual(['teal']);
    expect(save.settings.volume).toBe(0.35);
    expect(createSave()).toEqual(save);
  });
  it('starts with only free tackle and independently clones owned equipment and discoveries', () => {
    const save = createSave();
    expect(save.tackle).toEqual({ rods: ['starter'], lures: ['spinner'], rod: 'starter', lure: 'spinner' });
    save.tackle.rods.push('traveler'); save.tackle.rod = 'traveler';
    save.tackle.lures.push('fly'); save.tackle.lure = 'fly';
    save.discoveries.push('Willow wetlands');
    const copy = importSave(exportSave(save))!;
    expect(copy).toEqual(save);
    copy.tackle.rods.push('master');
    copy.tackle.lures.push('minnow');
    copy.discoveries.push('Crown basin');
    expect(save.tackle.rods).toEqual(['starter', 'traveler']);
    expect(save.tackle.lures).toEqual(['spinner', 'fly']);
    expect(save.discoveries).toEqual(['Willow wetlands']);
  });
  it.each([
    { tackle: null }, { tackle: { rods: ['starter'], lures: ['spinner'], rod: 'master', lure: 'spinner' } },
    { tackle: { rods: ['starter'], lures: ['spinner'], rod: 'starter', lure: 'fly' } },
    { tackle: { rods: ['starter', 'starter'], lures: ['spinner'], rod: 'starter', lure: 'spinner' } },
    { tackle: { rods: ['starter'], lures: ['spinner', 'spinner'], rod: 'starter', lure: 'spinner' } },
    { tackle: { rods: ['traveler'], lures: ['spinner'], rod: 'traveler', lure: 'spinner' } },
    { tackle: { rods: ['starter'], lures: ['fly'], rod: 'starter', lure: 'fly' } },
    { tackle: { rods: ['starter', '__proto__'], lures: ['spinner'], rod: 'starter', lure: 'spinner' } },
    { tackle: { rods: ['starter'], lures: ['spinner'], rod: 'starter', lure: 'spinner', extra: true } },
    { discoveries: ['Atlantis'] }, { discoveries: ['Home waters', 'Home waters'] },
    { discoveries: null }, { discoveries: 'Home waters' },
  ])('rejects invalid tackle/discoveries %j', fields => {
    expect(validateSave({ ...createSave(), ...fields })).toBeNull();
  });
  it('migrates only complete old v2 structures without mutating or discarding upgrades', () => {
    const legacy: Record<string, unknown> = { ...createSave(), rod: 3, line: 2, coins: 567 };
    delete legacy.tackle; delete legacy.discoveries;
    const before = JSON.stringify(legacy);
    const migrated = validateSave(legacy)!;
    expect(migrated).toMatchObject({ rod: 3, line: 2, coins: 567 });
    expect(migrated.tackle.lures).toEqual(['spinner', 'fly', 'minnow']);
    expect(migrated.tackle.rods).toEqual(['starter']);
    expect(JSON.stringify(legacy)).toBe(before);
    expect(validateSave({ ...legacy, discoveries: [] })).toBeNull();
    expect(validateSave({ ...legacy, tackle: createSave().tackle })).toBeNull();
  });
  it('round-trips export/import without sharing references', () => {
    const save = createSave();
    save.name = '<Angler>';
    const text = exportSave(save);
    expect(importSave(text)).toEqual(save);
    expect(importSave('{')).toBeNull();
    expect(importSave('null')).toBeNull();
    expect(importSave(' '.repeat(1_000_001))).toBeNull();
  });
  it('preserves pre-upgrade v2 exports and derives rewards without rewriting old catches', () => {
    const text = JSON.stringify({
      version: 2, coins: 123, inventory: [{ id: 1, species: 'bass', weight: 2.7, value: 51, record: true }],
      journal: { bass: { count: 4, record: 2.7 } }, released: 2, caught: 4,
      rod: 1, line: 0, paint: 'teal', paints: ['teal'], name: 'Old journal',
      quests: { 'first-catches': { accepted: true, claimed: true, base: 0 } },
      settings: { quality: 'low', assist: true, reducedMotion: true, volume: .2, muted: true },
      nextCatchId: 5,
    });
    const save = importSave(text)!;
    expect(save).not.toBeNull();
    expect(JSON.parse(exportSave(save))).toEqual({
      ...JSON.parse(text),
      tackle: { rods: ['starter'], lures: ['spinner', 'fly', 'minnow'], rod: 'starter', lure: 'spinner' },
      discoveries: [],
    });
    expect(catchTier(save.inventory[0])).toBe('Trophy');
    expect(mastery(save).level).toBeGreaterThanOrEqual(1);
    expect(save.inventory[0].value).toBe(51);
    expect(importSave(JSON.stringify({ ...save, mastery: 999 }))).toBeNull();
    expect(importSave(text.replace('"weight":2.7', '"weight":-2'))).toBeNull();
  });
  it.each([
    { version: 1 }, { version: 3 }, { coins: -1 }, { coins: Infinity }, { coins: 0.5 },
    { coins: 1_000_000_001 }, { caught: -1 }, { caught: 1_000_001 }, { released: 1 },
    { nextCatchId: 0 }, { nextCatchId: 2 }, { rod: 4 }, { line: -1 }, { line: 0.1 },
    { name: '' }, { name: ' ' }, { name: 'a'.repeat(33) }, { name: 'Bad\nName' },
    { paint: 'ivory' }, { paints: ['teal', 'teal'] }, { paints: ['ember'] },
    { paints: ['teal', '#fff'] }, { journal: { shark: { count: 1, record: 1 } } },
    { journal: { bass: { count: 1, record: 1 } } }, { journal: { bass: null } },
    { inventory: [{}] }, { quests: { unknown: { accepted: true, claimed: false, base: 0 } } },
    { quests: { 'first-catches': { accepted: true, claimed: true, base: 0 } } },
    { quests: { 'first-catches': { accepted: false, claimed: true, base: 0 } } },
    { settings: { quality: 'ultra', assist: true, reducedMotion: false, muted: true, volume: 0.3 } },
    { settings: { quality: 'medium', assist: true, reducedMotion: false, muted: true, volume: 1.01 } },
    { settings: { quality: 'medium', assist: 'yes', reducedMotion: false, muted: true, volume: 0.3 } },
    { settings: { quality: 'medium' } }, { extra: true },
  ])('rejects malformed fields %j', override => {
    const input = { ...createSave(), ...override };
    expect(validateSave(input)).toBeNull();
    expect(persistSave(input as never)).toBe(false);
  });
  it('rejects missing properties, prototype keys, arrays and malicious getters', () => {
    const save: Record<string, unknown> = { ...createSave() };
    delete save.coins;
    expect(validateSave(save)).toBeNull();
    expect(importSave(JSON.stringify(createSave()).replace('"quests":{}', '"quests":{"__proto__":{"accepted":true,"claimed":false,"base":0}}'))).toBeNull();
    expect(validateSave([])).toBeNull();
    expect(validateSave({ get version() { throw new Error('no'); } })).toBeNull();
  });
  it('cross-validates ids, inventory, journal counts, records and boss prerequisites', () => {
    const save = createSave();
    save.caught = 2; save.nextCatchId = 3;
    save.journal.bass = { count: 2, record: 2 };
    save.inventory = [{ id: 1, species: 'bass', weight: 1, value: 20, record: true }];
    expect(validateSave(save)).not.toBeNull();
    const mutate = (fn: (copy: typeof save) => void) => { const copy = structuredClone(save); fn(copy); expect(validateSave(copy)).toBeNull(); };
    mutate(s => s.inventory.push({ ...s.inventory[0] }));
    mutate(s => { s.inventory[0].id = 3; });
    mutate(s => { s.inventory[0].species = 'perch'; });
    mutate(s => { s.inventory[0].weight = 3; });
    mutate(s => { s.inventory[0].value = -1; });
    mutate(s => { s.inventory[0].record = 1 as never; });
    mutate(s => { s.released = 2; });
    mutate(s => { s.journal.bass!.count = 1; s.journal.king = { count: 1, record: 5 }; });
    mutate(s => { s.quests['first-catches'] = { accepted: true, claimed: false, base: 3 }; });
    mutate(s => { s.quests['lake-explorer'] = { accepted: true, claimed: false, base: 1 }; });
    mutate(s => { s.inventory = Array.from({ length: 31 }, (_, i) => ({ ...s.inventory[0], id: i + 1 })); });
  });
  it('loads and persists only v2, never migrates or deletes the legacy key', () => {
    const { data, api } = storage();
    data.set('golden-hour-3d-v1', '{"legacy":true}');
    expect(loadSave()).toEqual({ save: createSave(), warning: '', canPersist: true });
    const save = createSave(); save.coins = 100;
    expect(persistSave(save)).toBe(true);
    expect(loadSave()).toEqual({ save, warning: '', canPersist: true });
    expect(api.getItem.mock.calls.every(([key]) => key === SAVE_KEY)).toBe(true);
    expect(api.setItem.mock.calls.every(([key]) => key === SAVE_KEY)).toBe(true);
    expect(api.removeItem).not.toHaveBeenCalled();
    expect(data.get('golden-hour-3d-v1')).toBe('{"legacy":true}');
  });
  it('leaves corrupted data untouched and explicitly disables automatic persistence', () => {
    const { data, api } = storage();
    data.set(SAVE_KEY, '{"version":1}');
    const result = loadSave();
    expect(result.save).toEqual(createSave());
    expect(result.warning).toMatch(/invalid/);
    expect(result.warning).toMatch(/Autosaving is disabled/);
    expect(result.canPersist).toBe(false);
    expect(data.get(SAVE_KEY)).toBe('{"version":1}');
    expect(api.setItem).not.toHaveBeenCalled();
    expect(api.removeItem).not.toHaveBeenCalled();
    if (result.canPersist) persistSave(result.save);
    expect(data.get(SAVE_KEY)).toBe('{"version":1}');
    expect(() => exportSave({ ...createSave(), coins: -1 })).toThrow(/invalid/);
  });
  it('gracefully handles missing, blocked and quota-exhausted storage', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadSave().warning).toMatch(/unavailable/);
    expect(loadSave().warning).toMatch(/Autosaving is disabled until you confirm a save import or reset/);
    expect(loadSave().canPersist).toBe(false);
    expect(persistSave(createSave())).toBe(false);
    vi.stubGlobal('localStorage', {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('quota'); },
    });
    expect(loadSave().save).toEqual(createSave());
    expect(loadSave().warning).not.toBe('');
    expect(loadSave().canPersist).toBe(false);
    expect(persistSave(createSave())).toBe(false);
  });
  it('does not let one corrupt slot globally disable a later valid load', () => {
    const { data } = storage();
    data.set(SAVE_KEY, 'not json');
    expect(loadSave().canPersist).toBe(false);
    data.set(SAVE_KEY, exportSave(createSave()));
    expect(loadSave().canPersist).toBe(true);
    data.delete(SAVE_KEY);
    expect(loadSave().canPersist).toBe(true);
  });
});
