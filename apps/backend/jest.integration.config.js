module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/tests/integration/**/*.test.ts"],
  setupFiles: ["<rootDir>/tests/integration/setupIntegrationEnv.ts"],
};
