import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SimplePager } from "@/components/simple-pager";

describe("SimplePager", () => {
  it("disables 'Prev' on the first page", () => {
    render(<SimplePager page={1} pageSize={20} total={50} onPageChange={jest.fn()} />);
    expect(screen.getByRole("button", { name: /previous page/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /next page/i })).toBeEnabled();
  });

  it("disables 'Next' on the last page", () => {
    render(<SimplePager page={3} pageSize={20} total={50} onPageChange={jest.fn()} />);
    expect(screen.getByRole("button", { name: /next page/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /previous page/i })).toBeEnabled();
  });

  it("calls onPageChange with the incremented/decremented page", async () => {
    const user = userEvent.setup();
    const onPageChange = jest.fn();
    render(<SimplePager page={2} pageSize={20} total={100} onPageChange={onPageChange} />);

    await user.click(screen.getByRole("button", { name: /next page/i }));
    expect(onPageChange).toHaveBeenCalledWith(3);

    await user.click(screen.getByRole("button", { name: /previous page/i }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("shows '0 results' when total is 0", () => {
    render(<SimplePager page={1} pageSize={20} total={0} onPageChange={jest.fn()} />);
    expect(screen.getByText("0 results")).toBeInTheDocument();
  });
});
