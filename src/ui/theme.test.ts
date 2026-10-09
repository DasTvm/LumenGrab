import { describe, expect, it } from "vitest";
import { parseThemePreference, themeAttribute } from "./theme";

describe("theme preference", () => {
  it("accepts only known values and falls back to the system", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
    expect(parseThemePreference("<script>")).toBe("system");
  });

  it("only forces a theme when the user chose one", () => {
    expect(themeAttribute("system")).toBeNull();
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
  });
});
