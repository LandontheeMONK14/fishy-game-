import type { Catch, Save, SpeciesId } from './contracts';
import { QUESTS, bossUnlocked, questProgress } from './simulation';

export const SAVE_KEY = 'stillwater-v2';
const SPECIES = ['perch', 'trout', 'bass', 'pike', 'king'] as const;
const PAINTS = ['teal', 'ivory', 'ember'];
const MAX_COUNT = 1_000_000;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const number = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const keys = (value: Record<string, unknown>, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
const species = (value: unknown): value is SpeciesId => typeof value === 'string' && (SPECIES as readonly string[]).includes(value);

export function createSave(): Save {
  return {
    version: 2, coins: 0, inventory: [], journal: {}, released: 0, caught: 0,
    rod: 0, line: 0, paint: 'teal', paints: ['teal'], name: 'Angler', quests: {},
    settings: { quality: 'medium', assist: true, reducedMotion: false, volume: 0.35, muted: true },
    nextCatchId: 1,
  };
}

export function validateSave(input: unknown): Save | null {
  try {
    if (!object(input) || !keys(input, ['version', 'coins', 'inventory', 'journal', 'released', 'caught', 'rod', 'line', 'paint', 'paints', 'name', 'quests', 'settings', 'nextCatchId'])) return null;
    if (input.version !== 2 || !integer(input.coins, 0, 1_000_000_000)
      || !integer(input.caught, 0, MAX_COUNT) || !integer(input.released, 0, input.caught)
      || !integer(input.nextCatchId, 1, MAX_COUNT + 1) || input.nextCatchId !== input.caught + 1
      || !integer(input.rod, 0, 3) || !integer(input.line, 0, 3)) return null;
    if (typeof input.name !== 'string' || input.name.trim().length === 0 || input.name.length > 32 || /[\u0000-\u001f\u007f]/.test(input.name)) return null;
    if (!Array.isArray(input.paints) || input.paints.length < 1 || input.paints.length > 3
      || !input.paints.every(p => typeof p === 'string' && PAINTS.includes(p))
      || new Set(input.paints).size !== input.paints.length || !input.paints.includes('teal')
      || typeof input.paint !== 'string' || !input.paints.includes(input.paint)) return null;
    const settings = input.settings;
    if (!object(settings) || !keys(settings, ['quality', 'assist', 'reducedMotion', 'volume', 'muted'])
      || !['low', 'medium', 'high'].includes(settings.quality as string)
      || typeof settings.assist !== 'boolean' || typeof settings.reducedMotion !== 'boolean'
      || typeof settings.muted !== 'boolean' || !number(settings.volume, 0, 1)) return null;
    if (!object(input.journal) || !keys(input.journal, SPECIES)) return null;
    let total = 0;
    for (const entry of Object.values(input.journal)) {
      if (!object(entry) || !keys(entry, ['count', 'record']) || !integer(entry.count, 1, MAX_COUNT) || !number(entry.record, 0.01, 1000)) return null;
      total += entry.count;
    }
    if (total !== input.caught || !Array.isArray(input.inventory) || input.inventory.length > 30
      || input.inventory.length > input.caught - input.released) return null;
    const ids = new Set<number>();
    const inventoryCounts: Partial<Record<SpeciesId, number>> = {};
    for (const item of input.inventory) {
      if (!object(item) || !keys(item, ['id', 'species', 'weight', 'value', 'record'])
        || !integer(item.id, 1, input.nextCatchId - 1) || ids.has(item.id) || !species(item.species)
        || !number(item.weight, 0.01, 1000) || !integer(item.value, 0, 100_000)
        || typeof item.record !== 'boolean') return null;
      ids.add(item.id);
      const entry = input.journal[item.species];
      if (!object(entry) || typeof entry.record !== 'number' || entry.record < item.weight) return null;
      inventoryCounts[item.species] = (inventoryCounts[item.species] ?? 0) + 1;
      if (typeof entry.count !== 'number' || inventoryCounts[item.species]! > entry.count) return null;
    }
    if (!object(input.quests) || !keys(input.quests, QUESTS.map(q => q.id))) return null;
    const save = input as unknown as Save;
    if (save.journal.king && !bossUnlocked(save)) return null;
    for (const [id, state] of Object.entries(input.quests)) {
      const quest = QUESTS.find(q => q.id === id)!;
      if (!object(state) || !keys(state, ['accepted', 'claimed', 'base'])
        || typeof state.accepted !== 'boolean' || typeof state.claimed !== 'boolean'
        || !integer(state.base, 0, questProgress(save, id))
        || (id === 'lake-explorer' && state.base !== 0)
        || (!state.accepted && (state.claimed || state.base !== 0))
        || (state.claimed && questProgress(save, id) - state.base < quest.goal)) return null;
    }
    // Return fresh data: neither imported objects nor callers share save internals.
    return {
      version: 2, coins: save.coins, caught: save.caught, released: save.released,
      rod: save.rod, line: save.line, nextCatchId: save.nextCatchId, name: save.name,
      paint: save.paint, paints: [...save.paints], settings: { ...save.settings },
      inventory: save.inventory.map(c => ({ ...c } as Catch)),
      journal: Object.fromEntries(Object.entries(save.journal).map(([id, entry]) => [id, { ...entry }])),
      quests: Object.fromEntries(Object.entries(save.quests).map(([id, state]) => [id, { ...state }])),
    };
  } catch { return null; }
}

export function importSave(text: string): Save | null {
  if (typeof text !== 'string' || text.length > 1_000_000) return null;
  try { return validateSave(JSON.parse(text)); } catch { return null; }
}
export function exportSave(save: Save): string {
  const validated = validateSave(save);
  if (!validated) throw new Error('Cannot export an invalid Stillwater save.');
  return JSON.stringify(validated, null, 2);
}
export function loadSave(): { save: Save; warning: string } {
  // Version 2 intentionally has no migration. Never read, overwrite, or delete golden-hour-3d-v1.
  try {
    const text = globalThis.localStorage.getItem(SAVE_KEY);
    if (text === null) return { save: createSave(), warning: '' };
    const save = importSave(text);
    return save ? { save, warning: '' } : { save: createSave(), warning: 'Saved data was invalid. A fresh lake was opened; autosaving will replace the invalid Stillwater save.' };
  } catch {
    return { save: createSave(), warning: 'Local storage is unavailable. Export your save to keep your progress.' };
  }
}
export function persistSave(save: Save): boolean {
  const validated = validateSave(save);
  if (!validated) return false;
  try {
    globalThis.localStorage.setItem(SAVE_KEY, JSON.stringify(validated));
    return true;
  } catch { return false; }
}
