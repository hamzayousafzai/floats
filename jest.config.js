const nextJest = require("next/jest");

const createJestConfig = nextJest({ dir: "./" });

/** @type {import('jest').Config} */
const customConfig = {
  testEnvironment: "jest-environment-jsdom",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  testMatch: ["**/__tests__/**/*.test.{ts,tsx,js,jsx}"],
  collectCoverageFrom: [
    "components/explore/**/*.{ts,tsx}",
    "!components/explore/**/*.d.ts",
    "components/profile/**/*.{ts,tsx}",
    "!components/profile/**/*.d.ts",
  ],
};

module.exports = createJestConfig(customConfig);
