# LDAP Studio

> En moderne, cross-platform LDAP-klient bygget med **Rust + Tauri + React**.  
> Lett, rask og selvforsynt — ingen Java, ingen Electron.

[![Build & Release](https://github.com/lybekkc/LdapStudio/actions/workflows/build.yml/badge.svg)](https://github.com/lybekkc/LdapStudio/actions/workflows/build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## ✨ Funksjoner

### Navigasjon
- **DIT-tre** med lazy loading og paginering
- **Entry-detaljer** — alle attributter, inkl. operasjonelle (toggle)
- **ObjectClass**-seksjon øverst, kollapsbar, click-to-copy

### Søk
- Vilkårlig LDAP-filter, scope (base/one-level/subtree)
- Paginering med Simple Paged Results Control
- Lagrede søk

### Skriveoperasjoner
- **Rediger** entry inline — diff-basert Modify (sender kun endringer)
- **Slett** med bekreftelsesdialog
- **Opprett** ny entry — smart veiviser med søsken-analyse
- **objectClasses** kan legges til og fjernes direkte i redigeringsmodus

### Smart komplettering
- **Søsken-analyse** — sampler eksisterende entries, viser manglende attributter med frekvens %
- **Schema-hint** — viser MUST/MAY-attributter fra valgte objectClasses
- **RDN-gjenkjenning** — oppdager UUID/tall/e-post-mønstre, auto-genererer UUID-verdier
- **Passord-hashing** — SSHA / SSHA256 / SSHA512 ved lagring

### Schema
- Brows ObjectClasses, AttributeTypes, Syntaxes, Matching Rules
- **Rediger og opprett** schema-definisjoner via LDAP Modify på `cn=schema`

### Import / Export
- **LDIF** — eksport (med/uten operasjonelle attr, maks antall/"alle") og import (dry-run, continue-on-error)
- **CSV / Excel (.xlsx)** — konfigurerbare kolonner, drag-to-reorder, live forhåndsvisning

### Tilkobling
- LDAP / LDAPS / StartTLS
- Simple Bind, SASL PLAIN, Anonymous
- **Tilkoblingsprofiler** lagret lokalt (kryptert app-data)
- **Read-only modus** per profil — lås opp midlertidig ved behov
- **Auto-reconnect** ved VPN-tap (keepalive ping + exponentiell backoff)

---

## 🚀 Last ned

> **[→ Siste release](https://github.com/lybekkc/LdapStudio/releases/latest)**

| Plattform | Format |
|-----------|--------|
| macOS (Apple Silicon) | `.dmg` (aarch64) |
| macOS (Intel)         | `.dmg` (x86_64)  |
| Windows               | `.msi` / `.exe`  |
| Linux                 | `.AppImage` / `.deb` |

> **macOS**: Høyreklikk → Åpne første gang (appen er ikke App Store-signert).

---

## 🏗️ Bygg fra kildekode

### Forutsetninger
- [Rust](https://rustup.rs/) ≥ 1.80
- [Node.js](https://nodejs.org/) ≥ 20 + npm
- macOS: `xcode-select --install`
- Linux: `sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev`

### Dev-modus
```bash
git clone https://github.com/lybekkc/LdapStudio.git
cd LdapStudio/app
npm install
npm run tauri dev
```
Første oppstart kompilerer Rust-avhengigheter (~2–4 min). Etterfølgende er mye raskere.

### Release-bygg
```bash
cd app
npm run tauri build
# → target/release/bundle/{dmg,msi,deb,appimage}/
```

---

## 🗂️ Prosjektstruktur

```
LdapStudio/
├── crates/
│   └── ldap-core/          # Rust-kjerne: LDAP-klient, schema-parser, LDIF
├── app/
│   ├── src/                # React/TypeScript frontend (Ant Design, Zustand)
│   │   ├── api/            # Tauri command-wrapper
│   │   ├── components/     # UI-komponenter
│   │   ├── store/          # Global state + persistens
│   │   └── utils/          # Schema-traversal, passord-hashing
│   └── src-tauri/          # Tauri backend: commands, state
├── .github/workflows/      # CI/CD: bygg for macOS/Windows/Linux
├── release.sh              # Versjonsbump + tag + push
└── CHANGELOG.md
```

**Frontend-agnostisk kjerne** — `ldap-core` er et rent Rust-bibliotek som kan brukes av Tauri, axum/actix, egui eller Slint uten endringer.

---

## 📋 Changelog

Se [CHANGELOG.md](CHANGELOG.md).

---

## 📄 Lisens

[MIT](LICENSE) — fri til bruk, modifisering og distribusjon.
