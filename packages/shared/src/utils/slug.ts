/**
 * Generates a URL-safe slug from a company name.
 * Appends a short random suffix to prevent collisions.
 */
export function generateCompanySlug(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 40);

  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base}-${suffix}`;
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug);
}
