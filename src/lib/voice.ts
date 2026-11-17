// Voice-input error handling. The browser reports "not-allowed" for several unrelated causes, so we
// never trust that one word: we check the real microphone separately and name the actual cause.
export type VoiceIssue =
  | "policy_blocked"      // the site's own Permissions-Policy forbids the microphone
  | "permission_denied"   // the user (or OS) said no to this site
  | "insecure_context"    // microphone only works over https
  | "no_microphone"
  | "mic_busy"
  | "speech_service"      // microphone is fine, but the browser's speech service refused (e.g. dictation/Siri off, Chrome speech service blocked)
  | "network"
  | "no_speech"
  | "language"
  | "unsupported"
  | "ignore"              // user stopped it, or nothing to report
  | "unknown";

export type MicProbe = { ok: true } | { ok: false; name: string };

export const MESSAGES: Record<VoiceIssue, string> = {
  policy_blocked: "This site's settings are blocking the microphone (not your browser). Reload the page; if it still happens, the app needs an update.",
  permission_denied: "The microphone is blocked for this site. Tap the lock or tune icon in the address bar, allow Microphone, then reload. On iPhone also check Settings → Safari → Microphone.",
  insecure_context: "Voice needs a secure (https) page. Open the app from its https address.",
  no_microphone: "No microphone was found on this device.",
  mic_busy: "The microphone is being used by another app. Close it and try again.",
  speech_service: "Your microphone works, but this browser's speech service said no. On iPhone turn on Settings → General → Keyboard → Enable Dictation; on Android make sure Google voice typing is on. You can still type, or use your keyboard's own mic button.",
  network: "Speech recognition needs an internet connection and it dropped. Check your connection and try again.",
  no_speech: "I did not hear anything. Tap the mic and speak again.",
  language: "This browser cannot recognise that language. Pick another in Voice settings.",
  unsupported: "This browser has no speech recognition. Use Chrome, or type, or use your keyboard's own mic button.",
  ignore: "",
  unknown: "Voice input stopped unexpectedly. Try again, or type your message.",
};

// Turns a getUserMedia failure into the real cause.
export function classifyMicProbe(probe: MicProbe, env: { secure: boolean; policyAllows: boolean | null }): VoiceIssue | null {
  if (!env.secure) return "insecure_context";
  if (probe.ok) return null;
  if (probe.name === "NotFoundError" || probe.name === "OverconstrainedError") return "no_microphone";
  if (probe.name === "NotReadableError" || probe.name === "AbortError") return "mic_busy";
  if (probe.name === "NotAllowedError" || probe.name === "SecurityError") return env.policyAllows === false ? "policy_blocked" : "permission_denied";
  return "unknown";
}

// Turns a SpeechRecognition error code into a cause. For "not-allowed"/"service-not-allowed" the caller passes
// the result of probing the microphone: if the microphone itself works, permission is NOT the problem.
export function classifyRecognitionError(code: string, probeIssue: VoiceIssue | null): VoiceIssue {
  switch (code) {
    case "aborted": return "ignore";
    case "no-speech": return "no_speech";
    case "network": return "network";
    case "language-not-supported": return "language";
    case "audio-capture": return probeIssue ?? "no_microphone";
    case "not-allowed":
    case "service-not-allowed": return probeIssue ?? "speech_service";
    default: return probeIssue ?? "unknown";
  }
}

export function permissionsPolicyAllowsMic(): boolean | null {
  const pp = (document as unknown as { permissionsPolicy?: { allowsFeature(f: string): boolean }; featurePolicy?: { allowsFeature(f: string): boolean } });
  const p = pp.permissionsPolicy ?? pp.featurePolicy;
  try { return p ? p.allowsFeature("microphone") : null; } catch { return null; }
}

// Opens and immediately releases the microphone. Triggers the browser's permission prompt the first time.
export async function probeMicrophone(): Promise<MicProbe> {
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, name: "NotFoundError" };
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    return { ok: true };
  } catch (e) { return { ok: false, name: (e as { name?: string }).name ?? "Error" }; }
}

export async function diagnose(): Promise<VoiceIssue | null> {
  return classifyMicProbe(await probeMicrophone(), { secure: window.isSecureContext, policyAllows: permissionsPolicyAllowsMic() });
}

// "granted" | "denied" | "prompt" | null (not supported, e.g. Safari < 16)
export async function micPermissionState(): Promise<PermissionState | null> {
  try { return (await navigator.permissions.query({ name: "microphone" as PermissionName })).state; } catch { return null; }
}
