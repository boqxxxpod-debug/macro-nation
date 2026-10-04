import { webcrypto } from "node:crypto";
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { GameState } from "@macro-nation/domain";
import { createGame } from "../application/game-service";
import { createReservedPolicy } from "../application/policy-view";
import { Ending } from "./Ending";

vi.mock("./PageDeck", () => ({
  PageDeck: ({
    label,
    children,
    actions,
  }: {
    label: string;
    children: ReactNode;
    actions?: ReactNode;
  }) => (
    <section aria-label={label}>
      {children}
      {actions}
    </section>
  ),
}));

let initial: GameState;
beforeAll(async () => {
  vi.stubGlobal("crypto", webcrypto);
  initial = await createGame(
    { load: async () => null, create: async () => {}, save: async () => {} },
    "issue-90-ending-copy",
  );
});
afterEach(cleanup);

describe("ending wording", () => {
  it.each(["completed", "failed"] as const)(
    "distinguishes %s from the other ending reason",
    (runState) => {
      const onReport = vi.fn();
      render(<Ending state={{ ...initial, runState }} onReport={onReport} />);
      expect(screen.getByRole("status").textContent).toMatchSnapshot();
      if (runState === "completed") {
        expect(screen.getByRole("status")).toHaveTextContent(
          `${initial.clock.endMonth}か月の運営期間`,
        );
        expect(screen.getByRole("status")).not.toHaveTextContent("危機のため");
      } else {
        expect(screen.getByRole("status")).toHaveTextContent(
          "危機のため国家運営を終了しました",
        );
        expect(screen.getByRole("status")).not.toHaveTextContent(
          "運営期間を終えました",
        );
        expect(
          screen.getByRole("heading", { name: "総合評価：F" }),
        ).toBeInTheDocument();
      }
      fireEvent.click(screen.getByRole("button", { name: "変化の理由を見る" }));
      expect(onReport).toHaveBeenCalledOnce();
    },
  );

  it("explains saved decisions and causes without exposing IDs or changing the state", () => {
    const policy = createReservedPolicy(
      initial,
      "interest-rate",
      0.05,
      "private-ending-policy",
      0,
    );
    const first = initial.history.reports![0]!;
    const state: GameState = {
      ...initial,
      runState: "failed",
      monthIndex: 2,
      policies: { ...initial.policies, reserved: [policy] },
      history: {
        ...initial.history,
        reports: [
          first,
          {
            ...first,
            monthIndex: 2,
            values: { ...first.values, realGdp: 110 },
            topCauses: [
              {
                indicatorId: "inflation",
                sourceType: "policy",
                sourceId: policy.policyId,
                labelKey: "private-cause-key",
                delta: 0.01,
              },
            ],
          },
        ],
      },
    };
    const before = structuredClone(state);
    const { container } = render(<Ending state={state} onReport={vi.fn()} />);
    expect(container).not.toHaveTextContent(
      /private-ending-policy|private-cause-key|ending:failed|crisis:2/,
    );
    expect(screen.getByText(/^主な判断：/).textContent).toMatchSnapshot();
    expect(
      screen.getByText(/^危機につながったこと：/).textContent,
    ).toMatchSnapshot();
    expect(screen.getByText(/^実質GDP：開始/)).toHaveTextContent(
      "100.0 → 最終 110.0",
    );
    expect(screen.getByText(/^最終月の物価上昇率には/)).toHaveTextContent(
      "政策金利",
    );
    expect(state).toEqual(before);
  });
});
