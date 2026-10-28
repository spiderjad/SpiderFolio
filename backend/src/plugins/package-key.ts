// Public key that verifies signed plugin packages (.sfplugin), Ed25519 SPKI in PEM. A different key
// from the license one (license-key.ts). Fixed in the code on purpose: no environment variable replaces
// it; tests pass another key to verifyPackage.
//
// BEFORE PUBLISHING A RELEASE WITH UPLOADS: this is the development key. Generate the production pair,
// keep the private key outside every repository and replace this public key (docs/spec/plugins.md).
export const PACKAGE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA/KelCGnwXBm98wnqO5XNJopUQdOQFNU4JesctBKUt7k=
-----END PUBLIC KEY-----
`;
