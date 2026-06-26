use ldap_core::{
    ChildrenPage, ConnectionProfile, LdapClient, LdifEntryResult, LdifImportResult,
    LdapEntry, LdapMod, NewEntry, SchemaInfo, SearchPage, ServerInfo, SiblingAnalysis,
};
use ldap_core::ldif::{format_ldif, parse_ldif, LdifOp};
use ldap3::{Mod, Scope, SearchEntry};
use std::collections::HashSet;
use tauri::State;
use tokio_util::sync::CancellationToken;

use crate::state::{err_str, AppState};

// ─── Connection ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn connect(
    profile: ConnectionProfile,
    state: State<'_, AppState>,
) -> Result<ServerInfo, String> {
    let client = LdapClient::connect(&profile).await.map_err(err_str)?;
    let info = client.server_info.clone();
    *state.client.lock().await = Some(client);
    tracing::info!("Connected – base DN: {}", info.active_base_dn);
    Ok(info)
}

/// Override the active base DN for the current session (without reconnecting).
#[tauri::command]
pub async fn set_active_base_dn(
    dn: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut guard = state.client.lock().await;
    let client = guard.as_mut().ok_or("Not connected")?;
    tracing::info!("Active base DN changed to: {}", dn);
    client.server_info.active_base_dn = dn;
    Ok(())
}

#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.client.lock().await;
    if let Some(mut client) = guard.take() {
        client.disconnect().await.map_err(err_str)?;
    }
    Ok(())
}

/// Lightweight keepalive — reads one rootDSE attribute.
/// Lightweight keepalive — returns Ok(true) if still connected.
#[tauri::command]
pub async fn ping(state: State<'_, AppState>) -> Result<bool, String> {
    let mut guard = state.client.lock().await;
    let client = guard.as_mut().ok_or("Not connected")?;
    client.ping().await.map(|_| true).map_err(|e| e.to_string())
}

/// Modify a schema definition entry.
/// Pass `old_raw = ""` to create, `new_raw = ""` to delete.
#[tauri::command]
pub async fn modify_schema_entry(
    schema_dn: String,
    attr_name: String,
    old_raw:   String,
    new_raw:   String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut g = state.client.lock().await;
    let client = g.as_mut().ok_or("Not connected")?;
    client
        .modify_schema_entry(&schema_dn, &attr_name, &old_raw, &new_raw)
        .await
        .map_err(err_str)
}

// ─── DIT browser ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_children(dn: String, state: State<'_, AppState>) -> Result<ChildrenPage, String> {
    state.tree_cookies.lock().await.remove(&dn);
    let page_size = *state.page_size.lock().await;
    let mut g = state.client.lock().await;
    let client = g.as_mut().ok_or("Not connected")?;
    let (page, cookie) = client.list_children_page(&dn, page_size, vec![]).await.map_err(err_str)?;
    if !cookie.is_empty() {
        state.tree_cookies.lock().await.insert(dn, cookie);
    }
    Ok(page)
}

#[tauri::command]
pub async fn list_children_more(dn: String, state: State<'_, AppState>) -> Result<ChildrenPage, String> {
    let cookie = state.tree_cookies.lock().await.get(&dn).cloned().unwrap_or_default();
    let page_size = *state.page_size.lock().await;
    let mut g = state.client.lock().await;
    let client = g.as_mut().ok_or("Not connected")?;
    let (page, next_cookie) = client.list_children_page(&dn, page_size, cookie).await.map_err(err_str)?;
    let mut cookies = state.tree_cookies.lock().await;
    if next_cookie.is_empty() { cookies.remove(&dn); } else { cookies.insert(dn, next_cookie); }
    Ok(page)
}

#[tauri::command]
pub async fn set_page_size(size: i32, state: State<'_, AppState>) -> Result<(), String> {
    *state.page_size.lock().await = size.max(10).min(5000);
    Ok(())
}

#[tauri::command]
pub async fn get_entry(dn: String, state: State<'_, AppState>) -> Result<LdapEntry, String> {
    let mut g = state.client.lock().await;
    g.as_mut().ok_or("Not connected")?.get_entry(&dn).await.map_err(err_str)
}

// ─── Paged search with cancellation ──────────────────────────────────────────

