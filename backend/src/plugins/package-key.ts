// Public key that verifies signed plugin packages (.sfplugin), Ed25519 SPKI in PEM: SpiderJAD's
// production key, a different one from the license key (license-key.ts). Fixed in the code on purpose:
// no environment variable replaces it; tests pass another key to verifyPackage. The private half never
// lives in a repository (docs/spec/plugins.md).
export const PACKAGE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA2ye8iiQo5qVxpv7U0m2APJK3D/yqSrIbYf68dzxdJKg=
-----END PUBLIC KEY-----
`;
