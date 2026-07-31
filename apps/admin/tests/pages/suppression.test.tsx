jest.mock("@/lib/api/email", () => ({
  emailApi: {
    listSuppression: jest.fn(),
    addSuppression: jest.fn(),
  },
}));

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emailApi } from "@/lib/api/email";
import SuppressionPage from "@/app/(dashboard)/suppression/page";
import { renderWithQueryClient } from "../test-utils";

describe("SuppressionPage", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders existing suppression entries", async () => {
    (emailApi.listSuppression as jest.Mock).mockResolvedValue({
      items: [{ id: "1", email: "bad@example.com", reason: "bounced", source: null, createdAt: new Date().toISOString() }],
    });

    renderWithQueryClient(<SuppressionPage />);

    expect(await screen.findByText("bad@example.com")).toBeInTheDocument();
  });

  it("shows an empty state when there are no suppressed addresses", async () => {
    (emailApi.listSuppression as jest.Mock).mockResolvedValue({ items: [] });

    renderWithQueryClient(<SuppressionPage />);

    expect(await screen.findByText("No suppressed addresses")).toBeInTheDocument();
  });

  it("validates the email field before allowing submission", async () => {
    (emailApi.listSuppression as jest.Mock).mockResolvedValue({ items: [] });
    const user = userEvent.setup();

    renderWithQueryClient(<SuppressionPage />);

    await user.click(await screen.findByRole("button", { name: /add address/i }));
    await user.type(await screen.findByLabelText(/email/i), "not-an-email");
    await user.click(screen.getByRole("button", { name: /add to suppression list/i }));

    expect(await screen.findByText(/must be a valid email/i)).toBeInTheDocument();
    expect(emailApi.addSuppression).not.toHaveBeenCalled();
  });

  it("submits a valid suppression entry", async () => {
    (emailApi.listSuppression as jest.Mock).mockResolvedValue({ items: [] });
    (emailApi.addSuppression as jest.Mock).mockResolvedValue({
      id: "2",
      email: "unsub@example.com",
      reason: "manual",
      source: null,
      createdAt: new Date().toISOString(),
    });
    const user = userEvent.setup();

    renderWithQueryClient(<SuppressionPage />);

    await user.click(await screen.findByRole("button", { name: /add address/i }));
    await user.type(await screen.findByLabelText(/email/i), "unsub@example.com");
    await user.click(screen.getByRole("button", { name: /add to suppression list/i }));

    await waitFor(() => expect(emailApi.addSuppression).toHaveBeenCalled());
    const calls = (emailApi.addSuppression as jest.Mock).mock.calls;
    const matchingCall = calls.find(([arg]) => arg?.email === "unsub@example.com");
    expect(matchingCall).toBeDefined();
    expect(matchingCall![0]).toMatchObject({ email: "unsub@example.com", reason: "manual" });
  });
});
