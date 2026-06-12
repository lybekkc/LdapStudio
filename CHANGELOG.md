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

