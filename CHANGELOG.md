# Changelog

All notable changes to LDAP Studio are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

---

## [0.8.0] - 2026-06-14

### Added
- **Custom schema detection** — object classes and attribute types that don't belong to known standards (X.500, inetOrgPerson, OpenLDAP, etc.) are marked with an orange `custom` badge in the Schema Browser
- **"Custom only" toggle** in the Schema Browser — filter the list to show only your own OC/AT definitions
- **Enterprise OID arc (PEN) support** — set your IANA Private Enterprise Number base OID in the connection profile; `custom` badges and the "Custom only" filter then apply exclusively to OIDs under your own arc instead of all third-party OIDs
- **PEN banner** in the Schema Browser shows the active enterprise arc when one is configured
- **Auto-suggest next OID** — a 💡 button next to the OID field in the ObjectClass and AttributeType editors automatically proposes the next available OID under your enterprise arc

---

## [0.7.0] - 2026-06-14

### Added
- **Edit saved searches** — pencil icon on each saved search opens the modal pre-filled; supports changing name, filter, base DN and scope
- **Auto-generated search name** — if you leave the name field blank when saving, a readable name is generated from the filter and base DN (e.g. `objectClass=person @ ou=Personer`)
- **DN browser button** in the save/edit search modal — browse the DIT tree to pick a base DN without typing
- Filter and base DN are now fully editable in the save/edit modal

### Fixed
- Save search (star icon) did nothing — `SaveSearchModal` was placed inside `<Splitter>` which silently ignores non-Panel children; moved outside the Splitter
- Edit saved search modal did not pre-fill values — replaced `useEffect`+`setFieldsValue` pattern with `key`-based remount and `initialValues` for reliable form population
- Production build failed after Vite 8 upgrade — `minify: "esbuild"` requires esbuild to be installed separately in Vite 8; changed to `minify: true` (uses built-in OXC minifier)
- Updated macOS build target from `safari13` (2019) to `safari15` to match Tauri 2 minimum requirements

### Changed
- **React 18 → 19**, **Vite 6 → 8**, **@vitejs/plugin-react 4 → 6** — no breaking changes in application code
- Rust patch dependency updates (wasm-bindgen, time, memchr, etc.)

---

## [0.6.0] - 2026-06-12

### Added
- Profile name shown as a **colored badge** in the toolbar — each profile gets a stable, automatically assigned color so it is easy to tell environments apart at a glance
- Window title updates to `«Profile name» — LDAP Studio` when connected, making it easy to distinguish multiple running instances (e.g. in the macOS Dock)
- Server Info popover (ℹ) now shows profile name, host:port and active base DN
- **F5** keyboard shortcut refreshes the DIT tree; a refresh button (↺) is also available in the tree toolbar
- **Saved searches are now per connection profile** — stored in `searches-{profileId}.json`, loaded on connect and cleared on disconnect (same pattern as undo history)

### Fixed
- DIT tree did not recover after deleting an entry — the parent node now automatically reloads its children immediately after a deletion instead of leaving the tree empty

---

## [0.5.0] - 2026-06-12

### Added
- DIT tree now shows **all naming contexts as root nodes** — matches Apache Directory Studio behaviour; servers with multiple roots (e.g. `dc=prodreg,dc=no`, `ou=am-config`, `ou=identities`) are all visible and browsable at the same time
- Clickable naming contexts in the Server Info popover — switch the active base DN (used for search defaults) without reconnecting
- LDIF import now writes a `.log` file next to the imported file (Apache Directory Studio convention) — one line per entry with result code and error message
- `defaultNamingContext` fallback when reading rootDSE — improves compatibility with Active Directory

### Fixed
- LDIF import silently succeeded even when LDAP operations failed (rc=68 entryAlreadyExists, rc=53, etc.) — result codes are now properly checked and surfaced per entry
- LDIF import could not read files outside the app bundle — Tauri filesystem scope now covers home, downloads, desktop and documents directories
- DIT tree did not refresh after LDIF import completed
- `namingContexts` was not found on servers that return LDAP attribute names in lowercase — all rootDSE attribute lookups are now case-insensitive

### Changed
- Active base DN auto-detection now prefers `dc=` style naming contexts (domain roots) over `ou=` and other types when a server reports multiple contexts

---

## [0.4.1] - 2026-06-12

### Fixed
- White screen crash when clicking certain DIT tree nodes — React hooks were called after early returns in `EntryDetails`, violating Rules of Hooks

### Changed
- Custom SVG app icon (LDAP tree + magnifying glass with blue/indigo gradient) replaces default Tauri icon on all platforms
- Toolbar logo updated to use the same SVG icon component

---

## [0.4.0] - 2026-06-12

### Added
- Undo/redo history per connection profile — stored locally in `undo-{profileId}.json`, survives restarts
  - Tracks: modify, delete, create, rename/move and schema changes
  - Password attributes are excluded from snapshots
  - History panel accessible from toolbar (clock icon with badge count)
- Rename / Move entry (LDAP ModifyDN) — change RDN and/or move to a new parent DN
  - Live DN preview in modal
  - DN browser button to pick new parent visually
  - Undo support
- Schema undo support — ObjectClass and AttributeType create/modify/delete are now tracked in undo history
- Keyboard shortcuts (`⌘/Ctrl+Z` undo, `⌘/Ctrl+H` history, `⌘/Ctrl+1/2/3` tabs, `⌘/Ctrl+E` edit, `⌘/Ctrl+S` save, `?` show shortcuts)
- Copy/Paste entries — copy a selected entry to an in-memory clipboard and paste it as a new entry
  - Passwords and server-generated attributes are excluded from the clipboard
  - Toolbar shows a visual indicator when clipboard is occupied (golden icon + tooltip with source DN)
  - `⌘/Ctrl+C` copies the selected entry; `⌘/Ctrl+V` opens New Entry drawer pre-filled with clipboard data
  - RDN value is intentionally left blank so the user must provide a unique value

---

## [0.2.0] - 2026-06-12

### Added
- Native file save/open dialogs for LDIF, CSV and Excel export/import
- Last used export/import directory is persisted between sessions
- DN browser button on Base DN field in all export dialogs — browse the DIT tree visually instead of typing the DN manually

### Changed
- Dropped macOS Intel (x86_64) build — Apple Silicon only for macOS

---

## [0.1.0] - 2026-06-12

### Added
- Initial release
- DIT tree browser with lazy loading and pagination
- Entry details with attribute view
- LDAP search with filtering and pagination
- Schema browser (ObjectClass, AttributeType, Syntaxes, Matching Rules)
- Create, edit and delete LDAP entries
- LDIF export and import with dry-run support
- CSV and Excel (.xlsx) export with configurable columns
- Schema editor (ObjectClass and AttributeType via LDAP modify)
- Auto-reconnect on VPN/network drop (keepalive + exponential backoff)
- Read-only connection profiles with temporary unlock
- objectClass add/remove directly in edit mode
- Schema-based completion hints in edit mode
- Sibling analysis for hints about missing attributes
- RDN pattern detection (UUID, number, email) when creating entries
- Password attribute support with SSHA/SSHA256/SSHA512 hashing
- Connection profiles with persistence
- Settings (page size, OC display, splitter sizes)

