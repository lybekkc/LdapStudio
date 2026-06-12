use crate::types::{LdapEntry, ModOp};

// ─── Constants ────────────────────────────────────────────────────────────────

const LINE_LIMIT: usize = 76;

static OPERATIONAL_ATTRS: &[&str] = &[
    "createTimestamp", "modifyTimestamp", "creatorsName", "modifiersName",
    "entryUUID", "entryDN", "subschemaSubentry", "hasSubordinates",
    "numSubordinates", "structuralObjectClass", "pwdChangedTime",
    "pwdAccountLockedTime", "pwdFailureTime", "pwdHistory",
    "nsAccountLock", "nsUniqueId", "parentid", "entryid",
];

pub fn is_operational_attr(name: &str) -> bool {
    OPERATIONAL_ATTRS.contains(&name) || name.starts_with("ds-") || name.starts_with("aci")
}

// ─── Base64 (minimal implementation, no external crate needed) ────────────────

static B64_TABLE: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn b64_encode(bytes: &[u8]) -> String {
    let mut out = Vec::with_capacity((bytes.len() + 2) / 3 * 4);
    let mut i = 0;
    while i < bytes.len() {
        let b0 = bytes[i] as u32;
        let b1 = if i + 1 < bytes.len() { bytes[i + 1] as u32 } else { 0 };
        let b2 = if i + 2 < bytes.len() { bytes[i + 2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64_TABLE[((n >> 18) & 63) as usize]);
        out.push(B64_TABLE[((n >> 12) & 63) as usize]);
        out.push(if i + 1 < bytes.len() { B64_TABLE[((n >> 6) & 63) as usize] } else { b'=' });
        out.push(if i + 2 < bytes.len() { B64_TABLE[(n & 63) as usize] } else { b'=' });
        i += 3;
    }
    String::from_utf8(out).unwrap_or_default()
}

pub fn b64_decode(s: &str) -> Option<Vec<u8>> {
    const DEC: [i8; 256] = {
        let mut t = [-1i8; 256];
        let enc = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut i = 0usize;
        while i < 64 { t[enc[i] as usize] = i as i8; i += 1; }
        t
    };
    let clean: Vec<u8> = s.bytes().filter(|&b| !matches!(b, b'\n' | b'\r' | b' ')).collect();
    if clean.len() % 4 != 0 { return None; }
    let mut out = Vec::with_capacity(clean.len() / 4 * 3);
    let mut i = 0;
    while i < clean.len() {
        let v = [
            DEC[clean[i] as usize],
            DEC[clean[i+1] as usize],
            DEC[clean[i+2] as usize],
            DEC[clean[i+3] as usize],
        ];
        if v[0] < 0 || v[1] < 0 { return None; }
        let n = ((v[0] as u32) << 18) | ((v[1] as u32) << 12)
              | ((if v[2] < 0 { 0 } else { v[2] as u32 }) << 6)
              | (if v[3] < 0 { 0 } else { v[3] as u32 });
        out.push((n >> 16) as u8);
        if clean[i+2] != b'=' { out.push((n >> 8) as u8); }
        if clean[i+3] != b'=' { out.push(n as u8); }
        i += 4;
    }
    Some(out)
}

// ─── LDIF formatting ──────────────────────────────────────────────────────────

/// Returns true when value must be base64-encoded in LDIF.
fn needs_b64(value: &str) -> bool {
    if value.is_empty() { return false; }
    let bytes = value.as_bytes();
    // Starts with unsafe chars
    if matches!(bytes[0], 0 | b'\n' | b'\r' | b' ' | b':' | b'<') { return true; }
    // Ends with space
    if bytes.last() == Some(&b' ') { return true; }
    // Contains control chars or non-ASCII
    bytes.iter().any(|&b| b == 0 || b == b'\n' || b == b'\r' || b > 127)
}

/// Wrap a single LDIF line at LINE_LIMIT with continuation space.
fn wrap_line(line: &str) -> String {
    if line.len() <= LINE_LIMIT { return line.to_owned(); }
    let mut result = String::with_capacity(line.len() + line.len() / LINE_LIMIT * 2);
    result.push_str(&line[..LINE_LIMIT]);
    let mut pos = LINE_LIMIT;
    while pos < line.len() {
        result.push('\n');
        result.push(' ');
        let end = (pos + LINE_LIMIT - 1).min(line.len());
        result.push_str(&line[pos..end]);
        pos = end;
    }
    result
}

/// Format a single LDAP entry as LDIF text.
pub fn format_entry(entry: &LdapEntry, include_operational: bool) -> String {
    let mut lines: Vec<String> = Vec::new();

    // DN
    if needs_b64(&entry.dn) {
        lines.push(wrap_line(&format!("dn:: {}", b64_encode(entry.dn.as_bytes()))));
    } else {
        lines.push(wrap_line(&format!("dn: {}", entry.dn)));
    }

    for attr in &entry.attributes {
        if !include_operational && (attr.is_operational || is_operational_attr(&attr.name)) {
            continue;
        }
        for value in &attr.values {
            if needs_b64(value) {
                lines.push(wrap_line(&format!("{}:: {}", attr.name, b64_encode(value.as_bytes()))));
            } else {
                lines.push(wrap_line(&format!("{}: {}", attr.name, value)));
            }
        }
    }

    lines.join("\n")
}

/// Format a slice of LDAP entries into a complete LDIF document.
pub fn format_ldif(entries: &[LdapEntry], include_operational: bool) -> String {
    let mut out = String::from("version: 1\n");
    for entry in entries {
        out.push('\n');
        out.push_str(&format_entry(entry, include_operational));
        out.push('\n');
    }
    out
}

// ─── LDIF parsing ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub enum LdifOp {
    Add    { dn: String, attrs: Vec<(String, String)> },
    Modify { dn: String, mods:  Vec<LdifModBlock>     },
    Delete { dn: String },
}

