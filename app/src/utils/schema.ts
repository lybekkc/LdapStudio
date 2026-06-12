import type { SchemaInfo } from "../types";

export interface OcAttrs {
  must: Set<string>;
  may:  Set<string>;
}

/**
 * Collect all MUST and MAY attributes for a list of objectClass names,
 * walking up the `superior` chain recursively so inherited attrs are included.
 */
export function collectOcAttrs(ocNames: string[], schema: SchemaInfo): OcAttrs {
  const must    = new Set<string>();
  const may     = new Set<string>();
  const visited = new Set<string>();

  const walk = (name: string) => {
    const key = name.toLowerCase();
    if (visited.has(key)) return;
    visited.add(key);

    const def = schema.objectClasses.find(
      o => o.name.toLowerCase() === key ||
           o.names.some(n => n.toLowerCase() === key)
    );
    if (!def) return;

    def.mustAttrs.forEach(a => must.add(a));
    def.mayAttrs.forEach(a  => may.add(a));
    def.superior.forEach(s  => walk(s));
  };

  ocNames.forEach(oc => walk(oc));

  // objectClass itself is always managed separately
  must.delete("objectClass");
  may.delete("objectClass");

  return { must, may };
}

