import test from "node:test";
import assert from "node:assert/strict";
import { classifyMicProbe, classifyRecognitionError } from "../../src/lib/voice.ts";

const env = { secure: true, policyAllows: true as boolean | null };
test("a working microphone is never reported as blocked", () => {
  assert.equal(classifyMicProbe({ ok: true }, env), null);
  assert.equal(classifyRecognitionError("not-allowed", null), "speech_service");          // mic fine, speech service said no
  assert.equal(classifyRecognitionError("service-not-allowed", null), "speech_service");
});
test("real permission problems are named correctly", () => {
  assert.equal(classifyMicProbe({ ok: false, name: "NotAllowedError" }, env), "permission_denied");
  assert.equal(classifyMicProbe({ ok: false, name: "NotAllowedError" }, { secure: true, policyAllows: false }), "policy_blocked");
  assert.equal(classifyMicProbe({ ok: false, name: "NotAllowedError" }, { secure: true, policyAllows: null }), "permission_denied");
  assert.equal(classifyMicProbe({ ok: true }, { secure: false, policyAllows: true }), "insecure_context");
  assert.equal(classifyMicProbe({ ok: false, name: "NotFoundError" }, env), "no_microphone");
  assert.equal(classifyMicProbe({ ok: false, name: "NotReadableError" }, env), "mic_busy");
  assert.equal(classifyRecognitionError("not-allowed", "permission_denied"), "permission_denied");
  assert.equal(classifyRecognitionError("not-allowed", "policy_blocked"), "policy_blocked");
});
test("other recognition errors", () => {
  assert.equal(classifyRecognitionError("aborted", null), "ignore");
  assert.equal(classifyRecognitionError("no-speech", null), "no_speech");
  assert.equal(classifyRecognitionError("network", null), "network");
  assert.equal(classifyRecognitionError("language-not-supported", null), "language");
  assert.equal(classifyRecognitionError("weird", null), "unknown");
});
