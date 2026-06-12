use std::collections::{HashMap, HashSet};
use regex::Regex;
use std::time::Duration;

use ldap3::{
    controls::{ControlType, PagedResults, RawControl},
    Ldap, LdapConnAsync, LdapConnSettings, Mod, Scope, SearchEntry,
};

use crate::schema::{parse_attribute_type, parse_ldap_syntax, parse_matching_rule, parse_object_class};
use crate::types::*;

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn build_ldap_url(profile: &ConnectionProfile) -> String {
    match profile.connection_type {
        ConnectionType::Ldaps => format!("ldaps://{}:{}", profile.host, profile.port),
        _                     => format!("ldap://{}:{}", profile.host, profile.port),
    }
}

fn ldap_settings(profile: &ConnectionProfile) -> LdapConnSettings {
    let mut s = LdapConnSettings::new()
        .set_conn_timeout(Duration::from_secs(profile.timeout_secs));

    // ldap3 with tls-rustls already loads system native certs via lazy_static.
    // StartTLS upgrade is set here; LDAPS is signalled by ldaps:// URL.
    if profile.connection_type == ConnectionType::StartTls {
        s = s.set_starttls(true);
    }
    s
}

// ─── LdapClient ──────────────────────────────────────────────────────────────

pub struct LdapClient {
    pub ldap: Ldap,
    pub server_info: ServerInfo,
    /// Cookie from the last paged search, used for fetching next page
    pub page_cookie: Vec<u8>,
    pub page_num: u32,
    pub page_total: usize,
}

impl LdapClient {
    /// Connect, bind, auto-detect base DN, and return a ready client.
    pub async fn connect(profile: &ConnectionProfile) -> Result<Self, LdapError> {
        let url      = build_ldap_url(profile);
        let settings = ldap_settings(profile);

        tracing::info!("Connecting to {}", url);

        let (conn, mut ldap) = LdapConnAsync::with_settings(settings, &url)
            .await
            .map_err(|e| LdapError::Connection(e.to_string()))?;

        ldap3::drive!(conn);

        // Authenticate
        match &profile.auth {
            AuthMethod::Anonymous => {}
            AuthMethod::SimpleBind { bind_dn, password } => {
                ldap.simple_bind(bind_dn, password)
                    .await
                    .map_err(|e| LdapError::Auth(e.to_string()))?
                    .success()
                    .map_err(|e| LdapError::Auth(e.to_string()))?;
            }
            AuthMethod::SaslPlain { authz_id, password } => {
                // SASL PLAIN over LDAPS is effectively simple bind with authzid
                ldap.simple_bind(authz_id, password)
                    .await
                    .map_err(|e| LdapError::Auth(e.to_string()))?
                    .success()
                    .map_err(|e| LdapError::Auth(e.to_string()))?;
            }
        }

        // Read rootDSE
        let server_info = Self::read_root_dse(&mut ldap, profile).await?;

        Ok(Self { ldap, server_info, page_cookie: vec![], page_num: 0, page_total: 0 })
    }

    async fn read_root_dse(
        ldap: &mut Ldap,
        profile: &ConnectionProfile,
    ) -> Result<ServerInfo, LdapError> {
        let attrs = vec![
            "*", "+",
            "vendorName", "vendorVersion",
            "namingContexts", "supportedLDAPVersion", "supportedSASLMechanisms",
        ];

        let (rs, _res) = ldap
            .search("", Scope::Base, "(objectClass=*)", attrs)
            .await
            .map_err(|e| LdapError::Operation(e.to_string()))?
            .success()
            .map_err(|e| LdapError::Operation(e.to_string()))?;

        let mut naming_contexts = Vec::new();
        let mut vendor_name = None;
        let mut vendor_version = None;
        let mut supported_versions = Vec::new();
        let mut supported_sasl = Vec::new();

        if let Some(raw) = rs.into_iter().next() {
            let entry = SearchEntry::construct(raw);
            naming_contexts = entry.attrs.get("namingContexts")
                .cloned().unwrap_or_default();
            vendor_name = entry.attrs.get("vendorName")
                .and_then(|v| v.first()).cloned();
            vendor_version = entry.attrs.get("vendorVersion")
                .and_then(|v| v.first()).cloned();
            supported_versions = entry.attrs.get("supportedLDAPVersion")
                .cloned().unwrap_or_default();
            supported_sasl = entry.attrs.get("supportedSASLMechanisms")
                .cloned().unwrap_or_default();
        }

        let active_base_dn = profile
            .base_dn
            .clone()
            .or_else(|| naming_contexts.first().cloned())
            .unwrap_or_default();

        Ok(ServerInfo {
            vendor_name,
            vendor_version,
            naming_contexts,
            supported_ldap_versions: supported_versions,
            supported_sasl_mechanisms: supported_sasl,
            active_base_dn,
        })
    }

