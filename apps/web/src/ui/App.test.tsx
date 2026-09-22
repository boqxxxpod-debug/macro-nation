import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "./App";

describe("App shell", () => {
  it("renders the foundation state from the application layer", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "MACRO NATION" })).toBeInTheDocument();
    expect(screen.getByText("headless-ready")).toBeInTheDocument();
    expect(screen.getByText("offline shell enabled")).toBeInTheDocument();
  });
});
