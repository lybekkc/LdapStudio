import type { LdapMod } from "../types";

// ─── Known password attribute names ──────────────────────────────────────────

const PASSWORD_ATTR_SET = new Set([
  "userpassword",
  "unicodepwd",
  "sambantpassword",
  "sambalmpassword",
]);

export function isPasswordAttr(attrName: string): boolean {
  const lower = attrName.toLowerCase();
  return PASSWORD_ATTR_SET.has(lower) || lower.endsWith("password");
}

/** True when the value already carries an LDAP password scheme tag like {SSHA512}… */
export function isAlreadyHashed(value: string): boolean {
  return /^\{[A-Z0-9-]+\}/.test(value);
}

/** Extract the scheme name from a hashed value, e.g. "{SSHA512}abc" → "SSHA512" */
export function extractScheme(value: string): string | null {
  const m = value.match(/^\{([A-Z0-9-]+)\}/);
  return m ? m[1] : null;
}

// ─── Hashing ─────────────────────────────────────────────────────────────────

export type HashScheme = "SSHA" | "SSHA256" | "SSHA512";

export const HASH_SCHEME_OPTIONS: { value: HashScheme; label: string }[] = [
  { value: "SSHA",    label: "{SSHA} SHA-1 + salt"   },
  { value: "SSHA256", label: "{SSHA256} SHA-256 + salt" },
  { value: "SSHA512", label: "{SSHA512} SHA-512 + salt" },
];

const ALGO_MAP: Record<HashScheme, string> = {
  SSHA:    "SHA-1",
  SSHA256: "SHA-256",
  SSHA512: "SHA-512",
};

/**
 * Hash a plain-text password using the given SSHA variant.
 * Uses the Web Crypto API (available in Tauri's WebView).
 */
export async function hashLdapPassword(
  plain: string,
  scheme: HashScheme = "SSHA512",
): Promise<string> {
  const encoder      = new TextEncoder();
  const passwordBytes = encoder.encode(plain);
  const salt         = crypto.getRandomValues(new Uint8Array(16));

  const combined = new Uint8Array(passwordBytes.length + salt.length);
  combined.set(passwordBytes, 0);
  combined.set(salt, passwordBytes.length);

  const hashBuffer = await crypto.subtle.digest(ALGO_MAP[scheme], combined);
  const hashBytes  = new Uint8Array(hashBuffer);

  const result = new Uint8Array(hashBytes.length + salt.length);
  result.set(hashBytes, 0);
  result.set(salt, hashBytes.length);

  const b64 = btoa(Array.from(result).map(b => String.fromCharCode(b)).join(""));
  return `{${scheme}}${b64}`;
}

/**
 * Process a list of LDAP mods: any password attribute whose value is plain text
 * (does not start with a {SCHEME} tag) is hashed with the given scheme.
 */
export async function processPasswordMods(
  mods: LdapMod[],
  scheme: HashScheme,
): Promise<LdapMod[]> {
  return Promise.all(
    mods.map(async mod => {
      if (!isPasswordAttr(mod.attr)) return mod;
      const hashedValues = await Promise.all(
        mod.values.map(v =>
          isAlreadyHashed(v) ? Promise.resolve(v) : hashLdapPassword(v, scheme),
        ),
      );
      return { ...mod, values: hashedValues };
    }),
  );
}

