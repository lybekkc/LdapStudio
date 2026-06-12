# Changelog

Alle merkbare endringer i LDAP Studio dokumenteres her.
Format basert på [Keep a Changelog](https://keepachangelog.com/no/1.0.0/).

---

## [Unreleased]

### Lagt til
- LDIF export og import med dry-run støtte
- CSV og Excel (.xlsx) export med konfigurerbare kolonner
- Schema-redigering (ObjectClass og AttributeType via LDAP modify)
- Auto-reconnect ved VPN/nettverk-tap (keepalive + exponentiell backoff)
- Read-only tilkoblingsprofiler med midlertidig opplåsing
- Redigering av objectClasses direkte i edit-modus
- Schema-baserte kompletterings-hint i redigeringsmodus
- Sibling-analyse for hint om manglende attributter
- RDN-mønstergjenkjenning (UUID, tall, e-post) ved oppretting
- Passord-attributt-støtte med SSHA/SSHA256/SSHA512 hashing
- Refresh av DIT-tre etter sletting
- Tab-preservering mellom Browser/Search/Schema

---

## [0.1.0] - 2026-06-12

### Lagt til
- Initial release
- DIT-tre-visning med lazy loading og paging
- Entry-detaljer med attributt-visning
- LDAP-søk med filtrering og sideinndeling
- Schema-browser (ObjectClass, AttributeType, Syntaxes, Matching Rules)
- Opprett, rediger og slett LDAP-entries
- Tilkoblingsprofiler med persistens
- Innstillinger (page size, OC-visning, splitter-størrelser)

