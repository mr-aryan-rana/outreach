module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/tests/integration/"],
  setupFiles: ["<rootDir>/tests/setupEnv.ts"],
};
