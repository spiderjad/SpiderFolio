// Access token solo en memoria (CLAUDE.md, sección 7.1): nunca localStorage ni sessionStorage.
// Si la pestaña se recarga, se pide uno nuevo con la cookie del refresh.

let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}
