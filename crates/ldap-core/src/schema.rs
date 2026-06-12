use crate::types::*;

// ─── Token types ─────────────────────────────────────────────────────────────

#[derive(Debug, PartialEq)]
enum Tok {
    LParen,
    RParen,
    Dollar,
    Word(String),
    Quoted(String),
}

fn tokenize(s: &str) -> Vec<Tok> {
    let mut tokens = Vec::new();
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b' ' | b'\t' | b'\n' | b'\r' => i += 1,
            b'(' => { tokens.push(Tok::LParen); i += 1; }
            b')' => { tokens.push(Tok::RParen); i += 1; }
            b'$' => { tokens.push(Tok::Dollar);  i += 1; }
            b'\'' => {
                i += 1;
                let start = i;
                while i < bytes.len() && bytes[i] != b'\'' {
                    i += 1;
                }
                tokens.push(Tok::Quoted(String::from_utf8_lossy(&bytes[start..i]).into_owned()));
                i += 1; // consume closing '
            }
            _ => {
                let start = i;
                while i < bytes.len() && !matches!(bytes[i], b' '|b'\t'|b'\n'|b'\r'|b'('|b')'|b'$'|b'\'') {
                    i += 1;
                }
                tokens.push(Tok::Word(String::from_utf8_lossy(&bytes[start..i]).into_owned()));
            }
        }
    }
    tokens
}

struct Parser {
    tokens: Vec<Tok>,
    pos: usize,
}

impl Parser {
    fn new(tokens: Vec<Tok>) -> Self { Self { tokens, pos: 0 } }

    fn peek(&self) -> Option<&Tok> { self.tokens.get(self.pos) }

    fn next(&mut self) -> Option<&Tok> {
        let t = self.tokens.get(self.pos);
        if t.is_some() { self.pos += 1; }
        t
    }

    fn expect_word(&mut self) -> String {
        match self.next() {
            Some(Tok::Word(w)) => w.clone(),
            Some(Tok::Quoted(q)) => q.clone(),
            _ => String::new(),
        }
    }

    fn expect_quoted(&mut self) -> String {
        match self.next() {
            Some(Tok::Quoted(q)) => q.clone(),
            Some(Tok::Word(w)) => w.clone(),
            _ => String::new(),
        }
    }

    /// Parse either a single 'value' or a list ( 'v1' $ 'v2' )
    fn parse_oids_or_names(&mut self) -> Vec<String> {
        match self.peek() {
            Some(Tok::LParen) => {
                self.next(); // consume (
                let mut result = Vec::new();
                loop {
                    match self.peek() {
                        Some(Tok::RParen) => { self.next(); break; }
                        Some(Tok::Dollar) => { self.next(); }
                        Some(Tok::Quoted(_)) | Some(Tok::Word(_)) => {
                            result.push(self.expect_word());
                        }
                        _ => break,
                    }
                }
                result
            }
            Some(Tok::Quoted(_)) | Some(Tok::Word(_)) => {
                vec![self.expect_word()]
            }
            _ => vec![],
        }
    }
}

// ─── Object Class parser ──────────────────────────────────────────────────────

pub fn parse_object_class(s: &str) -> Option<ObjectClass> {
    let tokens = tokenize(s);
    let mut p = Parser::new(tokens);

    // consume leading (
    if p.next() != Some(&Tok::LParen) { return None; }

    let mut oc = ObjectClass::default();
    oc.oid = p.expect_word();
    oc.raw = s.to_string();

    loop {
        match p.peek() {
            None | Some(Tok::RParen) => break,
            Some(Tok::Word(_)) => {
                let kw = p.expect_word().to_uppercase();
                match kw.as_str() {
                    "NAME" => {
                        oc.names = p.parse_oids_or_names();
                        oc.name = oc.names.first().cloned().unwrap_or_default();
                    }
                    "DESC" => { oc.description = p.expect_quoted(); }
                    "SUP"  => { oc.superior = p.parse_oids_or_names(); }
                    "ABSTRACT"   => { oc.kind = ObjectClassKind::Abstract; }
                    "STRUCTURAL" => { oc.kind = ObjectClassKind::Structural; }
                    "AUXILIARY"  => { oc.kind = ObjectClassKind::Auxiliary; }
                    "MUST" => { oc.must_attrs = p.parse_oids_or_names(); }
                    "MAY"  => { oc.may_attrs = p.parse_oids_or_names(); }
                    "OBSOLETE" => { oc.obsolete = true; }
                    _ => {}
                }
            }
            _ => { p.next(); }
        }
    }

    if oc.name.is_empty() && !oc.names.is_empty() {
        oc.name = oc.names[0].clone();
    }
    Some(oc)
}

