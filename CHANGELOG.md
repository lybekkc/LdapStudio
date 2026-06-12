# Changelog

All notable changes to LDAP Studio are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

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

