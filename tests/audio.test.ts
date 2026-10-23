import { afterEach, describe, expect, it, vi } from 'vitest';
import { LakeAudio } from '../src/audio';
import { createSave } from '../src/persistence';
import { Game } from '../src/simulation';

afterEach(() => vi.unstubAllGlobals());

describe('optional fishing sound', () => {
  it('does not initialize audio until enabled, and silences cues while paused or muted', async () => {
    const parameter = () => ({
      value: 0, setTargetAtTime: vi.fn(), setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    });
    const node = () => ({
      connect: vi.fn().mockReturnThis(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
      gain: parameter(), frequency: parameter(),
    });
    const oscillator = vi.fn(node);
    const context = {
      state: 'running', currentTime: 0, sampleRate: 100,
      destination: {}, createGain: node, createBiquadFilter: node,
      createBuffer: (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
      createBufferSource: node, createOscillator: oscillator,
      suspend: vi.fn(async () => {}), resume: vi.fn(async () => {}), close: vi.fn(async () => {}),
    };
    const constructor = vi.fn(function () { return context; });
    vi.stubGlobal('AudioContext', constructor);
    const audio = new LakeAudio();
    const save = createSave();
    const snapshot = new Game(save).snapshot;
    await audio.configure(save.settings, false);
    expect(constructor).not.toHaveBeenCalled();
    save.settings.muted = false;
    await audio.configure(save.settings, false);
    expect(constructor).toHaveBeenCalledOnce();
    snapshot.phase = 'cast'; audio.update(snapshot);
    expect(oscillator).toHaveBeenCalledOnce();
    await audio.configure(save.settings, true);
    snapshot.phase = 'land'; audio.update(snapshot);
    expect(context.suspend).toHaveBeenCalledOnce();
    expect(oscillator).toHaveBeenCalledOnce();
    await audio.configure(save.settings, false);
    audio.update(snapshot);
    expect(oscillator).toHaveBeenCalledOnce();
    save.settings.muted = true;
    await audio.configure(save.settings, false);
    snapshot.phase = 'cast'; audio.update(snapshot);
    expect(oscillator).toHaveBeenCalledOnce();
    audio.dispose();
    expect(context.close).toHaveBeenCalledOnce();
  });
});
