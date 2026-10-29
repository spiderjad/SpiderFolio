// Public key that verifies plugin licenses (Ed25519, SPKI in PEM): SpiderJAD's production key. Fixed in
// the code on purpose: no environment variable replaces it. Tests pass another key to verifyLicense.
// The private half never lives in a repository (docs/spec/plugins.md, «Licencia»).
export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAaGChkO5hgfnoQORvjIG1lTyWPozYCvz91RRHylqafUU=
-----END PUBLIC KEY-----
`;
