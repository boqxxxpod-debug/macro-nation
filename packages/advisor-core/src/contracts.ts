import type { PolicyParameters } from "@macro-nation/domain";

/** Read-only bounded facts; AI output is never GameState or an engine command. */
export interface CauseFact {
  readonly indicator: string;
  readonly delta: number;
  readonly source: string;
  readonly contribution: number;
}
export interface NationFacts {
  readonly month: number;
  readonly indicators: Readonly<Record<string, number>>;
  readonly causes: readonly CauseFact[];
  readonly recentEvents: readonly string[];
  readonly policy?: string;
}
export interface ExpertProfile {
  readonly id: string;
  readonly role: string;
  readonly values: string;
  readonly tone: string;
  readonly portraitAssetKey?: string;
}
export interface Advice {
  readonly expertId: string;
  readonly conclusion: string;
  readonly reason: string;
  readonly caution: string;
}
export interface AdvisorsRequest {
  readonly facts: NationFacts;
  readonly experts: readonly ExpertProfile[];
}
export interface FreePolicyRequest {
  readonly text: string;
}
export type FreePolicyResult =
  | { readonly status: "unsupported"; readonly explanation: string; readonly candidate: null }
  | { readonly status: "supported"; readonly explanation: string; readonly candidate: PolicyParameters };

export type Viewpoint = "anchor" | "newspaper" | "citizen" | "business" | "social";
export interface NewsStory {
  readonly headline: string;
  readonly explanation: string;
  readonly perspectives: readonly { readonly viewpoint: Viewpoint; readonly text: string }[];
}
export interface NewsRequest {
  readonly id: string;
  readonly facts: NationFacts;
}
export interface HistoryRequest {
  readonly milestones: readonly { readonly month: number; readonly summary: string }[];
  readonly ending: NationFacts;
}
export interface NationHistory {
  readonly title: string;
  readonly narrative: string;
}
export interface AIProvider {
  advisors(request: AdvisorsRequest): Promise<readonly Advice[]>;
  freePolicy(request: FreePolicyRequest): Promise<FreePolicyResult>;
  news(request: NewsRequest): Promise<NewsStory>;
  history(request: HistoryRequest): Promise<NationHistory>;
}
export type AIFeature = "advisors" | "freePolicy" | "news" | "history";
export type AIFlags = Readonly<Record<AIFeature, boolean>> & { readonly enabled: boolean };
