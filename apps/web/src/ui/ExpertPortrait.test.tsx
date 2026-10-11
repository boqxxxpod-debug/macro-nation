import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expertPortraitManifest } from "@macro-nation/advisor-core";
import { ExpertPortrait } from "./ExpertPortrait";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("expert portraits", () => {
  it.each(["/", "/macro-nation/"])(
    "resolves both image densities under the %s deployment base",
    (base) => {
      vi.stubEnv("BASE_URL", base);
      const portrait = expertPortraitManifest[0]!;
      render(<ExpertPortrait expertId={portrait.expertId} />);
      const image = screen.getByRole("img", { name: portrait.altText });
      expect(image).toHaveAttribute("src", `${base}${portrait.src}`);
      expect(image).toHaveAttribute(
        "srcset",
        `${base}${portrait.src} 1x, ${base}${portrait.src2x} 2x`,
      );
      expect(image).toHaveAttribute("width", "128");
      expect(image).toHaveAttribute("height", "128");
    },
  );

  it("replaces a failed image with an accessible fallback in the reserved square", () => {
    const portrait = expertPortraitManifest[0]!;
    const { container } = render(
      <ExpertPortrait expertId={portrait.expertId} />,
    );
    fireEvent.error(screen.getByRole("img", { name: portrait.altText }));
    expect(container.querySelector("img")).toBeNull();
    expect(
      screen.getByRole("img", {
        name: `${portrait.altText}（画像を表示できません）`,
      }),
    ).toHaveClass("expert-portrait", "expert-portrait-fallback");
    expect(screen.getByText("画像なし")).toBeInTheDocument();
  });

  it("does not carry an image failure over to a different expert", () => {
    const [first, second] = expertPortraitManifest;
    const { rerender } = render(<ExpertPortrait expertId={first!.expertId} />);
    fireEvent.error(screen.getByRole("img", { name: first!.altText }));
    rerender(<ExpertPortrait expertId={second!.expertId} />);
    expect(screen.getByRole("img", { name: second!.altText })).toHaveAttribute(
      "src",
      `${import.meta.env.BASE_URL}${second!.src}`,
    );
  });
});