    pub async fn disconnect(&mut self) -> Result<(), LdapError> {
        self.ldap.unbind().await.map_err(LdapError::from)
    }

    /// Lightweight keepalive — reads one rootDSE attribute.
    pub async fn ping(&mut self) -> Result<(), LdapError> {
        self.ldap
            .search("", Scope::Base, "(objectClass=*)", vec!["supportedLDAPVersion"])
            .await
            .map(|_| ())
            .map_err(LdapError::from)
    }

    /// Modify a schema entry attribute (objectClasses or attributeTypes).
    /// - `old_raw`: the raw definition to delete (empty string = create new)
    /// - `new_raw`: the new definition to add (empty string = delete only)
    pub async fn modify_schema_entry(
        &mut self,
        schema_dn: &str,
        attr_name:  &str,   // "objectClasses" or "attributeTypes"
        old_raw:    &str,
        new_raw:    &str,
    ) -> Result<(), LdapError> {
        let mut mods: Vec<Mod<String>> = Vec::new();

        // Delete old definition first (if present)
        if !old_raw.is_empty() {
            let mut vals = HashSet::new();
            vals.insert(old_raw.to_string());
            mods.push(Mod::Delete(attr_name.to_string(), vals));
        }

        // Add new definition (if present)
        if !new_raw.is_empty() {
            let mut vals = HashSet::new();
            vals.insert(new_raw.to_string());
            mods.push(Mod::Add(attr_name.to_string(), vals));
        }

        if mods.is_empty() {
            return Ok(());
        }

        self.ldap
            .modify(schema_dn, mods)
            .await?
            .success()
            .map_err(LdapError::from)?;

        tracing::info!("Modified schema {attr_name} on {schema_dn}");
        Ok(())
    }

    // ─── DIT navigation ──────────────────────────────────────────────────────

    /// List one-level children with LDAP paging.
    /// Pass `cookie = vec![]` for the first page, or the cookie from the previous call.
    /// Returns `(ChildrenPage, next_cookie)` — next_cookie is empty when no more pages.
    pub async fn list_children_page(
        &mut self,
        dn: &str,
        page_size: i32,
        cookie: Vec<u8>,
    ) -> Result<(ChildrenPage, Vec<u8>), LdapError> {
        let pr_ctrl = RawControl::from(PagedResults { size: page_size, cookie });

        let sr = self.ldap
            .with_controls(vec![pr_ctrl])
            .search(
                dn, Scope::OneLevel, "(objectClass=*)",
                vec!["objectClass", "hasSubordinates"],
            )
            .await?;

        let ldap_result = &sr.1;
        // rc 0 = Success, rc 4 = SizeLimitExceeded (partial results OK), rc 10 = Referral
        let size_limited = ldap_result.rc == 4;
        if ldap_result.rc != 0 && ldap_result.rc != 4 && ldap_result.rc != 10 {
            return Err(LdapError::Operation(
                format!("LDAP error {}: {}", ldap_result.rc, ldap_result.text)
            ));
        }

        let next_cookie = ldap_result
            .ctrls.iter()
            .find(|c| matches!(c.0, Some(ControlType::PagedResults)))
            .map(|c| c.1.parse::<PagedResults>().cookie)
            .unwrap_or_default();

        let mut nodes: Vec<DitNode> = sr.0
            .into_iter()
            .map(|raw| {
                let entry = SearchEntry::construct(raw);
                let rdn = entry.dn.split(',').next().unwrap_or(&entry.dn).to_string();
                let object_classes = entry.attrs.get("objectClass").cloned().unwrap_or_default();
                let has_children = entry.attrs.get("hasSubordinates")
                    .and_then(|v| v.first())
                    .map(|s| s.eq_ignore_ascii_case("true"))
                    .unwrap_or(false);
                DitNode { dn: entry.dn, rdn, object_classes, has_children }
            })
            .collect();

        nodes.sort_by(|a, b| a.rdn.cmp(&b.rdn));

        // has_more if the server gave us a paging cookie OR we hit the server size limit
        let has_more = !next_cookie.is_empty() || size_limited;

        tracing::info!(
            "list_children '{}': {} nodes, rc={}, has_more={} (cookie={}, size_limited={})",
            dn, nodes.len(), ldap_result.rc, has_more, !next_cookie.is_empty(), size_limited
        );

        Ok((ChildrenPage { nodes, has_more }, next_cookie))
    }