async fn run_search(
    state: &AppState,
    base: &str, filter: &str, scope: &str,
    page_size: i32, reset: bool,
    cancel: CancellationToken,
) -> Result<SearchPage, String> {
    tokio::select! {
        result = async {
            let mut g = state.client.lock().await;
            let client = g.as_mut().ok_or_else(|| "Not connected".to_string())?;
            client.search_page(base, filter, scope, page_size, reset).await.map_err(err_str)
        } => {
            *state.search_cancel.lock().await = None;
            result
        }
        _ = cancel.cancelled() => {
            Err("Søk avbrutt".to_string())
        }
    }
}

#[tauri::command]
pub async fn search_page(
    base: String, filter: String, scope: String,
    page_size: Option<i32>,
    state: State<'_, AppState>,
) -> Result<SearchPage, String> {
    let cancel = CancellationToken::new();
    *state.search_cancel.lock().await = Some(cancel.clone());
    run_search(&state, &base, &filter, &scope, page_size.unwrap_or(100), true, cancel).await
}

#[tauri::command]
pub async fn search_next_page(
    base: String, filter: String, scope: String,
    page_size: Option<i32>,
    state: State<'_, AppState>,
) -> Result<SearchPage, String> {
    let cancel = CancellationToken::new();
    *state.search_cancel.lock().await = Some(cancel.clone());
    run_search(&state, &base, &filter, &scope, page_size.unwrap_or(100), false, cancel).await
}

#[tauri::command]
pub async fn cancel_search(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(t) = state.search_cancel.lock().await.take() { t.cancel(); }
    Ok(())
}

// ─── Schema ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_schema(state: State<'_, AppState>) -> Result<SchemaInfo, String> {
    let mut g = state.client.lock().await;
    g.as_mut().ok_or("Not connected")?.get_schema().await.map_err(err_str)
}

/// Connect to a remote server, fetch its schema, and immediately disconnect.
/// Used by the Compare Schema feature — does not affect the active connection.
#[tauri::command]
pub async fn fetch_remote_schema(profile: ConnectionProfile) -> Result<SchemaInfo, String> {
    let mut client = LdapClient::connect(&profile).await.map_err(err_str)?;
    let schema = client.get_schema().await.map_err(err_str)?;
    let _ = client.disconnect().await;
    Ok(schema)
}

// ─── Write operations ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn modify_entry(
    dn: String,
    mods: Vec<LdapMod>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut g = state.client.lock().await;
    g.as_mut().ok_or("Not connected")?
        .modify_entry(&dn, mods).await.map_err(err_str)
}

#[tauri::command]
pub async fn delete_entry(
    dn: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut g = state.client.lock().await;
    g.as_mut().ok_or("Not connected")?
        .delete_entry(&dn).await.map_err(err_str)
}

#[tauri::command]
pub async fn add_entry(
    entry: NewEntry,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut g = state.client.lock().await;
    g.as_mut().ok_or("Not connected")?
        .add_entry(&entry).await.map_err(err_str)
}

#[tauri::command]
pub async fn rename_entry(
    dn:             String,
    new_rdn:        String,
    delete_old_rdn: bool,
    new_superior:   Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut g = state.client.lock().await;
    g.as_mut().ok_or("Not connected")?
        .rename_entry(&dn, &new_rdn, delete_old_rdn, new_superior.as_deref())
        .await.map_err(err_str)
}

#[tauri::command]
pub async fn analyze_siblings(
    parent_dn: String,
    sample_size: Option<i32>,
    state: State<'_, AppState>,
) -> Result<SiblingAnalysis, String> {
    let size = sample_size.unwrap_or(25).max(5).min(200);
    let mut g = state.client.lock().await;
    g.as_mut().ok_or("Not connected")?
        .analyze_siblings(&parent_dn, size).await.map_err(err_str)
}

// ─── Profiles ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn save_profile(profile: ConnectionProfile, state: State<'_, AppState>) -> Result<(), String> {
    state.profiles.lock().await.insert(profile.id.clone(), profile);
    Ok(())
}

