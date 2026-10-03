import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
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
    fireEvent.click(screen.getByRole("button", { name: "説明：次のページ" }));
    expect(
      screen.getByRole("region", { name: "政策の注意点" }),
    ).toHaveTextContent("次の副作用");
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
    const next = screen.getByRole("button", { name: "警告：次のページ" });
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
    fireEvent.click(screen.getByRole("button", { name: "政策：次のページ" }));
    expect(screen.queryByRole("textbox", { name: "政策名" })).toBeNull();

    availableHeight = 160;
    act(() => window.dispatchEvent(new Event("resize")));
    fireEvent.click(screen.getByRole("button", { name: "政策：前のページ" }));
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
      name: "可変レイアウト：次のページ",
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
      name: "可変レイアウト：前のページ",
    });
    while (!screen.queryByRole("textbox", { name: "政策名" })) {
      expect(previous).toBeEnabled();
      fireEvent.click(previous);
    }
    expect(screen.getByRole("textbox", { name: "政策名" })).toBe(input);
    expect(input).toHaveValue("画面サイズ変更でも保持");
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
    expect(screen.getByRole("status")).toHaveTextContent("拡大表示・全文");
    expect(
      screen.getByRole("button", { name: "拡大：前のページ" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "拡大：次のページ" }),
    ).toBeDisabled();
    for (const item of document.querySelectorAll<HTMLElement>(
      "[data-page-item]",
    )) {
      expect(item.hidden).toBe(false);
      expect(item).not.toHaveAttribute("inert");
    }
  });
});
