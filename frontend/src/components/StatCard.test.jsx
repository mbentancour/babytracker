import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import StatCard from "./StatCard";

afterEach(cleanup);

describe("StatCard", () => {
  // The Growth averages put three short lines under the figure. Laid out as a
  // row they ran together into one ("per day (30d)Nap: 2h 45mNight sleep: …").
  it("keeps a second line made of several lines as separate lines", () => {
    render(
      <StatCard
        label="Avg sleep"
        value="11.6h"
        color="#8B5CF6"
        sub={
          <>
            <div>per day (30d)</div>
            <div>Nap: 2h 45m</div>
            <div>Night sleep: 8h 54m</div>
          </>
        }
      />,
    );
    const lines = screen.getByText("per day (30d)").parentElement;
    expect(lines.children.length).toBe(3);
    expect(lines.style.display).toBe("flex");
    expect(lines.style.flexDirection).toBe("column");
  });

  it("leaves the second line out when there is nothing to put in it", () => {
    const { container } = render(<StatCard label="Avg sleep" value="11.6h" color="#8B5CF6" />);
    expect(container.textContent).toBe("Avg sleep11.6h");
  });
});
