# LDAP Studio

> A modern, cross-platform LDAP client built with **Rust + Tauri + React**.  
> Lightweight, fast and self-contained — no Java, no Electron.

[![Build & Release](https://github.com/lybekkc/LdapStudio/actions/workflows/build.yml/badge.svg)](https://github.com/lybekkc/LdapStudio/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

> [!WARNING]
> **Use at your own risk — not production-tested**
>
> This is a hobby project under active development. The code has **not been reviewed,
> not security-audited and not production-tested**. Write operations
> (edit, delete, create, import) are performed directly against the LDAP server without
> additional validation layers or undo functionality.
>
> **Before using this against a production environment:**
> - Test thoroughly in a non-production environment
> - Set up the connection profile as **read-only** and unlock only when necessary
> - Back up your directory (e.g. LDIF export) before making changes
> - Verify that changes are correct after execution
>
> The authors take **no responsibility** for data loss, unintended changes or other
> consequences of use. See the [MIT License](LICENSE) for the full disclaimer.

---

## ✨ Features

### Navigation
- **DIT tree** with lazy loading and pagination
- **Entry details** — all attributes, incl. operational (toggle)
- **ObjectClass** section at the top, collapsible, click-to-copy

### Search
- Arbitrary LDAP filter, scope (base/one-level/subtree)
- Pagination with Simple Paged Results Control
- Saved searches

### Write Operations
- **Edit** entry inline — diff-based Modify (sends only changes)
- **Delete** with confirmation dialog
- **Create** new entry — smart wizard with sibling analysis
- **objectClasses** can be added and removed directly in edit mode

### Smart Completion
- **Sibling analysis** — samples existing entries, shows missing attributes with frequency %
- **Schema hints** — shows MUST/MAY attributes from selected objectClasses
- **RDN detection** — detects UUID/number/email patterns, auto-generates UUID values
- **Password hashing** — SSHA / SSHA256 / SSHA512 on save

### Schema
- Browse ObjectClasses, AttributeTypes, Syntaxes, Matching Rules
- **Edit and create** schema definitions via LDAP Modify on `cn=schema`

### Import / Export
- **LDIF** — export (with/without operational attrs, max count/"all") and import (dry-run, continue-on-error)
- **CSV / Excel (.xlsx)** — configurable columns, drag-to-reorder, live preview

### Connection
- LDAP / LDAPS / StartTLS
- Simple Bind, SASL PLAIN, Anonymous
- **Connection profiles** stored locally (encrypted app data)
- **Read-only mode** per profile — unlock temporarily as needed
- **Auto-reconnect** on VPN drop (keepalive ping + exponential backoff)

---

## 🚀 Download

> **[→ Latest release](https://github.com/lybekkc/LdapStudio/releases/latest)**

| Platform | Format |
|----------|--------|
| macOS (Apple Silicon) | `.dmg` (aarch64) |
| Windows               | `.msi` / `.exe`  |
| Linux                 | `.AppImage` / `.deb` |

> **macOS**: The app is not notarized, so macOS may say it is "damaged". Run this in Terminal after installing:
> ```bash
> xattr -cr "/Applications/LDAP Studio.app"
> ```
> Then open the app normally.

---

## 🏗️ Build from Source

### Prerequisites
- [Rust](https://rustup.rs/) ≥ 1.80
- [Node.js](https://nodejs.org/) ≥ 20 + npm
- macOS: `xcode-select --install`
- Linux: `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev`

### Dev Mode
```bash
git clone https://github.com/lybekkc/LdapStudio.git
cd LdapStudio/app
npm install
npm run tauri dev
```
First startup compiles Rust dependencies (~2–4 min). Subsequent startups are much faster.

### Release Build
```bash
cd app
npm run tauri build
# → target/release/bundle/{dmg,msi,deb,appimage}/
```

---

## 🗂️ Project Structure

```
LdapStudio/
├── crates/
│   └── ldap-core/          # Rust core: LDAP client, schema parser, LDIF
├── app/
│   ├── src/                # React/TypeScript frontend (Ant Design, Zustand)
│   │   ├── api/            # Tauri command wrappers
│   │   ├── components/     # UI components
│   │   ├── store/          # Global state + persistence
│   │   └── utils/          # Schema traversal, password hashing
│   └── src-tauri/          # Tauri backend: commands, state
├── .github/workflows/      # CI/CD: build for macOS/Windows/Linux
├── release.sh              # Version bump + tag + push
└── CHANGELOG.md
```

**Frontend-agnostic core** — `ldap-core` is a pure Rust library that can be used by Tauri, axum/actix, egui or Slint without modifications.

---

## 📋 Changelog

See [CHANGELOG.md](CHANGELOG.md).

---

## 📄 License

[MIT](LICENSE) — free to use, modify and distribute.