#[tauri::command]
pub async fn list_profiles(state: State<'_, AppState>) -> Result<Vec<ConnectionProfile>, String> {
    let map = state.profiles.lock().await;
    let mut v: Vec<ConnectionProfile> = map.values().cloned().collect();
    v.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(v)
}

#[tauri::command]
pub async fn delete_profile(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.profiles.lock().await.remove(&id);
    Ok(())
}

// ─── LDIF Export ──────────────────────────────────────────────────────────────

/// Shared helper: run a paged search and collect all entries up to max_entries.
async fn collect_entries(
    client: &mut ldap_core::client::LdapClient,
    base_dn: &str,
    filter: &str,
    scope: Scope,
    attrs: Vec<&str>,
    page_size: i32,
    max_entries: usize,
) -> Result<Vec<LdapEntry>, String> {
    let mut all_entries: Vec<LdapEntry> = Vec::new();
    let mut cookie: Vec<u8> = vec![];

    loop {
        let pr = ldap3::controls::RawControl::from(
            ldap3::controls::PagedResults { size: page_size, cookie: cookie.clone() }
        );
        let sr = client.ldap
            .with_controls(vec![pr])
            .search(base_dn, scope, filter, attrs.clone())
            .await
            .map_err(|e| e.to_string())?;

        let ldap_result = &sr.1;
        if ldap_result.rc != 0 && ldap_result.rc != 4 && ldap_result.rc != 10 {
            return Err(format!("LDAP error {}: {}", ldap_result.rc, ldap_result.text));
        }

        for raw in sr.0 {
            let entry = SearchEntry::construct(raw);
            let mut attributes: Vec<ldap_core::LdapAttribute> = entry.attrs
                .into_iter()
                .map(|(name, values)| ldap_core::LdapAttribute {
                    is_operational: ldap_core::ldif::is_operational_attr(&name),
                    name,
                    values,
                })
                .collect();
            attributes.sort_by(|a, b| a.name.cmp(&b.name));
            all_entries.push(LdapEntry { dn: entry.dn, attributes });

            if max_entries > 0 && all_entries.len() >= max_entries { break; }
        }

        use ldap3::controls::ControlType;
        cookie = ldap_result.ctrls.iter()
            .find(|c| matches!(c.0, Some(ControlType::PagedResults)))
            .map(|c| c.1.parse::<ldap3::controls::PagedResults>().cookie)
            .unwrap_or_default();

        if cookie.is_empty() || (max_entries > 0 && all_entries.len() >= max_entries) {
            break;
        }
    }
    Ok(all_entries)
}

/// Export entries as LDIF string.
/// `max_entries = 0` means unlimited.
#[tauri::command]
pub async fn export_ldif(
    base_dn:             String,
    filter:              String,
    scope:               String,
    include_operational: bool,
    max_entries:         usize,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let ldap_scope = match scope.as_str() {
        "base" => Scope::Base,
        "one"  => Scope::OneLevel,
        _      => Scope::Subtree,
    };
    let mut g     = state.client.lock().await;
    let client    = g.as_mut().ok_or("Not connected")?;
    let page_size = *state.page_size.lock().await;
    let attrs: Vec<&str> = if include_operational { vec!["*", "+"] } else { vec!["*"] };

    let entries = collect_entries(client, &base_dn, &filter, ldap_scope,
                                   attrs, page_size, max_entries).await?;
    tracing::info!("export_ldif: {} entries from {}", entries.len(), base_dn);
    Ok(format_ldif(&entries, include_operational))
}

/// Export entries as a JSON array (for CSV/Excel/JSON export on the frontend).
/// `max_entries = 0` means unlimited.
#[tauri::command]
pub async fn export_entries(
    base_dn:             String,
    filter:              String,
    scope:               String,
    include_operational: bool,
    max_entries:         usize,
    state: State<'_, AppState>,
) -> Result<Vec<LdapEntry>, String> {
    let ldap_scope = match scope.as_str() {
        "base" => Scope::Base,
        "one"  => Scope::OneLevel,
        _      => Scope::Subtree,
    };
    let mut g     = state.client.lock().await;
    let client    = g.as_mut().ok_or("Not connected")?;
    let page_size = *state.page_size.lock().await;
    let attrs: Vec<&str> = if include_operational { vec!["*", "+"] } else { vec!["*"] };

    let mut entries = collect_entries(client, &base_dn, &filter, ldap_scope,
                                       attrs, page_size, max_entries).await?;

    // Filter out operational attrs if requested
    if !include_operational {
        for entry in &mut entries {
            entry.attributes.retain(|a| !a.is_operational);
        }
    }

    tracing::info!("export_entries: {} entries from {}", entries.len(), base_dn);
    Ok(entries)
}

