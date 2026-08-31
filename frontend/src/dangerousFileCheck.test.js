// Unit tests for dangerousFileCheck.js
//
// NOT YET EXECUTABLE — no test runner is installed in this project.
// To activate: run `npm install -D vitest` and add `"test": "vitest"` to
// the "scripts" section of package.json, then run `npm test`.
//
// These tests are here as a documented specification of expected behavior,
// not just a manual click-through. Keeping them here (even dormant) means
// they're ready to run the moment a test runner is added, and they serve
// as clear documentation of exactly what the dangerous-file check must do.

import { describe, test, expect } from "vitest";
import { checkDangerousFile, buildDangerousFileVerdict } from "./dangerousFileCheck";

describe("checkDangerousFile", () => {
  // --- must flag (returns true) ---
  test("flags .apk files", () => expect(checkDangerousFile("virus.apk")).toBe(true));
  test("flags .apks files", () => expect(checkDangerousFile("bundle.apks")).toBe(true));
  test("flags .exe files", () => expect(checkDangerousFile("setup.exe")).toBe(true));
  test("flags .msi files", () => expect(checkDangerousFile("installer.msi")).toBe(true));
  test("flags .bat files", () => expect(checkDangerousFile("run.bat")).toBe(true));
  test("flags .sh files", () => expect(checkDangerousFile("script.sh")).toBe(true));
  test("flags .jar files", () => expect(checkDangerousFile("app.jar")).toBe(true));
  test("is case-insensitive (.APK)", () => expect(checkDangerousFile("VIRUS.APK")).toBe(true));
  test("is case-insensitive (.Apk)", () => expect(checkDangerousFile("Virus.Apk")).toBe(true));

  // --- must NOT flag (returns false) ---
  test("does not flag .png images", () => expect(checkDangerousFile("photo.png")).toBe(false));
  test("does not flag .jpg images", () => expect(checkDangerousFile("screenshot.jpg")).toBe(false));
  test("does not flag .pdf files", () => expect(checkDangerousFile("doc.pdf")).toBe(false));
  test("returns false for empty string", () => expect(checkDangerousFile("")).toBe(false));
  test("returns false for null/undefined", () => {
    expect(checkDangerousFile(null)).toBe(false);
    expect(checkDangerousFile(undefined)).toBe(false);
  });
});

describe("buildDangerousFileVerdict", () => {
  test("returns scam verdict for English", () => {
    const v = buildDangerousFileVerdict("en");
    expect(v.verdict).toBe("scam");
    expect(v.confidence).toBe(98);
    expect(Array.isArray(v.red_flags)).toBe(true);
    expect(Array.isArray(v.advice)).toBe(true);
  });

  test("returns scam verdict for Telugu", () => {
    const v = buildDangerousFileVerdict("te");
    expect(v.verdict).toBe("scam");
    expect(v.confidence).toBe(98);
    // Telugu reasoning should contain Telugu characters
    const hasTeluguChars = /[\u0C00-\u0C7F]/.test(v.reasoning);
    expect(hasTeluguChars).toBe(true);
  });
});
