# Security and Disclaimer

## ⚠️ Status

LDAP Studio is a **hobby project under development**. It is:

- **Not security-audited** — the code has not been reviewed by a third party
- **Not production-tested** — no formal QA or load testing
- **Not guaranteed to be correct** — errors may occur in any operation, especially write operations

---

## Disclaimer

> The software is provided "as is" without any form of warranty, either
> expressed or implied. The authors disclaim any responsibility for
> **data loss, unintended directory changes, security breaches or other damages**
> arising from the use of this tool.

This is in accordance with the [MIT License](LICENSE) under which the project is released.

---

## Recommendations Before Use in Production

1. **Test in a test environment first** — set up a copy or a test tree and verify that
   all features behave as expected

2. **Use read-only mode** — mark the connection profile as read-only in
   the connection dialog; unlock temporarily only when actively making changes

3. **Take a backup** — export your directory as LDIF before making major changes
   (the `⬇ LDIF` button in the toolbar)

4. **Verify changes** — check that changes are correct afterwards

5. **Do not store sensitive information in profile passwords** on shared machines —
   connection profiles (incl. passwords) are stored locally in Tauri's app data folder

---

## Known Limitations

- No support for LDAP transactions (all changes are immediate and irreversible)
- No undo functionality
- Binary attributes (e.g. `jpegPhoto`, `userCertificate`) may be displayed incorrectly
- Very large directories (>100,000 entries) have not been load-tested
- modrdn/moddn (renaming/moving entries) is not implemented

---

## Report Security Bugs

If you discover a security vulnerability, report it as a **GitHub Issue** with
the label `security`. Do not include details about the vulnerability in public issues
— use GitHub Security Advisories for sensitive findings.
