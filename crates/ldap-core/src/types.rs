use serde::{Deserialize, Serialize};

// ─── Connection ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub connection_type: ConnectionType,
    pub auth: AuthMethod,
    /// None = auto-detect from rootDSE namingContexts
    pub base_dn: Option<String>,
    pub timeout_secs: u64,
    /// UI-only guard: if true, writes are blocked in the client until explicitly unlocked
    #[serde(default)]
    pub read_only: bool,
}

impl Default for ConnectionProfile {
    fn default() -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: String::new(),
            host: String::new(),
            port: 636,
            connection_type: ConnectionType::Ldaps,
            auth: AuthMethod::Anonymous,
            base_dn: None,
            timeout_secs: 15,
            read_only: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConnectionType {
    Plain,
    Ldaps,
    StartTls,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AuthMethod {
    Anonymous,
    SimpleBind { bind_dn: String, password: String },
    SaslPlain  { authz_id: String, password: String },
}

// ─── Server info returned after connect ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerInfo {
    pub vendor_name: Option<String>,
    pub vendor_version: Option<String>,
    pub naming_contexts: Vec<String>,
    pub supported_ldap_versions: Vec<String>,
    pub supported_sasl_mechanisms: Vec<String>,
    pub active_base_dn: String,
}

// ─── Directory entries ────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LdapEntry {
    pub dn: String,
    pub attributes: Vec<LdapAttribute>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LdapAttribute {
    pub name: String,
    pub values: Vec<String>,
    pub is_operational: bool,
}

/// Returned by paginated search operations
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub entries:    Vec<LdapEntry>,
    /// True when the server has more results (cookie present)
    pub has_more:   bool,
    /// Current page number (1-based)
    pub page:       u32,
    /// Total entries fetched so far
    pub total:      usize,
}

/// Returned by paginated child listing
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildrenPage {
    pub nodes:    Vec<DitNode>,
    pub has_more: bool,
}

/// Lightweight node for DIT tree navigation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DitNode {
    pub dn: String,
    pub rdn: String,
    pub object_classes: Vec<String>,
    pub has_children: bool,
}

// ─── Write operations ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ModOp { Add, Delete, Replace }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LdapMod {
    pub op:     ModOp,
    pub attr:   String,
    pub values: Vec<String>,
}

/// Used for creating a new entry (Add operation)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewEntry {
    pub dn:         String,
    pub attributes: Vec<LdapMod>,
}

// ─── Sibling analysis ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiblingAnalysis {
    /// objectClass name + how many sampled entries have it (sorted desc)
    pub object_classes: Vec<CountedItem>,
    /// attribute name + how many sampled entries have it (sorted desc)
    pub attributes:     Vec<CountedItem>,
    /// number of entries actually sampled
    pub sample_count:   usize,
    /// detected RDN attribute patterns, sorted by frequency descending
    pub rdn_patterns:   Vec<RdnPattern>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountedItem {
    pub name:  String,
    pub count: usize,
}

/// Detected pattern for how the RDN value is formed in existing entries
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdnPattern {
    /// The RDN attribute (e.g. "uid", "cn")
    pub attr:       String,
    /// How many sampled entries used this attr as their RDN attribute
    pub count:      usize,
    /// Detected format of the RDN value
    pub value_type: RdnValueType,
    /// An actual example value from the data
    pub example:    String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RdnValueType {
    /// Matches UUID format (e.g. 550e8400-e29b-41d4-a716-446655440000)
    Uuid,
    /// All digits
    Number,
    /// Contains @ (email address)
    Email,
    /// Contains = (another DN used as value)
    Dn,
    /// Free-form text
    FreeText,
}

// ─── LDIF import result ───────────────────────────────────────────────────────

/// Per-entry outcome recorded in the import log.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LdifEntryResult {
    pub dn:         String,
    /// "add" | "modify" | "delete"
    pub changetype: String,
    pub success:    bool,
    pub error:      Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LdifImportResult {
    pub added:    usize,
    pub modified: usize,
    pub deleted:  usize,
    pub skipped:  usize,
    pub failed:   usize,
    pub errors:   Vec<String>,
    /// One entry per LDIF record, in order, populated even for dry-run.
    pub entries:  Vec<LdifEntryResult>,
}

// ─── Schema ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SchemaInfo {
    pub object_classes: Vec<ObjectClass>,
    pub attribute_types: Vec<AttributeType>,
    pub ldap_syntaxes: Vec<LdapSyntax>,
    pub matching_rules: Vec<MatchingRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ObjectClass {
    pub oid: String,
    pub name: String,
    pub names: Vec<String>,
    pub description: String,
    pub superior: Vec<String>,
    pub kind: ObjectClassKind,
    pub must_attrs: Vec<String>,
    pub may_attrs: Vec<String>,
    pub obsolete: bool,
    /// Raw schema definition string as returned by the server (needed for modifications)
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub raw: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ObjectClassKind {
    Abstract,
    #[default]
    Structural,
    Auxiliary,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AttributeType {
    pub oid: String,
    pub name: String,
    pub names: Vec<String>,
    pub description: String,
    pub superior: Option<String>,
    pub equality: Option<String>,
    pub ordering: Option<String>,
    pub substr: Option<String>,
    pub syntax: Option<String>,
    pub single_value: bool,
    pub collective: bool,
    pub no_user_modification: bool,
    pub usage: AttributeUsage,
    pub obsolete: bool,
    /// Raw schema definition string as returned by the server
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub raw: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AttributeUsage {
    #[default]
    UserApplications,
    DirectoryOperation,
    DistributedOperation,
    DsaOperation,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LdapSyntax {
    pub oid: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MatchingRule {
    pub oid: String,
    pub name: String,
    pub syntax_oid: String,
}

// ─── Error ────────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error, Serialize)]
pub enum LdapError {
    #[error("Connection failed: {0}")]
    Connection(String),
    #[error("Authentication failed: {0}")]
    Auth(String),
    #[error("LDAP operation failed: {0}")]
    Operation(String),
    #[error("TLS configuration error: {0}")]
    Tls(String),
    #[error("Not connected")]
    NotConnected,
    #[error("Schema parse error: {0}")]
    SchemaParse(String),
    #[error("IO error: {0}")]
    Io(String),
}

impl From<ldap3::LdapError> for LdapError {
    fn from(e: ldap3::LdapError) -> Self {
        LdapError::Operation(e.to_string())
    }
}

