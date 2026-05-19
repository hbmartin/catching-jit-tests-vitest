import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "istanbul",
      reporter: ["lcov", "text"],
      include: ["source/**/*.ts"],
      exclude: ["test/**/*.test.ts"],
      thresholds: {
        branches: 75,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
});
