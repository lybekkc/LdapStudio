use ldap_core::LdapClient;
use std::collections::HashMap;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

/// Shared application state managed by Tauri
pub struct AppState {
    pub client:        Mutex<Option<LdapClient>>,
    pub profiles:      Mutex<HashMap<String, ldap_core::ConnectionProfile>>, // kept for potential future server-side profile cache
    /// Replaced at the start of each search; cancel() to abort
    pub search_cancel: Mutex<Option<CancellationToken>>,
    /// Per-DN paging cookies for DIT tree browsing
    pub tree_cookies:  Mutex<HashMap<String, Vec<u8>>>,
    /// Page size for both search and tree — set by frontend
    pub page_size:     Mutex<i32>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            client:        Mutex::new(None),
            profiles:      Mutex::new(HashMap::new()),
            search_cancel: Mutex::new(None),
            tree_cookies:  Mutex::new(HashMap::new()),
            page_size:     Mutex::new(100),
        }
    }
}

/// Helper: map any error to a String for Tauri command results
pub fn err_str<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