// ─── LDIF Import ──────────────────────────────────────────────────────────────

/// Import entries from an LDIF string.
/// Returns a result summary.
#[tauri::command]
pub async fn import_ldif(
    content:           String,
    dry_run:           bool,
    continue_on_error: bool,
    state: State<'_, AppState>,
) -> Result<LdifImportResult, String> {
    let ops = parse_ldif(&content);
    let mut result = LdifImportResult::default();

    let mut g      = state.client.lock().await;
    let client     = g.as_mut().ok_or("Not connected")?;

    for op in &ops {
        let changetype = match op {
            LdifOp::Add    { .. } => "add",
            LdifOp::Modify { .. } => "modify",
            LdifOp::Delete { .. } => "delete",
        };
        let dn = match op {
            LdifOp::Add    { dn, .. } => dn.clone(),
            LdifOp::Modify { dn, .. } => dn.clone(),
            LdifOp::Delete { dn }     => dn.clone(),
        };

        if dry_run {
            match op {
                LdifOp::Add    { .. } => result.added    += 1,
                LdifOp::Modify { .. } => result.modified += 1,
                LdifOp::Delete { .. } => result.deleted  += 1,
            }
            result.entries.push(LdifEntryResult {
                dn, changetype: changetype.to_string(), success: true, error: None,
            });
            continue;
        }

        let op_result: Result<(), String> = match op {
            LdifOp::Add { dn, attrs } => {
                let attr_map: Vec<(String, HashSet<String>)> = {
                    let mut map: std::collections::HashMap<String, HashSet<String>> =
                        std::collections::HashMap::new();
                    for (k, v) in attrs {
                        map.entry(k.clone()).or_default().insert(v.clone());
                    }
                    map.into_iter().collect()
                };
                client.ldap.add(dn, attr_map).await
                    .map_err(|e| e.to_string())
                    .and_then(|r| r.success().map(|_| ()).map_err(|e| e.to_string()))
            }
            LdifOp::Modify { dn, mods } => {
                let ldap_mods: Vec<Mod<String>> = mods.iter().map(|m| {
                    let vals: HashSet<String> = m.values.iter().cloned().collect();
                    match m.op {
                        ldap_core::ModOp::Add     => Mod::Add(m.attr.clone(), vals),
                        ldap_core::ModOp::Delete  => Mod::Delete(m.attr.clone(), vals),
                        ldap_core::ModOp::Replace => Mod::Replace(m.attr.clone(), vals),
                    }
                }).collect();
                client.ldap.modify(dn, ldap_mods).await
                    .map_err(|e| e.to_string())
                    .and_then(|r| r.success().map(|_| ()).map_err(|e| e.to_string()))
            }
            LdifOp::Delete { dn } => {
                client.ldap.delete(dn).await
                    .map_err(|e| e.to_string())
                    .and_then(|r| r.success().map(|_| ()).map_err(|e| e.to_string()))
            }
        };

        match op_result {
            Ok(_) => {
                match op {
                    LdifOp::Add    { .. } => result.added    += 1,
                    LdifOp::Modify { .. } => result.modified += 1,
                    LdifOp::Delete { .. } => result.deleted  += 1,
                }
                result.entries.push(LdifEntryResult {
                    dn, changetype: changetype.to_string(), success: true, error: None,
                });
            }
            Err(e) => {
                result.failed += 1;
                result.errors.push(format!("{}: {}", dn, e));
                result.entries.push(LdifEntryResult {
                    dn, changetype: changetype.to_string(), success: false, error: Some(e.clone()),
                });
                if !continue_on_error { break; }
            }
        }
    }

    tracing::info!(
        "import_ldif: +{} ~{} -{} ✗{} (dry_run={})",
        result.added, result.modified, result.deleted, result.failed, dry_run
    );
    Ok(result)
}

