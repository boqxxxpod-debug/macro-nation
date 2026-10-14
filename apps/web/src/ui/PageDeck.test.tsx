import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageDeck } from "./PageDeck";

let availableHeight = 90;

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
      const height = this.hasAttribute("data-page-item") ? 60 : availableHeight;
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
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("font-size");
});

function EditingDraft() {
  const [value, setValue] = useState("未確定の政策");
  return (
    <label>
      政策名
      <input value={value} onChange={(event) => setValue(event.target.value)} />
    </label>
  );
}

describe("PageDeck accessible content and retained input", () => {
  it("preserves the accessible name of a section on every detail page", () => {
    render(
      <PageDeck label="説明">
        <section aria-labelledby="policy-warning-heading">
          <h3 id="policy-warning-heading">政策の注意点</h3>
          <p>最初の副作用</p>
          <p>次の副作用</p>
        </section>
      </PageDeck>,
    );

    expect(
      screen.getByRole("region", { name: "政策の注意点" }),
    ).toHaveTextContent("最初の副作用");
    fireEvent.click(screen.getByRole("button", { name: "説明の次のページ" }));
    expect(
      screen.getByRole("region", { name: "政策の注意点" }),
    ).toHaveTextContent("次の副作用");
    const ids = [...document.querySelectorAll("[id]")].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the complete speaker identity on every fragment of long expert advice", () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(360);
    const advice = [
      { name: "景山 めぐみ", role: "マクロ経済", tone: "段階を追って教える" },
      {
        name: "水城 静香",
        role: "中央銀行",
        tone: "落ち着いて結論から説明する",
      },
    ];
    const longReason =
      "政策の波及には時間がかかり、雇用と物価の変化も確認します。".repeat(4);
    render(
      <PageDeck label="専門家の解説">
        {advice.map((expert, index) => (
          <article
            key={expert.name}
            aria-labelledby={`speaker-${index}`}
            data-expert-name={expert.name}
          >
            <header id={`speaker-${index}`} data-page-title>
              <img
                src={`experts/${index}.webp`}
                alt={`${expert.role}の専門家`}
              />
              <div>
                <h4>{expert.role}</h4>
                <p>
                  {expert.name} · 口調：{expert.tone}
                </p>
              </div>
            </header>
            <p>結論：複数の指標を見て判断します。</p>
            <p>やさしい理由：{longReason}</p>
            <p>注意点：将来の数字には幅があります。</p>
          </article>
        ))}
      </PageDeck>,
    );
    const next = screen.getByRole("button", {
      name: "専門家の解説の次のページ",
    });
    const reached = new Map(advice.map((expert) => [expert.name, ""]));
    let pages = 0;
    do {
      const article = screen.getByRole("article");
      const expert = advice.find(
        (item) => item.name === article.getAttribute("data-expert-name"),
      )!;
      const header = article.querySelector("header")!;
      expect(within(header).getByRole("img")).toHaveAttribute(
        "alt",
        `${expert.role}の専門家`,
      );
      expect(header).toHaveTextContent(expert.name);
      expect(header).toHaveTextContent(expert.role);
      expect(header).toHaveTextContent(expert.tone);
      expect(article).toHaveAccessibleName(
        new RegExp(`${expert.role}.*${expert.name}.*${expert.tone}`),
      );
      const paragraph = article.querySelector(":scope > p")!;
      reached.set(
        expert.name,
        reached.get(expert.name)! + paragraph.textContent,
      );
      pages++;
      if (next.hasAttribute("disabled")) break;
      fireEvent.click(next);
    } while (pages < 100);
    expect(next).toBeDisabled();
    expect(pages).toBeGreaterThan(6);
    for (const expert of advice) {
      expect(reached.get(expert.name)).toBe(
        `結論：複数の指標を見て判断します。やさしい理由：${longReason}注意点：将来の数字には幅があります。`,
      );
    }
    const ids = [...document.querySelectorAll("[id]")].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reaches every part of a long Japanese paragraph and preserves links", () => {
    const text = "長い警告の理由と副作用をすべて確認する。".repeat(20);
    render(
      <PageDeck label="警告">
        <p>{text}</p>
        <p>
          根拠は<a href="#causal-report">因果レポート</a>で確認できます。
        </p>
      </PageDeck>,
    );

    const content = screen.getByLabelText("警告の内容");
    const next = screen.getByRole("button", { name: "警告の次のページ" });
    const reached: string[] = [];
    let linkReached = false;
    do {
      for (const item of content.querySelectorAll<HTMLElement>(
        "[data-page-item]",
      )) {
        if (!item.hidden) reached.push(item.textContent ?? "");
        else expect(item).toHaveAttribute("inert");
      }
      const link = screen.queryByRole("link", { name: "因果レポート" });
      if (link) {
        expect(link).toHaveAttribute("href", "#causal-report");
        linkReached = true;
      }
      if (next.hasAttribute("disabled")) break;
      fireEvent.click(next);
      expect(content).toHaveFocus();
    } while (!next.hasAttribute("disabled") || !linkReached);

    expect(reached.join("")).toBe(`${text}根拠は因果レポートで確認できます。`);
    expect(linkReached).toBe(true);
    expect(next).toHaveAttribute("aria-controls", content.id);
  });

  it("retains an edited component across page switches and height changes", () => {
    render(
      <PageDeck label="政策">
        <EditingDraft />
        <p>費用と副作用の確認</p>
        <p>専門家の助言</p>
      </PageDeck>,
    );
    const input = screen.getByRole("textbox", { name: "政策名" });
    fireEvent.change(input, { target: { value: "入力を保持する" } });
    fireEvent.click(screen.getByRole("button", { name: "政策の次のページ" }));
    expect(screen.queryByRole("textbox", { name: "政策名" })).toBeNull();

    availableHeight = 160;
    act(() => window.dispatchEvent(new Event("resize")));
    fireEvent.click(screen.getByRole("button", { name: "政策の前のページ" }));
    expect(screen.getByRole("textbox", { name: "政策名" })).toBe(input);
    expect(input).toHaveValue("入力を保持する");
    expect(screen.getByRole("status")).toHaveTextContent("1 / 2ページ");
  });

  it("retains input after an earlier long paragraph is repaginated", () => {
    render(
      <PageDeck label="可変レイアウト">
        <p>{"長い政策説明を読みながら入力する。".repeat(8)}</p>
        <EditingDraft />
      </PageDeck>,
    );
    const next = screen.getByRole("button", {
      name: "可変レイアウトの次のページ",
    });
    while (!screen.queryByRole("textbox", { name: "政策名" })) {
      expect(next).toBeEnabled();
      fireEvent.click(next);
    }
    const input = screen.getByRole("textbox", { name: "政策名" });
    fireEvent.change(input, { target: { value: "画面サイズ変更でも保持" } });

    availableHeight = 250;
    act(() => window.dispatchEvent(new Event("resize")));
    const previous = screen.getByRole("button", {
      name: "可変レイアウトの前のページ",
    });
    while (!screen.queryByRole("textbox", { name: "政策名" })) {
      expect(previous).toBeEnabled();
      fireEvent.click(previous);
    }
    expect(screen.getByRole("textbox", { name: "政策名" })).toBe(input);
    expect(input).toHaveValue("画面サイズ変更でも保持");
  });

  it("keeps edited input and pagination when available space temporarily reaches zero", () => {
    render(
      <PageDeck label="空間が変わる政策">
        <EditingDraft />
        <p>費用と副作用</p>
      </PageDeck>,
    );
    const input = screen.getByRole("textbox", { name: "政策名" });
    fireEvent.change(input, { target: { value: "編集を保持" } });
    const next = screen.getByRole("button", {
      name: "空間が変わる政策の次のページ",
    });
    expect(next).toBeEnabled();
    availableHeight = 0;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(next).toBeEnabled();
    expect(screen.getByRole("status")).not.toHaveTextContent("全文を表示");
    availableHeight = 160;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(screen.getByRole("textbox", { name: "政策名" })).toBe(input);
    expect(input).toHaveValue("編集を保持");
  });

  it("exposes all information at 200% text size without discarding input", () => {
    render(
      <PageDeck label="拡大">
        <EditingDraft />
        <p>必要な費用と副作用</p>
        <button type="button">危機への対応</button>
      </PageDeck>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "政策名" }), {
      target: { value: "拡大後も保持" },
    });
    document.documentElement.style.fontSize = "32px";
    act(() => window.dispatchEvent(new Event("resize")));

    expect(screen.getByRole("textbox", { name: "政策名" })).toHaveValue(
      "拡大後も保持",
    );
    expect(screen.getByText("必要な費用と副作用")).toBeVisible();
    expect(screen.getByRole("button", { name: "危機への対応" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "全文を表示しています",
    );
    expect(
      screen.getByRole("button", { name: "拡大の前のページ" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "拡大の次のページ" }),
    ).toBeDisabled();
    for (const item of document.querySelectorAll<HTMLElement>(
      "[data-page-item]",
    )) {
      expect(item.hidden).toBe(false);
      expect(item).not.toHaveAttribute("inert");
    }
  });
});


