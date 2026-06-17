# Signing & Notarizing Claude Spark

The build is **unsigned by default** (`npm run dist`). To distribute without the macOS
Gatekeeper "unidentified developer" warning, sign with a **Developer ID Application**
certificate and **notarize** with Apple. Everything is already wired — you just need an
Apple Developer account and credentials, then one command.

> Status on this machine: `security find-identity -v -p codesigning` shows **0 identities**,
> so signing can't run yet. Do steps 1–3, then build with step 4.

## 1. Apple Developer Program ($99/yr)
Enroll at <https://developer.apple.com/programs/>. Required for a Developer ID certificate.

## 2. Create the Developer ID Application certificate
Easiest via Xcode: **Xcode → Settings → Accounts → (your team) → Manage Certificates → +
→ Developer ID Application**. It installs into your login keychain. Verify:

```bash
security find-identity -v -p codesigning
# should list:  "Developer ID Application: Your Name (TEAMID)"
```

(Alternatively create it on developer.apple.com and download/double-click the `.cer`.)

## 3. Notarization credentials (pick ONE)

**A — App Store Connect API key (recommended, no password in env):**
Create an API key at App Store Connect → Users and Access → Integrations → keys. Download the
`.p8`. Then:
```bash
export APPLE_API_KEY=/path/to/AuthKey_XXXX.p8
export APPLE_API_KEY_ID=XXXXXXXXXX
export APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

**B — Apple ID + app-specific password:**
Create an app-specific password at <https://appleid.apple.com> → Sign-In and Security. Get your
Team ID from the developer portal membership page. Then:
```bash
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="abcd-efgh-ijkl-mnop"
export APPLE_TEAM_ID="TEAMID10"
```

## 4. Build signed + notarized
```bash
unset CSC_IDENTITY_AUTO_DISCOVERY      # allow keychain identity discovery
npm run dist:signed
```
This signs the app (hardened runtime + `build/entitlements.mac.plist`, including the
`uiohook-napi` native module), notarizes the `.dmg` via `notarytool`, and staples the ticket.

## 5. Verify
```bash
APP="release/mac-universal/Claude Spark.app"
codesign --verify --deep --strict --verbose=2 "$APP"
spctl -a -vvv -t install "$APP"                       # => accepted, source=Notarized Developer ID
xcrun stapler validate "release/Claude Spark-1.1.0-universal.dmg"
```

## Notes
- **Never commit credentials.** Use env vars (or a local, git-ignored `.env`). `.p8`/`.p12`
  files and passwords must stay out of the repo.
- If you use a `.p12` instead of the keychain identity, set `CSC_LINK=/path/cert.p12` and
  `CSC_KEY_PASSWORD=...` instead of relying on auto-discovery.
- Entitlements live in `build/entitlements.mac.plist`; signing config is in
  `electron-builder.config.js` (gated on `SIGN=1`).
- The native module **must** stay in `asarUnpack` (already configured) or it can't be signed
  or loaded.