    /// Fetch all attributes (user + operational) for a specific entry.
    pub async fn get_entry(&mut self, dn: &str) -> Result<LdapEntry, LdapError> {        // "*" = all user attributes, "+" = all operational attributes
        let (rs, _) = self.ldap
            .search(dn, Scope::Base, "(objectClass=*)", vec!["*", "+"])
            .await?
            .success()
            .map_err(LdapError::from)?;

        let raw = rs.into_iter().next()
            .ok_or_else(|| LdapError::Operation(format!("Entry not found: {dn}")))?;
        let entry = SearchEntry::construct(raw);

        let operational_attrs = [
            "createTimestamp", "modifyTimestamp", "creatorsName", "modifiersName",
            "entryUUID", "entryDN", "subschemaSubentry", "hasSubordinates",
            "numSubordinates", "structuralObjectClass",
        ];

        let mut attributes: Vec<LdapAttribute> = entry
            .attrs
            .into_iter()
            .map(|(name, values)| {
                let is_operational = operational_attrs.contains(&name.as_str())
                    || name.starts_with("ds-") || name.starts_with("pwdPolicy");
                LdapAttribute { name, values, is_operational }
            })
            .collect();

        attributes.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(LdapEntry { dn: entry.dn, attributes })
    }

    // ─── Write operations ─────────────────────────────────────────────────────

    /// Modify an existing entry using a list of LDAP modification operations.
    pub async fn modify_entry(&mut self, dn: &str, mods: Vec<LdapMod>) -> Result<(), LdapError> {
        let ldap_mods: Vec<Mod<String>> = mods
            .into_iter()
            .map(|m| {
                let values: HashSet<String> = m.values.into_iter().collect();
                match m.op {
                    ModOp::Add     => Mod::Add(m.attr, values),
                    ModOp::Delete  => Mod::Delete(m.attr, values),
                    ModOp::Replace => Mod::Replace(m.attr, values),
                }
            })
            .collect();

        self.ldap
            .modify(dn, ldap_mods)
            .await?
            .success()
            .map_err(LdapError::from)?;

        tracing::info!("Modified entry: {}", dn);
        Ok(())
    }

    /// Delete an entry by DN.
    pub async fn delete_entry(&mut self, dn: &str) -> Result<(), LdapError> {
        self.ldap
            .delete(dn)
            .await?
            .success()
            .map_err(LdapError::from)?;

        tracing::info!("Deleted entry: {}", dn);
        Ok(())
    }

    /// Add a new entry.
    pub async fn add_entry(&mut self, entry: &NewEntry) -> Result<(), LdapError> {
        let attrs: Vec<(String, HashSet<String>)> = entry
            .attributes
            .iter()
            .map(|m| (m.attr.clone(), m.values.iter().cloned().collect()))
            .collect();

        self.ldap
            .add(&entry.dn, attrs)
            .await?
            .success()
            .map_err(LdapError::from)?;

        tracing::info!("Added entry: {}", entry.dn);
        Ok(())
    }

    /// Rename and/or move an entry using the LDAP ModifyDN operation.
    /// - `new_rdn`: the new relative DN, e.g. `uid=johnny`
    /// - `delete_old_rdn`: if true, removes the old RDN attribute value after rename
    /// - `new_superior`: if Some, moves the entry under this new parent DN
    pub async fn rename_entry(
        &mut self,
        dn:             &str,
        new_rdn:        &str,
        delete_old_rdn: bool,
        new_superior:   Option<&str>,
    ) -> Result<(), LdapError> {
        self.ldap
            .modifydn(dn, new_rdn, delete_old_rdn, new_superior)
            .await?
            .success()
            .map_err(LdapError::from)?;

        tracing::info!(
            "Renamed/moved entry: {} → rdn={}, del_old={}, sup={:?}",
            dn, new_rdn, delete_old_rdn, new_superior
        );
        Ok(())
    }

