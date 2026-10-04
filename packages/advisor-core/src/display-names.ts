import content from "./content-v1.2.0.json";

const indicators: Readonly<Record<string, string>> = content.indicatorLabels;
const policies: Readonly<Record<string, string>> = content.policyLabels;
const sources: Readonly<Record<string, string>> = content.sourceLabels;
const sourceTypes: Readonly<Record<string, string>> = content.sourceTypeLabels;
const industries: Readonly<Record<string, string>> = content.industryLabels;
const industryMetrics: Readonly<Record<string, string>> =
  content.industryMetricLabels;

function lookup(
  labels: Readonly<Record<string, string>>,
  id: string,
): string | undefined {
  return Object.hasOwn(labels, id) ? labels[id] : undefined;
}

/** Display wording only; internal IDs remain unchanged in facts and causal records. */
export function indicatorDisplayName(indicatorId: string): string {
  const industry = /^industry\.([^.]+)\.([^.]+)$/.exec(indicatorId);
  if (industry) {
    const name = lookup(industries, industry[1]!);
    const metric = lookup(industryMetrics, industry[2]!);
    return name && metric ? `${name}の${metric}` : content.unknownIndicator;
  }
  const id = indicatorId
    .replace(/^indicator\./, "")
    .split(".")
    .at(-1)!;
  return lookup(indicators, id) ?? content.unknownIndicator;
}

export function policyDisplayName(policyId: string): string {
  return lookup(policies, policyId) ?? content.unknownPolicy;
}

/** Opaque policy/event instance IDs cannot establish a more specific cause. */
export function causalSourceDisplayName(
  sourceType: string,
  sourceId: string,
): string {
  if (sourceType === "policy") {
    const policy = lookup(policies, sourceId);
    return policy ? `${policy}の変更` : sourceTypes.policy!;
  }
  return (
    lookup(sources, sourceId) ??
    lookup(sourceTypes, sourceType) ??
    content.unknownCause
  );
}

export function causeDisplayName(source: string): string {
  const separator = source.indexOf(":");
  return separator < 0
    ? content.unknownCause
    : causalSourceDisplayName(
        source.slice(0, separator),
        source.slice(separator + 1),
      );
}

export function renderContent(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return template.replace(
    /\{(\w+)\}/g,
    (match, key: string) => values[key] ?? match,
  );
}
