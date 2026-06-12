// ─── Mirrors of Rust types in ldap-core/src/types.rs ────────────────────────

export type ConnectionType = "PLAIN" | "LDAPS" | "START_TLS";

export type AuthMethod =
  | { kind: "ANONYMOUS" }
  | { kind: "SIMPLE_BIND"; bind_dn: string; password: string }
  | { kind: "SASL_PLAIN"; authz_id: string; password: string };

export interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  connectionType: ConnectionType;
  auth: AuthMethod;
  baseDn: string | null;
  timeoutSecs: number;
  /** UI-only write guard — does not affect the actual LDAP connection */
  readOnly?: boolean;
}

export interface ServerInfo {
  vendorName: string | null;
  vendorVersion: string | null;
  namingContexts: string[];
  supportedLdapVersions: string[];
  supportedSaslMechanisms: string[];
  activeBaseDn: string;
}

export interface LdapAttribute {
  name: string;
  values: string[];
  isOperational: boolean;
}

export interface LdapEntry {
  dn: string;
  attributes: LdapAttribute[];
}

// ─── Write operations ────────────────────────────────────────────────────────

export type ModOp = "ADD" | "DELETE" | "REPLACE";

export interface LdapMod {
  op:     ModOp;
  attr:   string;
  values: string[];
}

export interface NewEntry {
  dn:         string;
  attributes: LdapMod[];  // all op=ADD
}

// ─── Sibling analysis ────────────────────────────────────────────────────────

export interface CountedItem {
  name:  string;
  count: number;
}

export type RdnValueType = "UUID" | "NUMBER" | "EMAIL" | "DN" | "FREE_TEXT";

export interface RdnPattern {
  attr:      string;
  count:     number;
  valueType: RdnValueType;
  example:   string;
}

export interface SiblingAnalysis {
  objectClasses: CountedItem[];
  attributes:    CountedItem[];
  sampleCount:   number;
  rdnPatterns:   RdnPattern[];
}

export interface SearchPage {
  entries:  LdapEntry[];
  hasMore:  boolean;
  page:     number;
  total:    number;
}

export interface DitNode {
  dn: string;
  rdn: string;
  objectClasses: string[];
  hasChildren: boolean;
}

export interface ChildrenPage {
  nodes:   DitNode[];
  hasMore: boolean;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

export type ObjectClassKind = "ABSTRACT" | "STRUCTURAL" | "AUXILIARY";

export interface ObjectClass {
  oid: string;
  name: string;
  names: string[];
  description: string;
  superior: string[];
  kind: ObjectClassKind;
  mustAttrs: string[];
  mayAttrs: string[];
  obsolete: boolean;
  raw?: string;
}

export type AttributeUsage =
  | "userApplications"
  | "directoryOperation"
  | "distributedOperation"
  | "dsaOperation";

export interface AttributeType {
  oid: string;
  name: string;
  names: string[];
  description: string;
  superior: string | null;
  equality: string | null;
  ordering: string | null;
  substr: string | null;
  syntax: string | null;
  singleValue: boolean;
  collective: boolean;
  noUserModification: boolean;
  usage: AttributeUsage;
  obsolete: boolean;
  raw?: string;
}

export interface LdapSyntax {
  oid: string;
  description: string;
}

export interface MatchingRule {
  oid: string;
  name: string;
  syntaxOid: string;
}

export interface SchemaInfo {
  objectClasses: ObjectClass[];
  attributeTypes: AttributeType[];
  ldapSyntaxes: LdapSyntax[];
  matchingRules: MatchingRule[];
}

// ─── LDIF ────────────────────────────────────────────────────────────────────

export interface LdifImportResult {
  added:    number;
  modified: number;
  deleted:  number;
  skipped:  number;
  failed:   number;
  errors:   string[];
}

// ─── App UI state ─────────────────────────────────────────────────────────────

export type AppTab = "browser" | "schema" | "search";

// ─── Saved searches ───────────────────────────────────────────────────────────

export interface SavedSearch {
  id: string;
  name: string;
  baseDn: string;
  filter: string;
  scope: string;
}

// ─── Undo history ─────────────────────────────────────────────────────────────

export type UndoOperationType = "modify" | "delete" | "add" | "rename" | "schema";

export interface UndoRecord {
  id: string;
  timestamp: string;       // ISO 8601
  dn: string;
  description: string;     // human-readable summary
  operationType: UndoOperationType;
  /** For undo of modify: mods that restore previous attribute values */
  inverseMods?: LdapMod[];
  /** For undo of delete: full entry snapshot to re-add (password attrs excluded) */
  snapshot?: { dn: string; attributes: Array<{ name: string; values: string[] }> };
  /** True if one or more password attributes were skipped in the snapshot */
  hasRedactedAttrs?: boolean;
  /** For undo of rename/move: restore the original DN */
  inverseRename?: {
    newRdn: string;
    deleteOldRdn: boolean;
    newSuperior?: string;
  };
  /** For undo of schema changes: re-apply the inverse modifySchemaEntry */
  inverseSchema?: {
    schemaDn: string;
    attrName: string;   // "objectClasses" or "attributeTypes"
    oldRaw:   string;   // what to "delete" in the inverse call
    newRaw:   string;   // what to "add" in the inverse call
  };
}
