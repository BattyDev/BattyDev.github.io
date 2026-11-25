export type Cue = "chop" | "sell" | "hire" | "build" | "launch" | "load" | "craft" | "error";

/**
 * Short original cues. No music bed, and nothing fetched.
 * The context stays locked until the first tap or key.
 */
export class AudioBus {
  private ctx: AudioContext | null = null;
  muted = false;

  unlock(): void {
    if (this.muted) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!this.ctx) this.ctx = new Ctx();
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  play(cue: Cue): void {
    if (this.muted || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (cue === "chop" || cue === "craft") this.noise(ctx, now, 0.07, 900);
    else if (cue === "load") this.tone(ctx, now, 520, 0.06, "triangle");
    else if (cue === "error") this.tone(ctx, now, 140, 0.08, "square", 0.04);
    else if (cue === "sell") this.arp(ctx, now, [523, 659, 784], 0.09);
    else if (cue === "hire") this.arp(ctx, now, [392, 523, 659], 0.1);
    else if (cue === "build") this.arp(ctx, now, [349, 440, 554], 0.11);
    else if (cue === "launch") this.arp(ctx, now, [392, 494, 587, 784], 0.12);
  }

  private tone(
    ctx: AudioContext,
    when: number,
    freq: number,
    dur: number,
    type: OscillatorType,
    gain = 0.08,
  ): void {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(gain, when);
    amp.gain.exponentialRampToValueAtTime(0.001, when + dur);
    osc.connect(amp);
    amp.connect(ctx.destination);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  private arp(ctx: AudioContext, when: number, notes: number[], step: number): void {
    notes.forEach((freq, index) => this.tone(ctx, when + index * step, freq, step * 1.3, "triangle", 0.07));
  }

  private noise(ctx: AudioContext, when: number, dur: number, freq: number): void {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = "square";
    osc.frequency.setValueAtTime(freq, when);
    osc.frequency.exponentialRampToValueAtTime(180, when + dur);
    filter.type = "lowpass";
    filter.frequency.value = 1200;
    amp.gain.setValueAtTime(0.05, when);
    amp.gain.exponentialRampToValueAtTime(0.001, when + dur);
    osc.connect(filter);
    filter.connect(amp);
    amp.connect(ctx.destination);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }
}
