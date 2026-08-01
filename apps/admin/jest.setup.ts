import "@testing-library/jest-dom";
import type { ReactNode } from "react";

// next-auth/react ships ESM that next/jest doesn't transform by default, and
// every page that calls useCan()/useCurrentUser() (src/hooks/use-can.ts)
// transitively imports it via useSession() -- mock it globally so component
// tests don't each need to know that. Defaults to an authenticated "admin"
// session (every permission granted) since most component tests are
// exercising page content/data flow, not RBAC itself -- RBAC has its own
// dedicated unit tests (tests/lib/rbac.test.ts) and Playwright E2E coverage
// (e2e/auth.spec.ts) that hit the real thing.
jest.mock("next-auth/react", () => ({
  useSession: () => ({
    data: {
      user: { id: "test-user", email: "admin@makeable.local", name: "Test Admin", role: "admin" },
      expires: "2099-01-01T00:00:00.000Z",
    },
    status: "authenticated",
  }),
  signIn: jest.fn(),
  signOut: jest.fn(),
  SessionProvider: ({ children }: { children: ReactNode }) => children,
}));
