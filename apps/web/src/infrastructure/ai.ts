import type {
  AIFlags, AIProvider, AdvisorsRequest, Advice, FreePolicyRequest, FreePolicyResult,
  HistoryRequest, NationHistory, NewsRequest, NewsStory,
} from "@macro-nation/advisor-core";
import { AIService, MockAIProvider } from "@macro-nation/advisor-core";

const yes = (value: string | undefined) => value === "true";
export const aiFlags: AIFlags = Object.freeze({
  enabled: yes(import.meta.env.VITE_AI_ENABLED),
  advisors: yes(import.meta.env.VITE_AI_ADVISORS_ENABLED),
  freePolicy: yes(import.meta.env.VITE_AI_FREE_POLICY_ENABLED),
  news: yes(import.meta.env.VITE_AI_NEWS_ENABLED),
  history: yes(import.meta.env.VITE_AI_NATION_HISTORY_ENABLED),
});

/** All calls are made only by explicit service operations, never from app initialization. */
export class ServerAIProvider implements AIProvider {
  private readonly endpoint = `${import.meta.env.BASE_URL}api/ai.php`;
  private async ask<T>(feature: string, data: unknown): Promise<T> {
    const response = await fetch(this.endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feature, data }), credentials: "same-origin",
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`AI service unavailable (${response.status})`);
    return (await response.json() as { result: T }).result;
  }
  advisors(data: AdvisorsRequest): Promise<readonly Advice[]> { return this.ask("advisors", data); }
  freePolicy(data: FreePolicyRequest): Promise<FreePolicyResult> { return this.ask("freePolicy", data); }
  news(data: NewsRequest): Promise<NewsStory> { return this.ask("news", data); }
  history(data: HistoryRequest): Promise<NationHistory> { return this.ask("history", data); }
}

export function createBrowserAIService(flags: AIFlags = aiFlags): AIService {
  const provider = import.meta.env.VITE_AI_PROVIDER === "openai" ? new ServerAIProvider() : new MockAIProvider();
  return new AIService(provider, flags);
}
