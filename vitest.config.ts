import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["src/{domain,server}/**/*.test.ts", "scripts/**/*.test.mjs"],
          environment: "node",
        },
      },
      {
        test: {
          name: "web",
          include: ["src/web/**/*.test.{ts,tsx}"],
          environment: "jsdom",
        },
      },
    ],
  },
});
