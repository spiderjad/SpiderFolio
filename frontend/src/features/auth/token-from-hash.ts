// Los enlaces de verificación y restablecimiento traen el token en el fragmento
// (#token=…, sección 7.3). Se lee una vez y se borra de la URL con replaceState, así no queda
// en el historial ni se comparte al copiar la dirección.

export function takeTokenFromHash(): string | null {
  const hash = window.location.hash.replace(/^#/, "");
  const token = new URLSearchParams(hash).get("token");
  if (hash !== "") {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  }
  return token !== null && /^[A-Za-z0-9_-]{20,200}$/.test(token) ? token : null;
}
