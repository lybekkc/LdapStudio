
# AGENTS.md — LdapStudio Codebase Guide

## Architecture Overview

Three distinct layers communicate strictly top-down:

```
app/src/               → React/TypeScript UI (Ant Design, Zustand)
app/src-tauri/src/     → Tauri command handlers + app state (Rust)
crates/ldap-core/src/  → Pure Rust LDAP library (ldap3 wrapper)
```

`ldap-core` is intentionally framework-agnostic — it has no Tauri dependency and can be used standalone. The Tauri layer (`commands.rs`, `state.rs`) is a thin adapter.

## Developer Workflows

**All dev/build commands run from `app/`, not the repo root:**
```bash
cd app
npm install
npm run tauri dev      # hot-reload; first build takes 2–4 min
npm run tauri build    # release bundle → target/release/bundle/
```

**Logging**: Tauri backend emits `tracing` logs. Default filter: `ldap_studio_app=debug,ldap_core=debug`. Override with `RUST_LOG` env var.

**Releasing**: Use `release.sh` at repo root — bumps version, tags, and pushes.

## Adding a Tauri Command (Critical Pattern)

Every new backend command requires **four coordinated changes**:

1. **`crates/ldap-core/src/`** — implement logic on `LdapClient` (if touching LDAP)
2. **`app/src-tauri/src/commands.rs`** — add `#[tauri::command] pub async fn my_command(..., state: State<'_, AppState>) -> Result<T, String>`; always use `.map_err(err_str)` for errors
3. **`app/src-tauri/src/lib.rs`** — register in `tauri::generate_handler![..., my_command]`
4. **`app/src/api/commands.ts`** — add `export const myCommand = (...) => invoke<T>("my_command", { ... })`

Tauri automatically converts `snake_case` Rust params ↔ `camelCase` TypeScript args.

## Type Synchronization

TypeScript types in `app/src/types.ts` are **manual mirrors** of Rust types in `crates/ldap-core/src/types.rs`. When changing a struct on either side, update the other. There is no codegen.

## Shared App State (Rust)

`AppState` in `app/src-tauri/src/state.rs` holds all Tauri session state behind `tokio::sync::Mutex`:
- `client: Mutex<Option<LdapClient>>` — single LDAP connection; commands call `g.as_mut().ok_or("Not connected")?`
- `tree_cookies: Mutex<HashMap<String, Vec<u8>>>` — per-DN paging cookies for DIT tree
- `search_cancel: Mutex<Option<CancellationToken>>` — replaced per search; call `.cancel()` to abort
- `page_size: Mutex<i32>` — shared by search and tree, set from frontend

## Frontend State (Zustand)

Single store in `app/src/store/appStore.ts` (`useAppStore`). Key conventions:
- All async actions wrap API calls and call `get().triggerReconnect()` on `isConnectionError(e)`
- **Write guard**: `writeUnlocked` state; components must check this before showing write UI
- Persistence uses `@tauri-apps/plugin-store`: `profiles.json` (shared), `searches-{profileId}.json`, `undo-{profileId}.json` (per profile)
- `ditTreeVersion` is an integer incremented to signal full DIT tree reload without prop drilling

## Undo System

Write operations (`modifyEntry`, `deleteEntry`, `addEntry`, `renameEntry`, `modifySchemaEntry`) in the store **capture inverse operations before executing**, then call `pushUndo()`. Sensitive attributes (`SENSITIVE_ATTRS` set) are never captured in snapshots. Undo records are persisted per-profile and survive app restarts.

## Auto-Reconnect & Keepalive

- Keepalive: `api.ping()` every 30 s; on `isConnectionError` → `triggerReconnect()`
- Reconnect: exponential backoff `[2,4,8,16,30,30,...]` seconds, 10 max attempts
- `isConnectionError()` in `appStore.ts` lists all known disconnect error strings (including Norwegian "ikke tilkoblet" patterns and LDAP error codes 81/91)

## Key Files

| File | Purpose |
|------|---------|
| `crates/ldap-core/src/client.rs` | Core `LdapClient` — all LDAP operations |
| `crates/ldap-core/src/types.rs` | Shared Rust types (source of truth for types) |
| `crates/ldap-core/src/ldif.rs` | LDIF parser/formatter, `is_operational_attr()` |
| `app/src-tauri/src/commands.rs` | All Tauri command implementations |
| `app/src-tauri/src/state.rs` | `AppState` definition |
| `app/src-tauri/src/lib.rs` | Command registration + plugin setup |
| `app/src/api/commands.ts` | TypeScript wrappers for all `invoke()` calls |
| `app/src/types.ts` | TypeScript type mirrors |
| `app/src/store/appStore.ts` | Full frontend state + undo/reconnect logic |

