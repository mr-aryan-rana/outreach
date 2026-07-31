import { render, screen } from "@testing-library/react";
import { StatusBadge } from "@/components/status-badge";

describe("StatusBadge", () => {
  it("renders the status text with underscores replaced by spaces", () => {
    render(<StatusBadge status="pending_review" />);
    expect(screen.getByText("pending review")).toBeInTheDocument();
  });

  it("renders a known status without crashing", () => {
    render(<StatusBadge status="sent" />);
    expect(screen.getByText("sent")).toBeInTheDocument();
  });

  it("renders an unrecognized status gracefully (no style lookup crash)", () => {
    render(<StatusBadge status="some_future_status" />);
    expect(screen.getByText("some future status")).toBeInTheDocument();
  });
});
