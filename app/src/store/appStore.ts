import { create } from "zustand";
import { Store } from "@tauri-apps/plugin-store";
import type {
  AppTab, ConnectionProfile, LdapEntry, LdapMod,
  NewEntry, SavedSearch, SchemaInfo, ServerInfo, UndoRecord,
} from "../types";
import * as api from "../api/commands";

// ─── Reconnect helpers (module-level timers) ────────────────────────────────

const RECONNECT_DELAYS = [2, 4, 8, 16, 30, 30, 30, 30, 30, 30]; // seconds
export const MAX_RECONNECT_ATTEMPTS = RECONNECT_DELAYS.length;

let _reconnectTimeout:   ReturnType<typeof setTimeout>  | null = null;
let _countdownInterval:  ReturnType<typeof setInterval> | null = null;
let _keepaliveInterval:  ReturnType<typeof setInterval> | null = null;

function clearReconnectTimers() {
  if (_reconnectTimeout)  { clearTimeout(_reconnectTimeout);   _reconnectTimeout  = null; }
  if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null; }
}

function clearKeepalive() {
  if (_keepaliveInterval) { clearInterval(_keepaliveInterval); _keepaliveInterval = null; }
}

/** Returns true when the error string looks like a dropped connection */
export function isConnectionError(e: unknown): boolean {
  const msg = String(e).toLowerCase();
  return (
    msg.includes("not connected") ||
    msg.includes("connection refused") ||
    msg.includes("broken pipe") ||
    msg.includes("connection reset") ||
    msg.includes("connection was closed") ||
    msg.includes("eof") ||
    msg.includes("transport") ||
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("ldap error 81") ||  // SERVER_DOWN
    msg.includes("ldap error 91")     // CONNECT_ERROR
  );
}
let _store: Store | null = null;
const STORE_FILE   = "profiles.json";
const PROFILES_KEY = "profiles";
const SEARCHES_KEY = "savedSearches";
const SETTINGS_KEY = "settings";

// ─── Per-profile undo history helpers ────────────────────────────────────────

const UNDO_MAX_RECORDS = 100;

/** Password-like attributes we never store in snapshots */
const SENSITIVE_ATTRS = new Set([
  "userpassword", "unicodepwd", "sambantpassword", "sambalmpassword",
  "authpassword", "cleartextpassword", "password",
]);

async function loadUndoRecords(profileId: string): Promise<UndoRecord[]> {
  const store = await Store.load(`undo-${profileId}.json`);
  return (await store.get<UndoRecord[]>("history")) ?? [];
}

async function saveUndoRecords(profileId: string, records: UndoRecord[]): Promise<void> {
  const store = await Store.load(`undo-${profileId}.json`);
  await store.set("history", records.slice(0, UNDO_MAX_RECORDS));
  await store.save();
}

interface PersistedSettings {
  pageSize: number;
  showOcBrowser: boolean;
  showOcSearch: boolean;
  browserSplitSize: number;
  searchSplitSize: number;
  lastExportDir: string;
  lastImportDir: string;
}

async function getStore(): Promise<Store> {
  if (!_store) {
    _store = await Store.load(STORE_FILE);
  }
  return _store;
}

async function persistProfiles(profiles: ConnectionProfile[]) {
  const store = await getStore();
  await store.set(PROFILES_KEY, profiles);
  await store.save();
}

async function loadPersistedProfiles(): Promise<ConnectionProfile[]> {
  const store = await getStore();
  return (await store.get<ConnectionProfile[]>(PROFILES_KEY)) ?? [];
}

async function persistSearches(searches: SavedSearch[]) {
  const store = await getStore();
  await store.set(SEARCHES_KEY, searches);
  await store.save();
}

async function loadPersistedSearches(): Promise<SavedSearch[]> {
  const store = await getStore();
  return (await store.get<SavedSearch[]>(SEARCHES_KEY)) ?? [];
}

async function persistSettings(s: PersistedSettings) {
  const store = await getStore();
  await store.set(SETTINGS_KEY, s);
  await store.save();
}

