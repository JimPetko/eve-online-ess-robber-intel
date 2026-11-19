import { describe, expect, it } from "vitest";
import { classify } from "./tests-required.mjs";

describe("classify", () => {
  it("fails a src behaviour change with no test change", () => {
    expect(classify(["src/server/app.ts", "README.md"])).toMatchObject({
      ok: false,
      behaviour: ["src/server/app.ts"],
    });
  });

  it("passes when a test changes alongside behaviour", () => {
    expect(classify(["src/server/app.ts", "src/server/app.test.ts"]).ok).toBe(true);
    expect(classify(["src/web/App.tsx", "src/web/App.test.tsx"]).ok).toBe(true);
  });

  it("ignores type, config and asset files", () => {
    expect(
      classify(["src/web/styles.css", "src/web/index.html", "src/server/tsconfig.json", "src/x.d.ts"]).ok,
    ).toBe(true);
  });

  it("ignores files outside src", () => {
    expect(classify(["README.md", ".github/workflows/ci.yml", "scripts/merge-pr.mjs"]).ok).toBe(true);
  });

  it("passes an empty diff", () => {
    expect(classify([]).ok).toBe(true);
  });
});
