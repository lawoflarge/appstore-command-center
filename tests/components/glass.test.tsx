// @vitest-environment jsdom
import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Stat } from "@/components/glass/Stat";

test("Stat renders label, value and delta", () => {
  render(<Stat label="Total" value="48,210" delta={+3.1} />);
  expect(screen.getByText("Total")).toBeInTheDocument();
  expect(screen.getByText("48,210")).toBeInTheDocument();
  expect(screen.getByText(/3.1/)).toBeInTheDocument();
});