async function loadPersistedSettings(): Promise<PersistedSettings> {
  const store = await getStore();
  const s = ((await store.get<PersistedSettings>(SETTINGS_KEY)) ?? {}) as Partial<PersistedSettings>;
  return {
    pageSize:         s.pageSize         ?? 100,
    showOcBrowser:    s.showOcBrowser    ?? true,
    showOcSearch:     s.showOcSearch     ?? true,
    browserSplitSize: s.browserSplitSize ?? 300,
    searchSplitSize:  s.searchSplitSize  ?? 360,
    lastExportDir:    s.lastExportDir    ?? "",
    lastImportDir:    s.lastImportDir    ?? "",
  };
}

// ─── Store interface ─────────────────────────────────────────────────────────

interface AppStore {
  // ─── Connection ──────────────────────────────────────────────────────────
  connected: boolean;
  connecting: boolean;
  serverInfo: ServerInfo | null;
  profiles: ConnectionProfile[];
  connectionError: string | null;
  activeProfile: ConnectionProfile | null;
  writeUnlocked: boolean;
  setWriteUnlocked: (v: boolean) => void;

  // Auto-reconnect
  reconnecting: boolean;
  reconnectAttempt: number;   // current attempt (1-based), 0 = idle
  reconnectIn: number;        // seconds until next retry
  reconnectFailed: boolean;   // true after all attempts exhausted
  triggerReconnect: () => void;
  cancelReconnect:  () => void;
  startKeepalive:   () => void;
  stopKeepalive:    () => void;

  // ─── DIT Tree ────────────────────────────────────────────────────────────
  selectedDn: string | null;
  selectedEntry: LdapEntry | null;
  entryLoading: boolean;
  lastDeletedDn: string | null;

  // ─── Search ──────────────────────────────────────────────────────────────
  searchResults: LdapEntry[];
  searchLoading: boolean;
  searchHasMore: boolean;
  searchPage: number;
  searchTotal: number;
  pageSize: number;
  // last search params (needed for next-page calls)
  _lastBase:   string;
  _lastFilter: string;
  _lastScope:  string;

  // ─── Schema ──────────────────────────────────────────────────────────────
  schema: SchemaInfo | null;
  schemaLoading: boolean;

  // ─── UI ──────────────────────────────────────────────────────────────────
  activeTab: AppTab;
  showConnectionDialog: boolean;

  // ─── Actions ─────────────────────────────────────────────────────────────
  initApp: () => Promise<void>;
  connectToServer: (profile: ConnectionProfile) => Promise<void>;
  disconnectFromServer: () => Promise<void>;

  loadChildren: (dn: string) => Promise<import("../types").ChildrenPage>;
  loadMoreChildren: (dn: string) => Promise<import("../types").ChildrenPage>;
  selectEntry: (dn: string) => Promise<void>;
  modifyEntry: (dn: string, mods: LdapMod[]) => Promise<void>;
  deleteEntry: (dn: string) => Promise<void>;
  addEntry: (entry: NewEntry) => Promise<void>;
  renameEntry: (dn: string, newRdn: string, deleteOldRdn: boolean, newSuperior?: string) => Promise<string>;

  runSearch: (base: string, filter: string, scope: string) => Promise<void>;
  loadNextPage: () => Promise<void>;
  cancelSearch: () => Promise<void>;
  loadSchema: () => Promise<void>;
  reloadSchema: () => Promise<void>;

  modifySchemaEntry: (
    schemaDn: string,
    attrName: string,
    oldRaw: string,
    newRaw: string,
    description?: string,
  ) => Promise<void>;

  loadProfiles: () => Promise<void>;
  saveProfile: (p: ConnectionProfile) => Promise<void>;
  removeProfile: (id: string) => Promise<void>;

  // ─── Saved searches ────────────────────────────────────────────────────────
  savedSearches: SavedSearch[];
  saveSearch: (s: SavedSearch) => Promise<void>;
  removeSavedSearch: (id: string) => Promise<void>;

  // ─── Undo history ──────────────────────────────────────────────────────────
  undoHistory: UndoRecord[];
  loadUndoHistory: () => Promise<void>;
  pushUndo: (record: UndoRecord) => Promise<void>;
  performUndo: (id: string) => Promise<void>;
  removeUndoRecord: (id: string) => Promise<void>;
  clearUndoHistory: () => Promise<void>;

