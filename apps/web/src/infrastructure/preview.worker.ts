import {
  ENGINE_VERSION,
  policyDraftHash,
  policyStateHash,
  previewPolicy,
  type PreviewInput,
} from "@macro-nation/simulation-engine";

self.onmessage = (event: MessageEvent<unknown>) => {
  const request = event.data as {
    type?: string;
    requestId?: string;
    engineVersion?: string;
    input?: PreviewInput;
  };
  const requestId = request?.requestId;
  if (
    request?.type !== "PREVIEW_POLICY" ||
    typeof requestId !== "string" ||
    request.engineVersion !== ENGINE_VERSION ||
    !request.input?.state ||
    !Object.hasOwn(request.input, "draft")
  )
    return;
  try {
    const payload = previewPolicy(request.input);
    self.postMessage({
      type: "RESULT",
      requestId,
      draftHash: policyDraftHash(request.input.draft),
      stateHash: policyStateHash(request.input.state),
      payload,
    });
  } catch (error) {
    self.postMessage({
      type: "ERROR",
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
