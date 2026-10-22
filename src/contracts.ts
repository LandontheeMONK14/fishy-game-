export type SpeciesId = 'perch' | 'trout' | 'bass' | 'pike' | 'king';
export type Phase = 'aim' | 'charge' | 'cast' | 'wait' | 'bite' | 'fight' | 'land';
export type Quality = 'low' | 'medium' | 'high';
export type Lure = 'spinner' | 'fly' | 'minnow';
export interface Point { x: number; z: number }
export interface Catch {
  id: number; species: SpeciesId; weight: number; value: number; record: boolean;
}
export interface Save {
  version: 2;
  coins: number;
  inventory: Catch[];
  journal: Partial<Record<SpeciesId, { count: number; record: number }>>;
  released: number;
  caught: number;
  rod: number;
  line: number;
  paint: string;
  paints: string[];
  name: string;
  quests: Record<string, { accepted: boolean; claimed: boolean; base: number }>;
  settings: { quality: Quality; assist: boolean; reducedMotion: boolean; volume: number; muted: boolean };
  nextCatchId: number;
}
export interface Snapshot {
  phase: Phase;
  time: number;
  boat: Point & { yaw: number; speed: number };
  aimYaw: number;
  target: Point;
  legalTarget: boolean;
  charge: number;
  float: Point & { y: number };
  fish: Point & { y: number; species: SpeciesId; heading: number };
  tension: number;
  stamina: number;
  distance: number;
  runDirection: number;
  behavior: 'rest' | 'run' | 'jump';
  bossPhase: number;
  biteRemaining: number;
  catch: Catch | null;
  lure: Lure;
  message: string;
  habitat: string;
  paused: boolean;
}
export interface Controls {
  move: number;
  turn: number;
  reel: boolean;
  slack: boolean;
  steer: number;
}
export interface Species {
  id: SpeciesId; name: string; color: string; rarity: string; hint: string;
}
export const SPECIES: Species[] = [
  { id: 'perch', name: 'Sunset perch', color: '#e8ac54', rarity: 'Common', hint: 'Reed beds · spinner · gentle runs' },
  { id: 'trout', name: 'Silverfin trout', color: '#a6dcd7', rarity: 'Uncommon', hint: 'Cool eastern water · fly · acrobatic jumps' },
  { id: 'bass', name: 'Emerald bass', color: '#88af74', rarity: 'Uncommon', hint: 'Open water · spinner · strong short runs' },
  { id: 'pike', name: 'Northern pike', color: '#b5c286', rarity: 'Rare', hint: 'Deep northern water · minnow · long surges' },
  { id: 'king', name: 'The Gilded King', color: '#ffd679', rarity: 'Legendary', hint: 'Discover four species, then cast a minnow into the far north. Three phases; give line during golden surges.' },
];
export const EMPTY_CONTROLS: Controls = { move: 0, turn: 0, reel: false, slack: false, steer: 0 };
