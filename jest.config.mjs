import nextJest from "next/jest.js";

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
    "components/auth/**/*.{ts,tsx}",
    "!components/auth/**/*.d.ts",
    "components/checkin/**/*.{ts,tsx}",
    "!components/checkin/**/*.d.ts",
    "components/FavoriteButton.tsx",
    "app/actions/**/*.{ts,tsx}",
    "app/api/**/*.{ts,tsx}",
    "lib/geo.ts",
    "lib/timezone.ts",
    "middleware.ts",
  ],
};

export default createJestConfig(customConfig);