  setPageSize: (size: number) => Promise<void>;
  showOcBrowser: boolean;
  showOcSearch: boolean;
  setShowOcBrowser: (v: boolean) => Promise<void>;
  setShowOcSearch: (v: boolean) => Promise<void>;
  browserSplitSize: number;
  searchSplitSize: number;
  setBrowserSplitSize: (size: number) => Promise<void>;
  setSearchSplitSize: (size: number) => Promise<void>;
  lastExportDir: string;
  lastImportDir: string;
  setLastExportDir: (dir: string) => Promise<void>;
  setLastImportDir: (dir: string) => Promise<void>;
  setActiveTab: (tab: AppTab) => void;
  setShowConnectionDialog: (show: boolean) => void;
  historyDrawerOpen: boolean;
  setHistoryDrawerOpen: (open: boolean) => void;
}

// ─── Store implementation ─────────────────────────────────────────────────────

export const useAppStore = create<AppStore>((set, get) => ({
  connected: false,
  connecting: false,
  serverInfo: null,
  profiles: [],
  savedSearches: [],
  connectionError: null,
  activeProfile: null,
  writeUnlocked: false,

  reconnecting: false,
  reconnectAttempt: 0,
  reconnectIn: 0,
  reconnectFailed: false,

  selectedDn: null,
  selectedEntry: null,
  entryLoading: false,
  lastDeletedDn: null,

  searchResults: [],
  searchLoading: false,
  searchHasMore: false,
  searchPage: 0,
  searchTotal: 0,
  pageSize: 100,
  showOcBrowser: true,
  showOcSearch: true,
  browserSplitSize: 300,
  searchSplitSize: 360,
  lastExportDir: "",
  lastImportDir: "",
  _lastBase: "", _lastFilter: "", _lastScope: "sub",

  schema: null,
  schemaLoading: false,

  activeTab: "browser",
  showConnectionDialog: true,
  undoHistory: [],
  historyDrawerOpen: false,

  // ─── Init: load profiles from disk ────────────────────────────────────────
  initApp: async () => {
    try {
      const [profiles, savedSearches, settings] = await Promise.all([
        loadPersistedProfiles(),
        loadPersistedSearches(),
        loadPersistedSettings(),
      ]);
      set({ profiles, savedSearches,
            pageSize: settings.pageSize,
            showOcBrowser: settings.showOcBrowser,
            showOcSearch: settings.showOcSearch,
            browserSplitSize: settings.browserSplitSize,
            searchSplitSize: settings.searchSplitSize,
            lastExportDir: settings.lastExportDir,
            lastImportDir: settings.lastImportDir,
      });
      await api.setPageSize(settings.pageSize);
    } catch (e) {
      console.warn("Could not load persisted data:", e);
    }
  },

  // ─── Connect / Disconnect ─────────────────────────────────────────────────
  connectToServer: async (profile) => {
    set({ connecting: true, connectionError: null });
    try {
      const info = await api.connect(profile);
      set({ connected: true, serverInfo: info, showConnectionDialog: false,
            activeProfile: profile, writeUnlocked: false,
            reconnecting: false, reconnectAttempt: 0,
            reconnectFailed: false, reconnectIn: 0 });
      get().startKeepalive();
      // Load undo history for this profile
      await get().loadUndoHistory();
    } catch (e) {
      set({ connectionError: String(e) });
    } finally {
      set({ connecting: false });
    }
  },

  disconnectFromServer: async () => {
    clearReconnectTimers();
    clearKeepalive();
    await api.disconnect().catch(() => {});
    set({
      connected: false,
      serverInfo: null,
      selectedDn: null,
      selectedEntry: null,
      schema: null,
      searchResults: [],
      showConnectionDialog: true,
      activeProfile: null,
      writeUnlocked: false,
      lastDeletedDn: null,
      reconnecting: false,
      reconnectAttempt: 0,
      reconnectFailed: false,
      reconnectIn: 0,
      undoHistory: [],
    });
  },

  // ─── Auto-reconnect ──────────────────────────────────────────────────────
  setWriteUnlocked: (v) => set({ writeUnlocked: v }),

  triggerReconnect: () => {
    if (get().reconnecting) return;                    // already in progress
    const profile = get().activeProfile;
    if (!profile) return;                              // no profile to reconnect with

    clearReconnectTimers();
    set({ connected: false, reconnecting: true, reconnectAttempt: 0,
          reconnectFailed: false, reconnectIn: 0 });

    // Inner recursive function — runs inside the store closure
    const attempt = (n: number) => {
      if (n >= MAX_RECONNECT_ATTEMPTS) {
        clearReconnectTimers();
        set({ reconnecting: false, reconnectFailed: true });
        return;
      }

      const delaySecs = RECONNECT_DELAYS[n];
      set({ reconnectAttempt: n + 1, reconnectIn: delaySecs });

      // Countdown display
      let remaining = delaySecs;
      clearReconnectTimers();
      _countdownInterval = setInterval(() => {
        remaining -= 1;
        set({ reconnectIn: remaining });
        if (remaining <= 0) {
          clearInterval(_countdownInterval!);
          _countdownInterval = null;
        }
      }, 1000);

      _reconnectTimeout = setTimeout(async () => {
        clearInterval(_countdownInterval!);
        _countdownInterval = null;
        set({ reconnectIn: 0 });

        const currentProfile = get().activeProfile;
        if (!currentProfile) { set({ reconnecting: false }); return; }

        try {
          const info = await api.connect(currentProfile);
          set({ connected: true, serverInfo: info,
                reconnecting: false, reconnectAttempt: 0,
                reconnectFailed: false, reconnectIn: 0 });
          clearReconnectTimers();
          get().startKeepalive();

          // Refresh selected entry if one was selected
          const dn = get().selectedDn;
          if (dn) {
            get().selectEntry(dn).catch(() => {});
          }
        } catch {
          attempt(n + 1);
        }
      }, delaySecs * 1000);
    };

    attempt(0);
  },

  cancelReconnect: () => {
    clearReconnectTimers();
    set({ reconnecting: false, reconnectAttempt: 0, reconnectIn: 0 });
  },

  startKeepalive: () => {
    clearKeepalive();
    _keepaliveInterval = setInterval(async () => {
      if (!get().connected || get().reconnecting) return;
      try {
        await api.ping();
      } catch (e) {
        if (isConnectionError(e)) {
          get().triggerReconnect();
        }
      }
    }, 30_000); // every 30 seconds
  },

  stopKeepalive: () => {
    clearKeepalive();
  },

  // ─── DIT ──────────────────────────────────────────────────────────────────
  loadChildren: async (dn) => {
    try { return await api.listChildren(dn); }
    catch (e) { if (isConnectionError(e)) get().triggerReconnect(); throw e; }
  },
  loadMoreChildren: async (dn) => {
    try { return await api.listChildrenMore(dn); }
    catch (e) { if (isConnectionError(e)) get().triggerReconnect(); throw e; }
  },

  selectEntry: async (dn) => {
    set({ selectedDn: dn, entryLoading: true, selectedEntry: null });
    try {
      const entry = await api.getEntry(dn);
      set({ selectedEntry: entry });
    } catch (e) {
      if (isConnectionError(e)) get().triggerReconnect();
    } finally {
      set({ entryLoading: false });
    }
  },

  modifyEntry: async (dn, mods) => {
    const profileId = get().activeProfile?.id;
    const currentEntry = get().selectedEntry;

    // Capture inverse mods (restore old values) before writing
    if (profileId && currentEntry) {
      const inverseMods: LdapMod[] = [];
      let hasRedacted = false;
      for (const mod of mods) {
        if (SENSITIVE_ATTRS.has(mod.attr.toLowerCase())) { hasRedacted = true; continue; }
        const existing = currentEntry.attributes.find(
          a => a.name.toLowerCase() === mod.attr.toLowerCase()
        );
        inverseMods.push({ op: "REPLACE", attr: mod.attr, values: existing?.values ?? [] });
      }
      if (inverseMods.length > 0) {
        const record: UndoRecord = {
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          dn,
          description: `Modified ${inverseMods.map(m => m.attr).join(", ")}`,
          operationType: "modify",
          inverseMods,
          hasRedactedAttrs: hasRedacted,
        };
        await get().pushUndo(record);
      }
    }

    await api.modifyEntry(dn, mods);
    const entry = await api.getEntry(dn);
    set({ selectedEntry: entry });
  },

  deleteEntry: async (dn) => {
    const profileId = get().activeProfile?.id;
    const currentEntry = get().selectedEntry ?? await api.getEntry(dn).catch(() => null);

    if (profileId && currentEntry) {
      let hasRedacted = false;
      const attrs = currentEntry.attributes
        .filter(a => !a.isOperational)
        .filter(a => {
          if (SENSITIVE_ATTRS.has(a.name.toLowerCase())) { hasRedacted = true; return false; }
          return true;
        })
        .map(a => ({ name: a.name, values: a.values }));

      const record: UndoRecord = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        dn,
        description: `Deleted entry`,
        operationType: "delete",
        snapshot: { dn, attributes: attrs },
        hasRedactedAttrs: hasRedacted,
      };
      await get().pushUndo(record);
    }

    await api.deleteEntry(dn);
    set({ selectedDn: null, selectedEntry: null, lastDeletedDn: dn });
  },

  addEntry: async (entry) => {
    await api.addEntry(entry);

    const profileId = get().activeProfile?.id;
    if (profileId) {
      const record: UndoRecord = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        dn: entry.dn,
        description: `Created entry`,
        operationType: "add",
      };
      await get().pushUndo(record);
    }

    const loaded = await api.getEntry(entry.dn);
    set({ selectedDn: entry.dn, selectedEntry: loaded });
  },

  renameEntry: async (dn, newRdn, deleteOldRdn, newSuperior) => {
    // Compute new DN for undo record
    const oldRdn = dn.split(",")[0] ?? dn;
    const oldParent = dn.includes(",") ? dn.slice(dn.indexOf(",") + 1) : undefined;
    const newParent = newSuperior ?? oldParent ?? "";
    const newDn = newParent ? `${newRdn},${newParent}` : newRdn;

    await api.renameEntry(dn, newRdn, deleteOldRdn, newSuperior);

    const profileId = get().activeProfile?.id;
    if (profileId) {
      const parts = [];
      if (oldRdn !== newRdn) parts.push(`RDN: ${oldRdn} → ${newRdn}`);
      if (newSuperior) parts.push(`moved to ${newSuperior}`);
      const record: UndoRecord = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        dn: newDn,
        description: parts.join(", ") || "Renamed",
        operationType: "rename",
        inverseRename: {
          newRdn: oldRdn,
          deleteOldRdn: true,
          newSuperior: newSuperior ? oldParent : undefined,
        },
      };
      await get().pushUndo(record);
    }

    // Update selected DN to new location
    set({ selectedDn: newDn });
    const reloaded = await api.getEntry(newDn).catch(() => null);
    if (reloaded) set({ selectedEntry: reloaded });

    return newDn;
  },

  // ─── Search ───────────────────────────────────────────────────────────────
  runSearch: async (base, filter, scope) => {
    set({ searchLoading: true, searchResults: [], searchHasMore: false,
          searchPage: 0, searchTotal: 0,
          _lastBase: base, _lastFilter: filter, _lastScope: scope });
    try {
      const r = await api.searchPage(base, filter, scope, get().pageSize);
      set({ searchResults: r.entries, searchHasMore: r.hasMore,
            searchPage: r.page, searchTotal: r.total });
    } catch (e) {
      if (isConnectionError(e)) get().triggerReconnect();
      else if (!String(e).includes("avbrutt")) throw e;
    } finally {
      set({ searchLoading: false });
    }
  },

  loadNextPage: async () => {
    const { _lastBase: base, _lastFilter: filter, _lastScope: scope,
            searchResults, pageSize } = get();
    if (!base) return;
    set({ searchLoading: true });
    try {
      const r = await api.searchNextPage(base, filter, scope, pageSize);
      set({
        searchResults: [...searchResults, ...r.entries],
        searchHasMore: r.hasMore,
        searchPage:    r.page,
        searchTotal:   r.total,
      });
    } catch (e) {
      if (!String(e).includes("avbrutt")) throw e;
    } finally {
      set({ searchLoading: false });
    }
  },

  cancelSearch: async () => {
    await api.cancelSearch().catch(() => {});
  },

  // ─── Schema ───────────────────────────────────────────────────────────────
  loadSchema: async () => {
    if (get().schema) return;
    set({ schemaLoading: true });
    try {
      const schema = await api.getSchema();
      set({ schema });
    } finally {
      set({ schemaLoading: false });
    }
  },

  reloadSchema: async () => {
    set({ schema: null, schemaLoading: true });
    try {
      const schema = await api.getSchema();
      set({ schema });
    } finally {
      set({ schemaLoading: false });
    }
  },

  modifySchemaEntry: async (schemaDn, attrName, oldRaw, newRaw, description) => {
    await api.modifySchemaEntry(schemaDn, attrName, oldRaw, newRaw);

    const profileId = get().activeProfile?.id;
    if (profileId) {
      // Determine operation type for description
      const opLabel = !oldRaw ? "Created" : !newRaw ? "Deleted" : "Modified";
      const typeLabel = attrName === "objectClasses" ? "ObjectClass" : "AttributeType";
      const record: UndoRecord = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        dn: schemaDn,
        description: description ?? `${opLabel} ${typeLabel}`,
        operationType: "schema",
        inverseSchema: {
          schemaDn,
          attrName,
          oldRaw:  newRaw,   // inverse: delete the new one
          newRaw:  oldRaw,   // inverse: restore the old one
        },
      };
      await get().pushUndo(record);
    }
  },

  // ─── Profiles (persisted to disk via tauri-plugin-store) ──────────────────
  loadProfiles: async () => {
    const profiles = await loadPersistedProfiles();
    set({ profiles });
  },

  saveProfile: async (p) => {
    const current = get().profiles;
    const existing = current.findIndex((x) => x.id === p.id);
    const updated =
      existing >= 0
        ? current.map((x) => (x.id === p.id ? p : x))
        : [...current, p];
    set({ profiles: updated });
    await persistProfiles(updated);
  },

  removeProfile: async (id) => {
    const updated = get().profiles.filter((p) => p.id !== id);
    set({ profiles: updated });
    await persistProfiles(updated);
  },

  // ─── Saved searches ────────────────────────────────────────────────────────
  saveSearch: async (s) => {
    const current = get().savedSearches;
    const exists = current.findIndex((x) => x.id === s.id);
    const updated = exists >= 0
      ? current.map((x) => (x.id === s.id ? s : x))
      : [...current, s];
    set({ savedSearches: updated });
    await persistSearches(updated);
  },

  removeSavedSearch: async (id) => {
    const updated = get().savedSearches.filter((s) => s.id !== id);
    set({ savedSearches: updated });
    await persistSearches(updated);
  },

  // ─── Undo history ─────────────────────────────────────────────────────────
  loadUndoHistory: async () => {
    const profileId = get().activeProfile?.id;
    if (!profileId) return;
    const records = await loadUndoRecords(profileId);
    set({ undoHistory: records });
  },

  pushUndo: async (record) => {
    const profileId = get().activeProfile?.id;
    if (!profileId) return;
    const updated = [record, ...get().undoHistory].slice(0, UNDO_MAX_RECORDS);
    set({ undoHistory: updated });
    await saveUndoRecords(profileId, updated);
  },

  performUndo: async (id) => {
    const record = get().undoHistory.find(r => r.id === id);
    if (!record) return;

    if (record.operationType === "modify" && record.inverseMods) {
      await api.modifyEntry(record.dn, record.inverseMods);
      if (get().selectedDn === record.dn) {
        const entry = await api.getEntry(record.dn);
        set({ selectedEntry: entry });
      }
    } else if (record.operationType === "delete" && record.snapshot) {
      const { dn, attributes } = record.snapshot;
      await api.addEntry({
        dn,
        attributes: attributes.map(a => ({ op: "ADD" as const, attr: a.name, values: a.values })),
      });
    } else if (record.operationType === "add") {
      await api.deleteEntry(record.dn);
      if (get().selectedDn === record.dn) {
        set({ selectedDn: null, selectedEntry: null });
      }
    } else if (record.operationType === "rename" && record.inverseRename) {
      const { newRdn, deleteOldRdn, newSuperior } = record.inverseRename;
      await api.renameEntry(record.dn, newRdn, deleteOldRdn, newSuperior);
      const restoredDn = newSuperior
        ? `${newRdn},${newSuperior}`
        : `${newRdn},${record.dn.includes(",") ? record.dn.slice(record.dn.indexOf(",") + 1) : ""}`;
      set({ selectedDn: restoredDn });
      const entry = await api.getEntry(restoredDn).catch(() => null);
      if (entry) set({ selectedEntry: entry });
    } else if (record.operationType === "schema" && record.inverseSchema) {
      const { schemaDn, attrName, oldRaw, newRaw } = record.inverseSchema;
      await api.modifySchemaEntry(schemaDn, attrName, oldRaw, newRaw);
      // Reload schema to reflect changes
      const schema = await api.getSchema().catch(() => null);
      if (schema) set({ schema });
    }

    // Remove the record after successful undo
    await get().removeUndoRecord(id);
  },

  removeUndoRecord: async (id) => {
    const profileId = get().activeProfile?.id;
    if (!profileId) return;
    const updated = get().undoHistory.filter(r => r.id !== id);
    set({ undoHistory: updated });
    await saveUndoRecords(profileId, updated);
  },

  clearUndoHistory: async () => {
    const profileId = get().activeProfile?.id;
    if (!profileId) return;
    set({ undoHistory: [] });
    await saveUndoRecords(profileId, []);
  },

  // ─── UI ───────────────────────────────────────────────────────────────────
  setActiveTab: (tab: AppTab) => set({ activeTab: tab }),
  setShowConnectionDialog: (show) => set({ showConnectionDialog: show }),
  setHistoryDrawerOpen: (open) => set({ historyDrawerOpen: open }),

  setPageSize: async (size) => {
    set({ pageSize: size });
    await api.setPageSize(size);
    const s = get();
    await persistSettings({ pageSize: size, showOcBrowser: s.showOcBrowser, showOcSearch: s.showOcSearch, browserSplitSize: s.browserSplitSize, searchSplitSize: s.searchSplitSize, lastExportDir: s.lastExportDir, lastImportDir: s.lastImportDir });
  },

  setShowOcBrowser: async (v) => {
    set({ showOcBrowser: v });
    const s = get();
    await persistSettings({ pageSize: s.pageSize, showOcBrowser: v, showOcSearch: s.showOcSearch, browserSplitSize: s.browserSplitSize, searchSplitSize: s.searchSplitSize, lastExportDir: s.lastExportDir, lastImportDir: s.lastImportDir });
  },

  setShowOcSearch: async (v) => {
    set({ showOcSearch: v });
    const s = get();
    await persistSettings({ pageSize: s.pageSize, showOcBrowser: s.showOcBrowser, showOcSearch: v, browserSplitSize: s.browserSplitSize, searchSplitSize: s.searchSplitSize, lastExportDir: s.lastExportDir, lastImportDir: s.lastImportDir });
  },

  setBrowserSplitSize: async (size) => {
    set({ browserSplitSize: size });
    const s = get();
    await persistSettings({ pageSize: s.pageSize, showOcBrowser: s.showOcBrowser, showOcSearch: s.showOcSearch, browserSplitSize: size, searchSplitSize: s.searchSplitSize, lastExportDir: s.lastExportDir, lastImportDir: s.lastImportDir });
  },

  setSearchSplitSize: async (size) => {
    set({ searchSplitSize: size });
    const s = get();
    await persistSettings({ pageSize: s.pageSize, showOcBrowser: s.showOcBrowser, showOcSearch: s.showOcSearch, browserSplitSize: s.browserSplitSize, searchSplitSize: size, lastExportDir: s.lastExportDir, lastImportDir: s.lastImportDir });
  },

  setLastExportDir: async (dir) => {
    set({ lastExportDir: dir });
    const s = get();
    await persistSettings({ pageSize: s.pageSize, showOcBrowser: s.showOcBrowser, showOcSearch: s.showOcSearch, browserSplitSize: s.browserSplitSize, searchSplitSize: s.searchSplitSize, lastExportDir: dir, lastImportDir: s.lastImportDir });
  },

  setLastImportDir: async (dir) => {
    set({ lastImportDir: dir });
    const s = get();
    await persistSettings({ pageSize: s.pageSize, showOcBrowser: s.showOcBrowser, showOcSearch: s.showOcSearch, browserSplitSize: s.browserSplitSize, searchSplitSize: s.searchSplitSize, lastExportDir: s.lastExportDir, lastImportDir: dir });
  },
}));

