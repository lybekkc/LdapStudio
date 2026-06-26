import { invoke } from "@tauri-apps/api/core";
import type {
  ChildrenPage, ConnectionProfile, LdapEntry, LdapMod,
  LdifImportResult, NewEntry, SchemaInfo, SearchPage, ServerInfo, SiblingAnalysis,
} from "../types";

export const connect    = (profile: ConnectionProfile) => invoke<ServerInfo>("connect", { profile });
export const disconnect = () => invoke<void>("disconnect");
export const ping       = () => invoke<boolean>("ping");
export const setActiveBaseDn = (dn: string) => invoke<void>("set_active_base_dn", { dn });

export const listChildren     = (dn: string) => invoke<ChildrenPage>("list_children", { dn });
export const listChildrenMore = (dn: string) => invoke<ChildrenPage>("list_children_more", { dn });
export const getEntry         = (dn: string) => invoke<LdapEntry>("get_entry", { dn });
export const setPageSize      = (size: number) => invoke<void>("set_page_size", { size });

export const getSchema = () => invoke<SchemaInfo>("get_schema");

export const searchPage     = (base: string, filter: string, scope: string, pageSize?: number) =>
  invoke<SearchPage>("search_page", { base, filter, scope, pageSize });
export const searchNextPage = (base: string, filter: string, scope: string, pageSize?: number) =>
  invoke<SearchPage>("search_next_page", { base, filter, scope, pageSize });
export const cancelSearch   = () => invoke<void>("cancel_search");

export const saveProfile   = (profile: ConnectionProfile) => invoke<void>("save_profile", { profile });
export const listProfiles  = () => invoke<ConnectionProfile[]>("list_profiles");
export const deleteProfile = (id: string) => invoke<void>("delete_profile", { id });

// ─── Write operations ────────────────────────────────────────────────────────

export const modifyEntry = (dn: string, mods: LdapMod[]) =>
  invoke<void>("modify_entry", { dn, mods });

export const deleteEntry = (dn: string) =>
  invoke<void>("delete_entry", { dn });

export const addEntry = (entry: NewEntry) =>
  invoke<void>("add_entry", { entry });

export const renameEntry = (
  dn: string,
  newRdn: string,
  deleteOldRdn: boolean,
  newSuperior?: string,
) => invoke<void>("rename_entry", { dn, newRdn, deleteOldRdn, newSuperior: newSuperior ?? null });

export const analyzeSiblings = (parentDn: string, sampleSize = 25) =>
  invoke<SiblingAnalysis>("analyze_siblings", { parentDn, sampleSize });

export const modifySchemaEntry = (
  schemaDn: string,
  attrName: string,
  oldRaw: string,
  newRaw: string,
) => invoke<void>("modify_schema_entry", { schemaDn, attrName, oldRaw, newRaw });

export const exportLdif = (
  baseDn: string,
  filter: string,
  scope: string,
  includeOperational: boolean,
  maxEntries: number,
) => invoke<string>("export_ldif", { baseDn, filter, scope, includeOperational, maxEntries });

export const exportEntries = (
  baseDn: string,
  filter: string,
  scope: string,
  includeOperational: boolean,
  maxEntries: number,
) => invoke<import("../types").LdapEntry[]>(
  "export_entries", { baseDn, filter, scope, includeOperational, maxEntries }
);

export const importLdif = (
  content: string,
  dryRun: boolean,
  continueOnError: boolean,
) => invoke<LdifImportResult>("import_ldif", { content, dryRun, continueOnError });


export const fetchRemoteSchema = (profile: ConnectionProfile) =>
  invoke<SchemaInfo>("fetch_remote_schema", { profile });
