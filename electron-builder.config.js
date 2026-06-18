// electron-builder config. Unsigned by default; signed + notarized when SIGN=1
// and signing credentials are available. See SIGNING.md.
//
//   npm run dist          -> unsigned universal .dmg/.zip (Gatekeeper warning on first open)
//   SIGN=1 npm run dist    -> signed + notarized (needs Developer ID cert + notarize creds)

const sign = process.env.SIGN === '1';

const mac = {
  category: 'public.app-category.developer-tools',
  icon: 'build/icon.icns',
  target: [
    { target: 'dmg', arch: 'universal' },
    { target: 'zip', arch: 'universal' },
  ],
  darkModeSupport: true,
};

if (sign) {
  // Sign with the "Developer ID Application" cert auto-discovered from the
  // keychain (or set CSC_LINK/CSC_KEY_PASSWORD to a .p12), with hardened runtime.
  mac.hardenedRuntime = true;
  mac.gatekeeperAssess = false;
  mac.entitlements = 'build/entitlements.mac.plist';
  mac.entitlementsInherit = 'build/entitlements.mac.plist';

  // Notarize via notarytool. Prefer an App Store Connect API key if provided,
  // else fall back to Apple ID + app-specific password + team id.
  if (process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER) {
    mac.notarize = true; // electron-builder reads APPLE_API_KEY / _KEY_ID / _ISSUER
  } else if (process.env.APPLE_TEAM_ID) {
    mac.notarize = { teamId: process.env.APPLE_TEAM_ID }; // reads APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD
  }
} else {
  mac.identity = null; // explicitly unsigned
}

module.exports = {
  appId: 'com.jeremy.claudespark',
  productName: 'Claude Spark',
  copyright: '© 2026 Jeremy Person. Unofficial fan app — not affiliated with Anthropic, PBC. "Claude" is a trademark of Anthropic, PBC.',
  files: [
    'main.js',
    'preload.js',
    'index.html',
    'style.css',
    'renderer.js',
    'claudecode-color.svg',
    'assets/**',
    'node_modules/uiohook-napi/**',
  ],
  asarUnpack: ['node_modules/uiohook-napi/**'],
  extraResources: [
    { from: 'config.json', to: 'config.default.json' },
    { from: 'hooks.snippet.json', to: 'hooks.snippet.json' },
  ],
  directories: { output: 'release', buildResources: 'build' },
  mac,
  dmg: {
    title: 'Claude Spark',
    contents: [
      { x: 140, y: 200, type: 'file' },
      { x: 400, y: 200, type: 'link', path: '/Applications' },
    ],
  },
};
