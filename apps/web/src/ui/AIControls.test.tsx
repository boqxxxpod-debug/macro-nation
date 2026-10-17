import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AIService,
  MockAIProvider,
  type NewsStory,
} from "@macro-nation/advisor-core";
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

describe("paginated AI controls", () => {
  let availableHeight = 90;
  const label = "開発用AIプレビュー";

  beforeEach(() => {
    availableHeight = 90;
    document.documentElement.style.fontSize = "16px";
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains("page-content") ? availableHeight : 60;
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(320);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const height = this.hasAttribute("data-page-item")
          ? 60
          : availableHeight;
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 320,
          bottom: height,
          width: 320,
          height,
          toJSON: () => ({}),
        };
      },
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.style.removeProperty("font-size");
  });

  function jump(category: string) {
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: category },
    });
  }

  function reveal(role: "textbox" | "checkbox" | "button", name: string) {
    const next = screen.getByRole("button", { name: `${label}の次のページ` });
    for (let page = 0; page < 100; page++) {
      const target = screen.queryByRole(role, { name });
      if (target) return target;
      expect(next).toBeEnabled();
      fireEvent.click(next);
    }
    throw new Error(`Could not reach ${name}`);
  }

  function serviceFor(provider: MockAIProvider) {
    return new AIService(provider, {
      enabled: true,
      advisors: true,
      freePolicy: true,
      news: true,
      history: true,
    });
  }

  it("keeps drafts and expert selections through page, category and height changes without requesting AI", () => {
    const provider = new MockAIProvider();
    const requests = [
      vi.spyOn(provider, "advisors"),
      vi.spyOn(provider, "news"),
      vi.spyOn(provider, "freePolicy"),
      vi.spyOn(provider, "history"),
    ];
    const onClose = vi.fn();
    render(
      <AIControls
        service={serviceFor(provider)}
        facts={facts}
        experts={[expert, { ...expert, id: "second", displayName: "二人目" }]}
        pagination={{
          label,
          introduction: <p>開発用Mockプレビュー</p>,
          actions: <button onClick={onClose}>閉じる</button>,
        }}
      />,
    );
    expect(screen.getByText("開発用Mockプレビュー")).toBeVisible();
    expect(screen.queryByRole("option", { name: "国家史" })).toBeNull();
    const content = screen.getByLabelText(`${label}の内容`);
    expect(
      content.querySelectorAll(":scope > [data-page-item]").length,
    ).toBeGreaterThan(10);

    jump("free-policy");
    expect(content).toHaveFocus();
    const input = screen.getByRole("textbox", {
      name: "政策のアイデアを入力する",
    });
    fireEvent.change(input, { target: { value: "政策金利を2%に" } });
    fireEvent.click(
      screen.getByRole("button", { name: `${label}の次のページ` }),
    );
    expect(screen.getByRole("button", { name: "政策案を作る" })).toBeVisible();
    expect(input.closest("[data-page-item]")).toHaveAttribute("hidden");
    expect(input.closest("[data-page-item]")).toHaveAttribute("inert");

    jump("advisors");
    fireEvent.click(reveal("checkbox", "二人目（雇用）"));
    jump("news");
    availableHeight = 180;
    act(() => window.dispatchEvent(new Event("resize")));
    jump("free-policy");
    expect(screen.getByRole("textbox")).toBe(input);
    expect(input).toHaveValue("政策金利を2%に");
    jump("advisors");
    expect(reveal("checkbox", "二人目（雇用）")).toBeChecked();
    requests.forEach((request) => expect(request).not.toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "閉じる" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("retains an in-flight response after leaving its category and exposes every generated paragraph", async () => {
    const provider = new MockAIProvider();
    let resolveNews!: (story: NewsStory) => void;
    const news = vi.spyOn(provider, "news").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveNews = resolve;
        }),
    );
    const history = vi.spyOn(provider, "history").mockResolvedValue({
      title: "生成された国家史",
      narrative: "国の歩みを振り返ります。".repeat(50),
    });
    const advice = vi.spyOn(provider, "advisors").mockResolvedValue([
      {
        expertId: expert.id,
        conclusion: "生成された助言",
        reason: "政策の波及を確かめます。".repeat(10),
        caution: "副作用も確認します。",
      },
    ]);
    render(
      <AIControls
        service={serviceFor(provider)}
        facts={facts}
        experts={[expert]}
        finished
        pagination={{ label }}
      />,
    );
    jump("news");
    fireEvent.click(reveal("button", "ニュースの理由を聞く"));
    jump("advisors");
    expect(reveal("button", "専門家の意見を聞く")).toBeDisabled();
    await act(async () =>
      resolveNews({
        headline: "生成されたニュース",
        explanation: "ニュースの詳しい説明です。".repeat(20),
        perspectives: [{ viewpoint: "citizen", text: "国民からの意見です。" }],
      }),
    );
    expect(screen.getByRole("combobox")).toHaveValue("advisors");
    fireEvent.click(reveal("button", "専門家の意見を聞く"));
    await waitFor(() => expect(advice).toHaveBeenCalledOnce());
    jump("history");
    fireEvent.click(
      screen.getByRole("button", { name: "国の歩みを文章にする" }),
    );
    await waitFor(() => expect(history).toHaveBeenCalledOnce());

    const content = screen.getByLabelText(`${label}の内容`);
    for (const [category, expected] of [
      ["news", "ニュースの詳しい説明です。".repeat(20)],
      ["advisors", "政策の波及を確かめます。".repeat(10)],
      ["history", "国の歩みを振り返ります。".repeat(50)],
    ] as const) {
      jump(category);
      let visibleText = "";
      const next = screen.getByRole("button", { name: `${label}の次のページ` });
      for (let page = 0; page < 100; page++) {
        visibleText += within(content)
          .queryAllByRole("paragraph")
          .map((paragraph) => paragraph.textContent)
          .join("");
        expect(content).toHaveFocus();
        if (next.hasAttribute("disabled")) break;
        fireEvent.click(next);
        if (
          (screen.getByRole("combobox") as HTMLSelectElement).value !== category
        )
          break;
      }
      expect(visibleText).toContain(expected);
    }
    expect(news).toHaveBeenCalledOnce();
    expect(advice).toHaveBeenCalledOnce();
    expect(history).toHaveBeenCalledOnce();
  }, 15_000);
});
