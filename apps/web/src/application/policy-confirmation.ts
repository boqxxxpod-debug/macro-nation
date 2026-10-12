import type { GameState, PolicyDecision } from "@macro-nation/domain";

/** Derive the last confirmed decision from durable state, including its current status. */
export function selectLatestConfirmedPolicy(
  state: GameState,
): PolicyDecision | undefined {
  const policies = [
    ...state.policies.reserved,
    ...state.policies.active,
    ...state.policies.completed,
    ...state.policies.cancelled,
  ];
  const byId = new Map(policies.map((policy) => [policy.policyId, policy]));
  const receipts = state.policyAdministration?.receipts ?? [];
  // Commands append receipts in confirmation order. Lifecycle bucket moves do
  // not change that order, and cancelling a policy does not confirm a new one.
  for (let index = receipts.length - 1; index >= 0; index -= 1) {
    const receipt = receipts[index]!;
    // Legacy receipts are synthesized in bucket order, not command order.
    if (receipt.kind === "cancel" || receipt.fingerprint === "legacy") continue;
    const policy = byId.get(receipt.policyId);
    if (policy) return policy;
  }
  // Older saves have no command order. Prefer the newest decision month, then
  // the later entry in reserved/active/completed/cancelled order for stable ties.
  return policies.reduce<PolicyDecision | undefined>(
    (latest, policy) =>
      !latest || policy.decidedMonth >= latest.decidedMonth ? policy : latest,
    undefined,
  );
}
