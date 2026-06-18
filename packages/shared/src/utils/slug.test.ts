import { describe, it, expect } from "vitest";
import { generateCompanySlug, isValidSlug } from "./slug.ts";

describe("generateCompanySlug", () => {
  it("lowercases the name", () => {
    const slug = generateCompanySlug("Acme Corp");
    // Slug starts with the lowercased base — ends with a 4-char random suffix.
    expect(slug).toMatch(/^acme-corp-[a-z0-9]{4}$/);
  });

  it("replaces spaces with hyphens", () => {
    const slug = generateCompanySlug("hello world");
    expect(slug).toMatch(/^hello-world-/);
  });

  it("removes special characters", () => {
    const slug = generateCompanySlug("My Company! & Partners");
    expect(slug).not.toMatch(/[!&]/);
  });

  it("collapses multiple spaces into one hyphen", () => {
    const slug = generateCompanySlug("too   many   spaces");
    expect(slug).not.toMatch(/--/);
  });

  it("truncates base to 40 chars before the random suffix", () => {
    const longName = "a".repeat(60);
    const slug = generateCompanySlug(longName);
    // Format is <base>-<4chars>, so max is 40 + 1 + 4 = 45
    expect(slug.length).toBeLessThanOrEqual(45);
  });

  it("always appends a 4-char alphanumeric suffix", () => {
    const slug = generateCompanySlug("test");
    const parts = slug.split("-");
    const suffix = parts[parts.length - 1];
    expect(suffix).toMatch(/^[a-z0-9]{4}$/);
  });

  it("generates different slugs for the same name (random suffix)", () => {
    const slugA = generateCompanySlug("Acme");
    const slugB = generateCompanySlug("Acme");
    // They could theoretically collide (1/36^4 ≈ 0.0006%) — acceptable in tests.
    // If this flakes, the randomness is broken.
    expect(slugA === slugB).toBe(false);
  });
});

describe("isValidSlug", () => {
  it("accepts a normal slug", () => {
    expect(isValidSlug("acme-corp-ab12")).toBe(true);
  });

  it("accepts a slug with numbers", () => {
    expect(isValidSlug("company123-xyz")).toBe(true);
  });

  it("rejects a slug starting with a hyphen", () => {
    expect(isValidSlug("-invalid")).toBe(false);
  });

  it("rejects a slug ending with a hyphen", () => {
    expect(isValidSlug("invalid-")).toBe(false);
  });

  it("rejects a slug with uppercase letters", () => {
    expect(isValidSlug("MySlug")).toBe(false);
  });

  it("rejects a slug with spaces", () => {
    expect(isValidSlug("my slug")).toBe(false);
  });

  it("rejects a slug with special characters", () => {
    expect(isValidSlug("my_slug!")).toBe(false);
  });

  it("rejects too-short slugs (< 3 chars total)", () => {
    // Pattern requires at least start + 2 chars + end = 4 chars minimum
    expect(isValidSlug("ab")).toBe(false);
  });

  it("accepts the minimum valid slug (3 chars: start + 1 middle + end)", () => {
    // "a1b" = start(a) + middle(1) + end(b)
    expect(isValidSlug("a1b")).toBe(true);
  });
});