#[derive(Debug, Clone)]
pub struct LdifModBlock {
    pub op:     ModOp,
    pub attr:   String,
    pub values: Vec<String>,
}

/// Unfold continuation lines and strip comments.
fn unfold(content: &str) -> String {
    let mut out = String::with_capacity(content.len());
    for line in content.lines() {
        if line.starts_with('#') { continue; }
        if let Some(cont) = line.strip_prefix(' ') {
            if out.ends_with('\n') { out.pop(); }
            out.push_str(cont);
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

fn parse_value_line(line: &str) -> Option<(String, String)> {
    // attr:: base64value
    if let Some(pos) = line.find(":: ") {
        let name  = line[..pos].to_string();
        let raw   = line[pos + 3..].trim();
        let value = b64_decode(raw)
            .and_then(|b| String::from_utf8(b).ok())
            .unwrap_or_else(|| raw.to_string());
        return Some((name, value));
    }
    // attr: value
    if let Some(pos) = line.find(": ") {
        return Some((line[..pos].to_string(), line[pos + 2..].to_string()));
    }
    None
}

/// Parse an LDIF string into a list of operations.
pub fn parse_ldif(content: &str) -> Vec<LdifOp> {
    let unfolded = unfold(content);

    // Split by blank lines into records
    let mut records: Vec<Vec<&str>> = Vec::new();
    let mut cur: Vec<&str> = Vec::new();
    for line in unfolded.lines() {
        if line.is_empty() {
            if !cur.is_empty() { records.push(std::mem::take(&mut cur)); }
        } else {
            cur.push(line);
        }
    }
    if !cur.is_empty() { records.push(cur); }

    let mut ops = Vec::new();

    for record in &records {
        // Skip version line
        if record.len() == 1 && record[0].starts_with("version:") { continue; }
        if record.is_empty() { continue; }

        // First line must be dn:
        let dn = match parse_value_line(record[0]) {
            Some((n, v)) if n.eq_ignore_ascii_case("dn") => v,
            _ => continue,
        };

        // Check for changetype
        let changetype = record.iter().skip(1).find_map(|line| {
            parse_value_line(line)
                .filter(|(n, _)| n.eq_ignore_ascii_case("changetype"))
                .map(|(_, v)| v.to_lowercase())
        });

        match changetype.as_deref() {
            // Content record or explicit add
            None | Some("add") => {
                let attrs: Vec<(String, String)> = record.iter().skip(1)
                    .filter(|l| !l.to_lowercase().starts_with("changetype"))
                    .filter_map(|l| parse_value_line(l))
                    .collect();
                if !attrs.is_empty() {
                    ops.push(LdifOp::Add { dn, attrs });
                }
            }
            Some("delete") => {
                ops.push(LdifOp::Delete { dn });
            }
            Some("modify") => {
                let mut mods: Vec<LdifModBlock> = Vec::new();
                let body: Vec<&str> = record.iter().skip(1)
                    .filter(|l| !l.to_lowercase().starts_with("changetype"))
                    .copied().collect();

                let mut i = 0;
                while i < body.len() {
                    let line = body[i];
                    if line == "-" { i += 1; continue; }

                    let parsed_op: Option<(ModOp, String)> =
                        if let Some((kw, attr)) = parse_value_line(line) {
                            match kw.to_lowercase().as_str() {
                                "add"     => Some((ModOp::Add,     attr)),
                                "delete"  => Some((ModOp::Delete,  attr)),
                                "replace" => Some((ModOp::Replace, attr)),
                                _ => None,
                            }
                        } else { None };

                    if let Some((op, attr)) = parsed_op {
                        i += 1;
                        let mut values = Vec::new();
                        while i < body.len() && body[i] != "-" {
                            if let Some((name, val)) = parse_value_line(body[i]) {
                                if name.eq_ignore_ascii_case(&attr) {
                                    values.push(val);
                                }
                            }
                            i += 1;
                        }
                        mods.push(LdifModBlock { op, attr, values });
                    } else {
                        i += 1;
                    }
                }
                if !mods.is_empty() {
                    ops.push(LdifOp::Modify { dn, mods });
                }
            }
            _ => {} // modrdn etc. — skip
        }
    }

    ops
}

