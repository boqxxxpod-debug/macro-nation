import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIService, MockAIProvider } from "@macro-nation/advisor-core";
import { AIControls } from "./AIControls";

const facts = {
  month: 4,
  indicators: { inflation: 0.048, unemployment: 0.031 },
  causes: [],
  recentEvents: [],
};
const expert = {
  id: "labor",
  displayName: "働木 あゆみ",
  role: "雇用",
  values: "雇用",
  tone: "やさしい",
};

afterEach(cleanup);

describe("optional AI controls", () => {
  it("shows ordinary news on mount and calls providers only after the user clicks", async () => {
    const provider = new MockAIProvider();
    const advisors = vi.spyOn(provider, "advisors");
    const news = vi.spyOn(provider, "news");
    const history = vi.spyOn(provider, "history");
    const freePolicy = vi.spyOn(provider, "freePolicy");
    const onCandidate = vi.fn();
    const service = new AIService(provider, {
      enabled: true,
      advisors: true,
      freePolicy: true,
      news: true,
      history: true,
    });
    render(
      <AIControls
        service={service}
        facts={facts}
        experts={[expert]}
        finished
        onCandidate={onCandidate}
      />,
    );
    expect(screen.getByText(/AI連携が有効な場合/)).toBeInTheDocument();
    expect(
      screen.getByText(/個人情報は入力しないでください/),
    ).toBeInTheDocument();
    expect(screen.getByText(/AIが使えないときも/)).toBeInTheDocument();
    expect(
      screen.getByText("物価上昇と家計の負担に注目です"),
    ).toBeInTheDocument();
    expect(screen.getByText(/^解説：/)).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "働木 あゆみ（雇用）" }),
    ).toBeChecked();
    expect(advisors).not.toHaveBeenCalled();
    expect(news).not.toHaveBeenCalled();
    expect(history).not.toHaveBeenCalled();
    expect(freePolicy).not.toHaveBeenCalled();
    expect(onCandidate).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "ニュースの理由を聞く" }),
    );
    await waitFor(() => expect(news).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "専門家の意見を聞く" }));
    await waitFor(() => expect(advisors).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole("heading", { name: "働木 あゆみ" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "国の歩みを文章にする" }),
    );
    await waitFor(() => expect(history).toHaveBeenCalledTimes(1));
    fireEvent.change(
      screen.getByRole("textbox", { name: "政策のアイデアを入力する" }),
      {
        target: { value: "政策金利を2%に" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "政策案を作る" }));
    await waitFor(() =>
      expect(freePolicy).toHaveBeenCalledWith({ text: "政策金利を2%に" }),
    );
    await waitFor(() => expect(onCandidate).toHaveBeenCalledOnce());
    expect(onCandidate.mock.calls[0]?.[0].candidate).toEqual({
      policyType: "interestRate",
      targetRate: 0.02,
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "確定するまで政策は実行されません",
    );
  });

  it("selects several of the eight experts in one request and caps the selection at three", async () => {
    const provider = new MockAIProvider();
    const advisors = vi.spyOn(provider, "advisors");
    const service = new AIService(provider, {
      enabled: true,
      advisors: true,
      freePolicy: true,
      news: true,
      history: true,
    });
    const experts = Array.from({ length: 8 }, (_, id) => ({
      id: `expert-${id}`,
      role: `専門家${id}`,
      values: expert.values,
      tone: expert.tone,
    }));
    render(<AIControls service={service} facts={facts} experts={experts} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "専門家1" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "専門家2" }));
    expect(screen.getByRole("checkbox", { name: "専門家3" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "専門家の意見を聞く" }));
    await waitFor(() => expect(advisors).toHaveBeenCalledTimes(1));
    expect(advisors.mock.calls[0]?.[0].experts.map((item) => item.id)).toEqual([
      "expert-0",
      "expert-1",
      "expert-2",
    ]);
  });

  it("keeps ordinary news in the supplied game's content version as facts change", () => {
    const provider = new MockAIProvider();
    const news = vi.spyOn(provider, "news");
    const service = new AIService(provider, {
      enabled: false,
      advisors: false,
      freePolicy: false,
      news: false,
      history: false,
    });
    const { rerender } = render(
      <AIControls
        service={service}
        facts={facts}
        experts={[expert]}
        contentVersion="1.1.0"
      />,
    );
    expect(
      screen.getByRole("heading", { name: "物価の上昇が家計に影響" }),
    ).toBeVisible();
    const nextFacts = {
      ...facts,
      month: 5,
      indicators: { inflation: 0.02, unemployment: 0.08 },
    };
    rerender(
      <AIControls
        service={service}
        facts={nextFacts}
        experts={[expert]}
        contentVersion="1.1.0"
      />,
    );
    expect(
      screen.getByRole("heading", { name: "雇用情勢に注意" }),
    ).toBeVisible();
    rerender(
      <AIControls
        service={service}
        facts={nextFacts}
        experts={[expert]}
        contentVersion="1.2.0"
      />,
    );
    expect(
      screen.getByRole("heading", { name: "雇用の変化に注意が必要です" }),
    ).toBeVisible();
    expect(news).not.toHaveBeenCalled();
  });
});
