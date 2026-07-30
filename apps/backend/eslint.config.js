// @ts-check
const tseslint = require("typescript-eslint");

module.exports = tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Route handlers, error-shape helpers, and cross-service payloads
      // intentionally use `any` at a few well-understood boundaries
      // (req/res augmentation, JSON parsing); banning it outright would
      // force noisy casts without catching real bugs here.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Jest's jest.resetModules() + require() is the standard way to reload a
    // module under a changed env var mid-test; a static import can't do this.
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  }
);
