import { render, screen } from "@testing-library/react";
import { Users } from "lucide-react";
import { EmptyState } from "@/components/empty-state";

describe("EmptyState", () => {
  it("renders the title and description", () => {
    render(<EmptyState icon={Users} title="No creators found" description="Try a different filter." />);
    expect(screen.getByText("No creators found")).toBeInTheDocument();
    expect(screen.getByText("Try a different filter.")).toBeInTheDocument();
  });

  it("renders without a description or action", () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("renders the provided action", () => {
    render(<EmptyState title="Empty" action={<button>Retry</button>} />);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
