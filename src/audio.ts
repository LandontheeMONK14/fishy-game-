import type { Save, Snapshot } from './contracts';

export class LakeAudio {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private noise: AudioBufferSourceNode | null = null;
  private lastPhase = '';
  private paused = true;
  private enabled = false;

  async configure(settings: Save['settings'], paused: boolean) {
    this.paused = paused;
    this.enabled = !settings.muted;
    if (!this.enabled || paused) {
      if (this.context?.state === 'running') await this.context.suspend().catch(() => {});
      return;
    }
    try {
      if (!this.context) this.create();
      this.gain!.gain.setTargetAtTime(settings.volume, this.context!.currentTime, .2);
      if (this.context!.state === 'suspended') await this.context!.resume();
    } catch { /* Sound is optional; unavailable audio must not stop play. */ }
  }

  private create() {
    const context = new AudioContext();
    this.context = context;
    this.gain = context.createGain();
    this.gain.connect(context.destination);
    const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
    const samples = buffer.getChannelData(0);
    let previous = 0;
    for (let i = 0; i < samples.length; i++) {
      previous = (previous + (Math.random() * 2 - 1) * .025) / 1.025;
      samples[i] = previous;
    }
    const noise = context.createBufferSource();
    noise.buffer = buffer; noise.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 650;
    const ambient = context.createGain(); ambient.gain.value = .24;
    noise.connect(filter).connect(ambient).connect(this.gain);
    noise.start(); this.noise = noise;
  }

  update(snapshot: Snapshot) {
    const changed = this.lastPhase !== snapshot.phase;
    this.lastPhase = snapshot.phase;
    if (!changed || !this.context || !this.gain || this.paused || !this.enabled) return;
    if (['wait', 'bite', 'land'].includes(snapshot.phase)) {
      const context = this.context;
      const source = context.createBufferSource();
      const length = snapshot.phase === 'land' ? .8 : .22;
      const buffer = context.createBuffer(1, Math.floor(context.sampleRate * length), context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3) * .25;
      source.buffer = buffer;
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass'; filter.frequency.value = snapshot.phase === 'bite' ? 950 : 450;
      source.connect(filter).connect(this.gain);
      source.onended = () => { source.disconnect(); filter.disconnect(); };
      source.start();
    }
  }

  dispose() {
    this.noise?.stop(); this.noise?.disconnect();
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}
