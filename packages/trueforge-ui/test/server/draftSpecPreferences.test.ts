// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { withCapabilitiesSandbox } from "@/server/draftSpecPreferences.js";

describe("withCapabilitiesSandbox", () => {
  it("adds sandbox config when config is missing", () => {
    expect(withCapabilitiesSandbox({ model: { name: "model" } }, { enabled: true })).toEqual({
      model: { name: "model" },
      config: { sandbox: { enabled: true } },
    });
  });

  it("preserves other runtime config", () => {
    expect(
      withCapabilitiesSandbox(
        {
          model: { name: "model" },
          config: { askUserQuestions: { enabled: false } },
        },
        { enabled: true },
      ),
    ).toEqual({
      model: { name: "model" },
      config: {
        askUserQuestions: { enabled: false },
        sandbox: { enabled: true },
      },
    });
  });

  it("overrides a spec-owned sandbox flag from capabilities", () => {
    expect(
      withCapabilitiesSandbox(
        withCapabilitiesSandbox({ model: { name: "model" } }, { enabled: true }),
        { enabled: false },
      ),
    ).toEqual({
      model: { name: "model" },
      config: { sandbox: { enabled: false } },
    });
  });
});
