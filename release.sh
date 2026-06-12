#!/usr/bin/env bash
# ─── release.sh ───────────────────────────────────────────────────────────────
# Lag en ny release: bump versjon, commit, tag, push.
#
# Bruk:
#   ./release.sh 0.2.0
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Bruk: $0 <versjon>  (f.eks. $0 0.2.0)"
  exit 1
fi

# Validate semver
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Feil: versjon må være på format x.y.z (f.eks. 0.2.0)"
  exit 1
fi

echo "→ Setter versjon til $VERSION ..."

# Oppdater tauri.conf.json
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" \
  app/src-tauri/tauri.conf.json

# Oppdater app/package.json
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" \
  app/package.json

# Bekreft endringer
echo ""
echo "Endringer:"
git diff --stat

echo ""
read -p "Commit og tag v$VERSION? (j/N) " confirm
if [[ "$confirm" != "j" && "$confirm" != "J" ]]; then
  echo "Avbrutt."
  exit 0
fi

git add app/src-tauri/tauri.conf.json app/package.json
git commit -m "chore: bump version to $VERSION"
git tag -a "v$VERSION" -m "Release v$VERSION"

echo ""
read -p "Push til GitHub (trigger CI/CD)? (j/N) " push_confirm
if [[ "$push_confirm" == "j" || "$push_confirm" == "J" ]]; then
  git push origin HEAD
  git push origin "v$VERSION"
  echo ""
  echo "✓ Tag v$VERSION pushet — GitHub Actions bygger nå for alle plattformer!"
  echo "  Se fremdrift på: https://github.com/$(git remote get-url origin | sed 's/.*github.com[:/]//' | sed 's/\.git$//')/actions"
else
  echo ""
  echo "Tag opprettet lokalt. Push manuelt med:"
  echo "  git push origin HEAD && git push origin v$VERSION"
fi