describe("PageDeck category navigation", () => {
  const categories = [
    {
      id: "summary",
      label: "判断要約",
      content: (
        <>
          <p>判断の要約</p>
          <p>重要な注意点</p>
        </>
      ),
    },
    {
      id: "comparison",
      label: "現状維持との比較",
      content: <p>現状維持との差</p>,
    },
    {
      id: "experts",
      label: "専門家",
      content: (
        <>
          <p>専門家の判断</p>
          <button type="button">専門家の根拠を確認</button>
        </>
      ),
    },
  ];

  it("jumps directly to a category and keeps hidden content outside keyboard and AT navigation", () => {
    render(<PageDeck label="政策プレビュー" categories={categories} />);
    const navigation = screen.getByRole("combobox", {
      name: "政策プレビューのカテゴリ",
    });
    const content = screen.getByLabelText("政策プレビューの内容");
    const status = screen.getByRole("status");
    expect(navigation).toHaveValue("summary");
    expect(status).toHaveTextContent("判断要約 · 1 / 2ページ");
    expect(navigation).toHaveAttribute("aria-controls", content.id);
    expect(navigation).toHaveAttribute("aria-describedby", status.id);
    expect(content).toHaveAttribute("aria-describedby", status.id);
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(
      screen.queryByRole("button", { name: "専門家の根拠を確認" }),
    ).toBeNull();

    navigation.focus();
    fireEvent.change(navigation, { target: { value: "experts" } });
    expect(navigation).toHaveValue("experts");
    expect(content).toHaveAttribute("data-page-category", "experts");
    expect(content).toHaveAttribute("data-page-current", "4");
    expect(status).toHaveTextContent("専門家 · 1 / 2ページ");
    expect(screen.getByText("専門家の判断")).toBeVisible();
    expect(screen.getByText("判断の要約")).not.toBeVisible();
    expect(content).toHaveFocus();
    for (const item of content.querySelectorAll<HTMLElement>("[data-page-item]")) {
      if (item.hidden) expect(item).toHaveAttribute("inert");
      else expect(item).not.toHaveAttribute("inert");
    }

    fireEvent.click(
      screen.getByRole("button", { name: "政策プレビューの次のページ" }),
    );
    expect(status).toHaveTextContent("専門家 · 2 / 2ページ");
    expect(
      screen.getByRole("button", { name: "専門家の根拠を確認" }),
    ).toBeVisible();
    expect(content).toHaveFocus();
  });

  it("updates the category and local page position when moving in either direction", () => {
    render(<PageDeck label="政策プレビュー" categories={categories} />);
    const navigation = screen.getByRole("combobox", {
      name: "政策プレビューのカテゴリ",
    });
    const content = screen.getByLabelText("政策プレビューの内容");
    const next = screen.getByRole("button", {
      name: "政策プレビューの次のページ",
    });
    const previous = screen.getByRole("button", {
      name: "政策プレビューの前のページ",
    });
    expect(previous).toBeDisabled();
    fireEvent.click(next);
    expect(navigation).toHaveValue("summary");
    expect(screen.getByRole("status")).toHaveTextContent("判断要約 · 2 / 2ページ");
    expect(content).toHaveFocus();
    fireEvent.click(next);
    expect(navigation).toHaveValue("comparison");
    expect(screen.getByRole("status")).toHaveTextContent(
      "現状維持との比較 · 1 / 1ページ",
    );
    expect(content).toHaveFocus();
    fireEvent.click(previous);
    expect(navigation).toHaveValue("summary");
    expect(screen.getByRole("status")).toHaveTextContent("判断要約 · 2 / 2ページ");
    expect(content).toHaveFocus();

    fireEvent.change(navigation, { target: { value: "experts" } });
    fireEvent.change(navigation, { target: { value: "summary" } });
    expect(screen.getByText("判断の要約")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("判断要約 · 1 / 2ページ");
    expect(previous).toBeDisabled();
    expect(content).toHaveFocus();
  });

  it("starts each category on a fresh page even when several categories could fit", () => {
    availableHeight = 250;
    render(<PageDeck label="政策プレビュー" categories={categories} />);
    const content = screen.getByLabelText("政策プレビューの内容");
    const next = screen.getByRole("button", {
      name: "政策プレビューの次のページ",
    });
    expect(screen.getByText("判断の要約")).toBeVisible();
    expect(screen.getByText("重要な注意点")).toBeVisible();
    expect(screen.getByText("現状維持との差")).not.toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("判断要約 · 1 / 1ページ");
    expect(next).toBeEnabled();
    fireEvent.click(next);
    expect(content).toHaveAttribute("data-page-current", "2");
    expect(screen.getByText("現状維持との差")).toBeVisible();
    expect(screen.getByText("判断の要約")).not.toBeVisible();
    expect(screen.getByRole("combobox")).toHaveValue("comparison");
  });

  it("keeps the current category and item when earlier categories are repaginated", () => {
    render(<PageDeck label="政策プレビュー" categories={categories} />);
    const navigation = screen.getByRole("combobox", {
      name: "政策プレビューのカテゴリ",
    });
    const content = screen.getByLabelText("政策プレビューの内容");
    fireEvent.change(navigation, { target: { value: "experts" } });
    fireEvent.click(
      screen.getByRole("button", { name: "政策プレビューの次のページ" }),
    );
    const target = screen.getByRole("button", { name: "専門家の根拠を確認" });
    expect(content).toHaveAttribute("data-page-current", "5");
    expect(screen.getByRole("status")).toHaveTextContent("専門家 · 2 / 2ページ");

    availableHeight = 250;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(navigation).toHaveValue("experts");
    expect(content).toHaveAttribute("data-page-category", "experts");
    expect(content).toHaveAttribute("data-page-current", "3");
    expect(target).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("専門家 · 1 / 1ページ");

    availableHeight = 90;
    act(() => window.dispatchEvent(new Event("resize")));
    expect(navigation).toHaveValue("experts");
    expect(screen.getByRole("status")).toHaveTextContent("専門家 · 1 / 2ページ");
    expect(screen.getByText("専門家の判断")).toBeVisible();
  });

  it("omits empty categories and offers no category control for an empty deck", () => {
    const { rerender } = render(
      <PageDeck
        label="レポート"
        categories={[
          { id: "null", label: "未作成", content: null },
          {
            id: "fragment",
            label: "未発生",
            content: <>{false}{null}</>,
          },
          { id: "array", label: "記録なし", content: [null, false] },
          { id: "trend", label: "推移", content: <p>経済指標の推移</p> },
        ]}
      />,
    );
    const navigation = screen.getByRole("combobox", { name: "レポートのカテゴリ" });
    expect(within(navigation).getAllByRole("option")).toHaveLength(1);
    expect(within(navigation).getByRole("option", { name: "推移" })).toHaveValue(
      "trend",
    );
    expect(screen.getByRole("status")).toHaveTextContent("推移 · 1 / 1ページ");
    rerender(<PageDeck label="レポート" categories={[]} />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("1 / 1ページ");
    expect(screen.getByRole("button", { name: "レポートの前のページ" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "レポートの次のページ" })).toBeDisabled();
  });

  it("retains edited state across category jumps and repagination", () => {
    render(
      <PageDeck
        label="政策"
        categories={[
          { id: "draft", label: "入力", content: <EditingDraft /> },
          {
            id: "advice",
            label: "助言",
            content: <p>{"判断の理由を詳しく確認します。".repeat(8)}</p>,
          },
        ]}
      />,
    );
    const input = screen.getByRole("textbox", { name: "政策名" });
    const navigation = screen.getByRole("combobox", { name: "政策のカテゴリ" });
    fireEvent.change(input, { target: { value: "カテゴリ切替でも保持" } });
    fireEvent.change(navigation, { target: { value: "advice" } });
    expect(screen.queryByRole("textbox", { name: "政策名" })).toBeNull();
    availableHeight = 250;
    act(() => window.dispatchEvent(new Event("resize")));
    fireEvent.change(navigation, { target: { value: "draft" } });
    expect(screen.getByRole("textbox", { name: "政策名" })).toBe(input);
    expect(input).toHaveValue("カテゴリ切替でも保持");
  });

  it("focuses and scrolls to a category at 200% text size and preserves it after resizing", () => {
    document.documentElement.style.fontSize = "32px";
    render(
      <PageDeck
        label="拡大レポート"
        categories={[
          { id: "draft", label: "入力", content: <EditingDraft /> },
          {
            id: "history",
            label: "国家史",
            content: (
              <>
                <p>最初の節目</p>
                <p>次の節目</p>
              </>
            ),
          },
        ]}
      />,
    );
    const input = screen.getByRole("textbox", { name: "政策名" });
    fireEvent.change(input, { target: { value: "拡大時も編集を保持" } });
    const navigation = screen.getByRole("combobox", {
      name: "拡大レポートのカテゴリ",
    });
    const content = screen.getByLabelText("拡大レポートの内容");
    const anchor = content.querySelector<HTMLElement>(
      '[data-page-category-start="history"]',
    )!;
    const scroll = vi.fn();
    anchor.scrollIntoView = scroll;
    navigation.focus();
    fireEvent.change(navigation, { target: { value: "history" } });
    expect(navigation).toHaveValue("history");
    expect(anchor).toHaveFocus();
    expect(anchor).toHaveAccessibleName("国家史");
    expect(scroll).toHaveBeenCalledWith({ block: "start", behavior: "auto" });
    expect(screen.getByRole("status")).toHaveTextContent(
      "国家史 · 全文を表示しています",
    );
    expect(screen.getByText("最初の節目")).toBeVisible();
    expect(screen.getByText("次の節目")).toBeVisible();
    for (const item of content.querySelectorAll<HTMLElement>("[data-page-item]")) {
      expect(item.hidden).toBe(false);
      expect(item).not.toHaveAttribute("inert");
    }
    expect(screen.getByRole("button", { name: "拡大レポートの前のページ" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "拡大レポートの次のページ" })).toBeDisabled();

    document.documentElement.style.fontSize = "16px";
    act(() => window.dispatchEvent(new Event("resize")));
    expect(navigation).toHaveValue("history");
    expect(content).toHaveAttribute("data-page-current", "2");
    expect(screen.getByRole("status")).toHaveTextContent("国家史 · 1 / 2ページ");
    expect(screen.getByText("最初の節目")).toBeVisible();
    expect(screen.getByText("次の節目")).not.toBeVisible();
    fireEvent.change(navigation, { target: { value: "draft" } });
    expect(screen.getByRole("textbox", { name: "政策名" })).toBe(input);
    expect(input).toHaveValue("拡大時も編集を保持");
  });
});
