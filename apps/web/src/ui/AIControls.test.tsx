import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AIService, MockAIProvider } from "@macro-nation/advisor-core";
import { AIControls } from "./AIControls";

const facts = { month: 4, indicators: { inflation: 0.048, unemployment: 0.031 }, causes: [], recentEvents: [] };
const expert = { id: "labor", role: "雇用", values: "雇用", tone: "やさしい" };

describe("optional AI controls", () => {
  it("shows ordinary news on mount and calls providers only after the user clicks", async () => {
    const provider = new MockAIProvider();
    const advisors = vi.spyOn(provider, "advisors");
    const news = vi.spyOn(provider, "news");
    const history = vi.spyOn(provider, "history");
    const service = new AIService(provider, { enabled: true, advisors: true, freePolicy: true, news: true, history: true });
    render(<AIControls service={service} facts={facts} experts={[expert]} finished />);
    expect(screen.getByText("物価の上昇が家計に影響")).toBeInTheDocument();
    expect(advisors).not.toHaveBeenCalled();
    expect(news).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "なぜこうなった？" }));
    await waitFor(() => expect(news).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "専門家の意見を聞く" }));
    await waitFor(() => expect(advisors).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "国家史を生成" }));
    await waitFor(() => expect(history).toHaveBeenCalledTimes(1));
  });
});
