export type PermissionSource = { permissions?: unknown };

export function normalizePermissions(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  const set = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const code = item.trim();
    if (code) set.add(code);
  }
  return set;
}

export function hasPermission(source: PermissionSource, code: string): boolean {
  const target = String(code || "").trim();
  if (!target) return false;
  return normalizePermissions(source?.permissions).has(target);
}

export function hasAnyPermission(source: PermissionSource, codes: string[]): boolean {
  const set = normalizePermissions(source?.permissions);
  for (const code of codes || []) {
    if (set.has(String(code || "").trim())) return true;
  }
  return false;
}

export function permissionsToStringArray(source: PermissionSource): string[] {
  return Array.from(normalizePermissions(source?.permissions)).sort();
}
