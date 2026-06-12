# Sikkerhet og ansvarsfraskrivelse

## ⚠️ Status

LDAP Studio er et **hobbyprosjekt under utvikling**. Det er:

- **Ikke sikkerhetsrevidert** — koden er ikke gjennomgått av en tredjepart
- **Ikke produksjonstestet** — ingen formell QA eller belastningstesting
- **Ikke garantert korrekt** — feil kan forekomme i alle operasjoner, spesielt skriveoperasjoner

---

## Ansvarsfraskrivelse

> Programvaren leveres «som den er» uten noen form for garanti, verken
> uttrykt eller underforstått. Forfatterne fraskriver seg ethvert ansvar for
> **datatap, uønskede katalogendringer, sikkerhetsbrudd eller andre skader**
> som oppstår ved bruk av dette verktøyet.

Dette er i tråd med [MIT-lisensen](LICENSE) som prosjektet er utgitt under.

---

## Anbefalinger før bruk mot produksjon

1. **Test i et testmiljø først** — sett opp en kopi eller et testtre og verifiser at
   alle funksjoner oppfører seg som forventet

2. **Bruk read-only modus** — marker tilkoblingsprofilen som read-only i
   tilkoblingsdialogen; lås opp midlertidig kun når du aktivt skal gjøre endringer

3. **Ta backup** — eksporter katalogen din som LDIF før du gjør større endringer
   (`⬇ LDIF`-knappen i verktøylinjen)

4. **Verifiser endringer** — sjekk at endringer er korrekte i etterkant

5. **Ikke lagre sensitiv informasjon i profilpassord** på delte maskiner —
   tilkoblingsprofiler (inkl. passord) lagres lokalt i Tauris app-data-mappe

---

## Kjente begrensninger

- Ingen støtte for LDAP-transaksjoner (alle endringer er umiddelbare og irreversible)
- Ingen angre-funksjonalitet
- Binære attributter (f.eks. `jpegPhoto`, `userCertificate`) kan vises feil
- Meget store kataloger (>100 000 entries) er ikke belastningstestet
- modrdn/moddn (renaming/moving entries) er ikke implementert

---

## Rapporter sikkerhetsbugs

Oppdag du en sikkerhetssårbarhet, meld dette som et **GitHub Issue** med
merkelappen `security`. Ikke inkluder detaljer om sårbarheten i offentlige issues
— bruk GitHub Security Advisories for sensitive funn.

