// Voice activity detection as a pure state machine (no browser APIs), so it can be unit-tested.
// Fed one loudness reading (RMS, 0..1) per audio block. It decides when you started talking, when you finished
// (after a pause long enough that normal breathing/thinking does not cut you off), and when you interrupt
// the assistant while it is speaking ("barge-in").

export type VadEvent = "start" | "end" | "discard" | null;

export type VadOptions = {
  absMin: number;        // never treat anything quieter than this as speech
  ratio: number;         // speech must be this many times louder than the room's noise floor
  startMs: number;       // loudness must last this long to count as the start of speech
  bargeMs: number;       // while the assistant is speaking, it must last this long (echo from the speaker is short and weak)
  bargeBoost: number;    // extra loudness required while the assistant is speaking
  hangoverMs: number;    // silence this long ends the utterance (long enough to allow a pause mid-sentence)
  minSpeechMs: number;   // utterances with less actual speech than this are dropped (clicks, coughs)
  maxUtteranceMs: number;
};

export const DEFAULT_VAD: VadOptions = { absMin: 0.012, ratio: 3, startMs: 120, bargeMs: 320, bargeBoost: 2, hangoverMs: 1100, minSpeechMs: 350, maxUtteranceMs: 45000 };

export class Vad {
  private o: VadOptions;
  floor = 0.004;
  private inSpeech = false;
  private voicedRun = 0;     // ms of consecutive loud audio while not yet in speech
  private silence = 0;       // ms of silence while in speech
  private speech = 0;        // ms of loud audio in this utterance
  private total = 0;         // ms since utterance start
  constructor(o: Partial<VadOptions> = {}) { this.o = { ...DEFAULT_VAD, ...o }; }

  get speaking() { return this.inSpeech; }
  reset() { this.inSpeech = false; this.voicedRun = 0; this.silence = 0; this.speech = 0; this.total = 0; }

  // Called for the first moments after the mic opens (before listening starts) so a noisy room is learned at once.
  calibrate(rms: number) { this.floor = Math.max(0.002, this.floor * 0.8 + rms * 0.2); }

  threshold(assistantSpeaking: boolean) {
    const t = Math.max(this.o.absMin, this.floor * this.o.ratio);
    return assistantSpeaking ? t * this.o.bargeBoost : t;
  }

  feed(rms: number, dtMs: number, assistantSpeaking = false): VadEvent {
    const loud = rms > this.threshold(assistantSpeaking);
    if (!this.inSpeech) {
      if (!loud) this.floor = Math.max(0.002, this.floor * 0.95 + rms * 0.05); // learn the room's background level
      this.voicedRun = loud ? this.voicedRun + dtMs : 0;
      if (this.voicedRun >= (assistantSpeaking ? this.o.bargeMs : this.o.startMs)) {
        this.inSpeech = true; this.silence = 0; this.speech = this.voicedRun; this.total = this.voicedRun; this.voicedRun = 0;
        return "start";
      }
      return null;
    }
    this.total += dtMs;
    if (loud) { this.speech += dtMs; this.silence = 0; } else this.silence += dtMs;
    if (this.silence >= this.o.hangoverMs || this.total >= this.o.maxUtteranceMs) {
      const ok = this.speech >= this.o.minSpeechMs;
      this.reset();
      return ok ? "end" : "discard";
    }
    return null;
  }
}