// ─── Attribute Type parser ────────────────────────────────────────────────────

pub fn parse_attribute_type(s: &str) -> Option<AttributeType> {
    let tokens = tokenize(s);
    let mut p = Parser::new(tokens);

    if p.next() != Some(&Tok::LParen) { return None; }

    let mut at = AttributeType::default();
    at.oid = p.expect_word();
    at.raw = s.to_string();

    loop {
        match p.peek() {
            None | Some(Tok::RParen) => break,
            Some(Tok::Word(_)) => {
                let kw = p.expect_word().to_uppercase();
                match kw.as_str() {
                    "NAME"     => {
                        at.names = p.parse_oids_or_names();
                        at.name = at.names.first().cloned().unwrap_or_default();
                    }
                    "DESC"     => { at.description = p.expect_quoted(); }
                    "SUP"      => { at.superior = Some(p.expect_word()); }
                    "EQUALITY" => { at.equality = Some(p.expect_word()); }
                    "ORDERING" => { at.ordering = Some(p.expect_word()); }
                    "SUBSTR"   => { at.substr    = Some(p.expect_word()); }
                    "SYNTAX"   => { at.syntax    = Some(p.expect_word()); }
                    "SINGLE-VALUE"          => { at.single_value = true; }
                    "COLLECTIVE"            => { at.collective = true; }
                    "NO-USER-MODIFICATION"  => { at.no_user_modification = true; }
                    "OBSOLETE"              => { at.obsolete = true; }
                    "USAGE" => {
                        let usage = p.expect_word();
                        at.usage = match usage.as_str() {
                            "directoryOperation"    => AttributeUsage::DirectoryOperation,
                            "distributedOperation"  => AttributeUsage::DistributedOperation,
                            "dSAOperation"          => AttributeUsage::DsaOperation,
                            _                       => AttributeUsage::UserApplications,
                        };
                    }
                    _ => {}
                }
            }
            _ => { p.next(); }
        }
    }

    Some(at)
}

// ─── Syntax / MatchingRule parsers ────────────────────────────────────────────

pub fn parse_ldap_syntax(s: &str) -> Option<LdapSyntax> {
    let tokens = tokenize(s);
    let mut p = Parser::new(tokens);
    if p.next() != Some(&Tok::LParen) { return None; }

    let mut syn = LdapSyntax::default();
    syn.oid = p.expect_word();

    loop {
        match p.peek() {
            None | Some(Tok::RParen) => break,
            Some(Tok::Word(_)) => {
                let kw = p.expect_word().to_uppercase();
                if kw == "DESC" { syn.description = p.expect_quoted(); }
            }
            _ => { p.next(); }
        }
    }
    Some(syn)
}

pub fn parse_matching_rule(s: &str) -> Option<MatchingRule> {
    let tokens = tokenize(s);
    let mut p = Parser::new(tokens);
    if p.next() != Some(&Tok::LParen) { return None; }

    let mut mr = MatchingRule::default();
    mr.oid = p.expect_word();

    loop {
        match p.peek() {
            None | Some(Tok::RParen) => break,
            Some(Tok::Word(_)) => {
                let kw = p.expect_word().to_uppercase();
                match kw.as_str() {
                    "NAME"   => {
                        let names = p.parse_oids_or_names();
                        mr.name = names.into_iter().next().unwrap_or_default();
                    }
                    "SYNTAX" => { mr.syntax_oid = p.expect_word(); }
                    _ => {}
                }
            }
            _ => { p.next(); }
        }
    }
    Some(mr)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_object_class() {
        let s = "( 2.5.6.0 NAME 'top' DESC 'top of the class hierarchy' ABSTRACT MUST objectClass )";
        let oc = parse_object_class(s).unwrap();
        assert_eq!(oc.name, "top");
        assert_eq!(oc.kind, ObjectClassKind::Abstract);
        assert!(oc.must_attrs.contains(&"objectClass".to_string()));
    }

    #[test]
    fn test_parse_attribute_type_single_value() {
        let s = "( 2.5.4.3 NAME ( 'cn' 'commonName' ) DESC 'RFC4519: common name(s)' SUP name EQUALITY caseIgnoreMatch SUBSTR caseIgnoreSubstringsMatch SYNTAX 1.3.6.1.4.1.1466.115.121.1.15 )";
        let at = parse_attribute_type(s).unwrap();
        assert!(at.names.contains(&"cn".to_string()));
        assert_eq!(at.equality.as_deref(), Some("caseIgnoreMatch"));
    }
}

