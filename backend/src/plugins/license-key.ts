// Clave pública con la que se verifican las licencias de plugins (Ed25519, SPKI en PEM). Fija en el
// código a propósito: ninguna variable de entorno la reemplaza. Los tests pasan otra clave por
// parámetro a verifyLicense.
//
// ANTES DE PUBLICAR: esta es la clave de desarrollo. Generá el par de producción, guardá la privada
// fuera de cualquier repositorio y reemplazá esta pública (docs/spec/plugins.md, «Licencia»).
export const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAig8M290jvblNkIiU0Mg7dUJZMWhqwa8DbPOOMYpFm0I=
-----END PUBLIC KEY-----
`;