    /// Sample up to `sample_size` one-level children of `parent_dn` and return
    /// frequency counts of objectClasses, attributes, and RDN patterns found.
    pub async fn analyze_siblings(
        &mut self,
        parent_dn: &str,
        sample_size: i32,
    ) -> Result<SiblingAnalysis, LdapError> {
        let pr_ctrl = RawControl::from(PagedResults { size: sample_size, cookie: vec![] });

        let sr = self.ldap
            .with_controls(vec![pr_ctrl])
            .search(parent_dn, Scope::OneLevel, "(objectClass=*)", vec!["objectClass", "*"])
            .await?;
        // Ignore rc here — partial results are fine for analysis
        let _ = &sr.1;

        let mut oc_counts:   HashMap<String, usize> = HashMap::new();
        let mut attr_counts: HashMap<String, usize> = HashMap::new();
        // rdn_attr -> Vec<rdn_value>
        let mut rdn_values:  HashMap<String, Vec<String>> = HashMap::new();
        let mut sample_count = 0_usize;

        for raw in sr.0 {
            let entry = SearchEntry::construct(raw);
            sample_count += 1;

            // Parse first RDN component from DN
            if let Some(first_rdn) = entry.dn.split(',').next() {
                if let Some(eq_pos) = first_rdn.find('=') {
                    let rdn_attr  = first_rdn[..eq_pos].trim().to_string();
                    let rdn_value = first_rdn[eq_pos + 1..].trim().to_string();
                    rdn_values.entry(rdn_attr).or_default().push(rdn_value);
                }
            }

            if let Some(ocs) = entry.attrs.get("objectClass") {
                for oc in ocs {
                    *oc_counts.entry(oc.clone()).or_insert(0) += 1;
                }
            }
            for (attr, _) in &entry.attrs {
                if attr != "objectClass" {
                    *attr_counts.entry(attr.clone()).or_insert(0) += 1;
                }
            }
        }

        let mut object_classes: Vec<CountedItem> = oc_counts
            .into_iter()
            .map(|(name, count)| CountedItem { name, count })
            .collect();
        object_classes.sort_by(|a, b| b.count.cmp(&a.count).then(a.name.cmp(&b.name)));

        let mut attributes: Vec<CountedItem> = attr_counts
            .into_iter()
            .map(|(name, count)| CountedItem { name, count })
            .collect();
        attributes.sort_by(|a, b| b.count.cmp(&a.count).then(a.name.cmp(&b.name)));

        // Build RDN patterns
        let uuid_re = Regex::new(
            r"(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        ).unwrap();
        let number_re = Regex::new(r"^\d+$").unwrap();

        let mut rdn_patterns: Vec<RdnPattern> = rdn_values
            .into_iter()
            .map(|(attr, values)| {
                let count = values.len();
                let example = values.first().cloned().unwrap_or_default();
                // Detect the most common value type in the sample
                let value_type = detect_rdn_value_type(&example, &uuid_re, &number_re);
                RdnPattern { attr, count, value_type, example }
            })
            .collect();
        rdn_patterns.sort_by(|a, b| b.count.cmp(&a.count).then(a.attr.cmp(&b.attr)));

        tracing::info!(
            "analyze_siblings '{}': {} entries sampled, {} OCs, {} attrs, {} RDN patterns",
            parent_dn, sample_count, object_classes.len(), attributes.len(), rdn_patterns.len()
        );

        Ok(SiblingAnalysis { object_classes, attributes, sample_count, rdn_patterns })
    }

    /// Paginated search using LDAP Simple Paged Results Control (RFC 2696).
    /// Call with `reset = true` to start a new search; `false` continues from stored cookie.
    pub async fn search_page(
        &mut self,
        base: &str,
        filter: &str,
        scope: &str,
        page_size: i32,
        reset: bool,
    ) -> Result<SearchPage, LdapError> {
        if reset {
            self.page_cookie = vec![];
            self.page_num    = 0;
            self.page_total  = 0;
        }

        // If no cookie and not first page, we're done
        if !reset && self.page_cookie.is_empty() {
            return Ok(SearchPage { entries: vec![], has_more: false, page: self.page_num, total: self.page_total });
        }

        let ldap_scope = match scope {
            "base" => Scope::Base,
            "one"  => Scope::OneLevel,
            _      => Scope::Subtree,
        };

        let pr_ctrl = RawControl::from(PagedResults {
            size:   page_size,
            cookie: self.page_cookie.clone(),
        });

        // ldap3 search returns ldap3::SearchResult (tuple struct)
        let sr = self.ldap
            .with_controls(vec![pr_ctrl])
            .search(base, ldap_scope, filter, vec!["*"])
            .await?;

        // sr is ldap3::SearchResult(Vec<ResultEntry>, LdapResult)
        let ldap_result = &sr.1;
        if ldap_result.rc != 0 && ldap_result.rc != 10 {
            return Err(LdapError::Operation(
                format!("LDAP error {}: {}", ldap_result.rc, ldap_result.text)
            ));
        }

        // Extract paged results cookie from response controls
        self.page_cookie = ldap_result
            .ctrls
            .iter()
            .find(|c| matches!(c.0, Some(ControlType::PagedResults)))
            .map(|c| c.1.parse::<PagedResults>().cookie)
            .unwrap_or_default();

        let entries: Vec<LdapEntry> = sr.0
            .into_iter()
            .map(|raw| {
                let entry = SearchEntry::construct(raw);
                let attributes = entry.attrs.into_iter().map(|(name, values)| LdapAttribute {
                    is_operational: name.starts_with("ds-"),
                    name,
                    values,
                }).collect();
                LdapEntry { dn: entry.dn, attributes }
            })
            .collect();

        self.page_num   += 1;
        self.page_total += entries.len();
        let has_more     = !self.page_cookie.is_empty();

        tracing::info!(
            "Search page {}: {} entries, has_more={}",
            self.page_num, entries.len(), has_more
        );

        Ok(SearchPage {
            entries,
            has_more,
            page:  self.page_num,
            total: self.page_total,
        })
    }

    // ─── Schema ───────────────────────────────────────────────────────────────

    pub async fn get_schema(&mut self) -> Result<SchemaInfo, LdapError> {
        // Find the subschema subentry DN (usually cn=schema)
        let schema_dn = self.find_schema_dn().await?;

        tracing::info!("Reading schema from {}", schema_dn);

        let (rs, _) = self.ldap
            .search(
                &schema_dn,
                Scope::Base,
                "(objectClass=subschema)",
                vec!["objectClasses", "attributeTypes", "ldapSyntaxes", "matchingRules"],
            )
            .await?
            .success()
            .map_err(LdapError::from)?;

        let raw = rs.into_iter().next()
            .ok_or_else(|| LdapError::SchemaParse("No schema entry found".into()))?;
        let entry = SearchEntry::construct(raw);

        let object_classes = entry
            .attrs
            .get("objectClasses")
            .map(|vals| vals.iter().filter_map(|s| parse_object_class(s)).collect())
            .unwrap_or_default();

        let attribute_types = entry
            .attrs
            .get("attributeTypes")
            .map(|vals| vals.iter().filter_map(|s| parse_attribute_type(s)).collect())
            .unwrap_or_default();

        let ldap_syntaxes = entry
            .attrs
            .get("ldapSyntaxes")
            .map(|vals| vals.iter().filter_map(|s| parse_ldap_syntax(s)).collect())
            .unwrap_or_default();

        let matching_rules = entry
            .attrs
            .get("matchingRules")
            .map(|vals| vals.iter().filter_map(|s| parse_matching_rule(s)).collect())
            .unwrap_or_default();

        Ok(SchemaInfo { object_classes, attribute_types, ldap_syntaxes, matching_rules })
    }

    async fn find_schema_dn(&mut self) -> Result<String, LdapError> {        // Ask rootDSE for subschemaSubentry
        let (rs, _) = self.ldap
            .search("", Scope::Base, "(objectClass=*)", vec!["subschemaSubentry"])
            .await?
            .success()
            .map_err(LdapError::from)?;

        if let Some(raw) = rs.into_iter().next() {
            let entry = SearchEntry::construct(raw);
            if let Some(dn) = entry.attrs.get("subschemaSubentry").and_then(|v| v.first()) {
                return Ok(dn.clone());
            }
        }
        // Fallback for PingDS / OpenDJ
        Ok("cn=schema".into())
    }
}

// ─── Free function helpers ────────────────────────────────────────────────────

fn detect_rdn_value_type(value: &str, uuid_re: &Regex, number_re: &Regex) -> RdnValueType {
    if uuid_re.is_match(value) {
        RdnValueType::Uuid
    } else if number_re.is_match(value) {
        RdnValueType::Number
    } else if value.contains('@') {
        RdnValueType::Email
    } else if value.contains('=') {
        RdnValueType::Dn
    } else {
        RdnValueType::FreeText
    }
}
