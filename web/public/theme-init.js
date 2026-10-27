// Aplica el tema antes del primer pintado (script externo: la CSP no admite scripts en línea) y
// marca html.reveal-fallback si el navegador no soporta scroll-driven animations (ver
// src/scripts/reveal.ts). Con View Transitions, Astro reemplaza los atributos de <html> al cambiar
// de página: todo se vuelve a aplicar en astro:after-swap.
(function () {
  function apply(root) {
    try {
      var stored = window.localStorage.getItem("spiderfolio-theme");
      var dark =
        stored === "dark" ||
        (stored !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      if (dark) root.classList.add("dark");
    } catch (e) {
      /* sin almacenamiento: se usa el tema del sistema */
    }
    var scrollDriven = window.CSS && CSS.supports && CSS.supports("animation-timeline: view()");
    if (!scrollDriven) root.classList.add("reveal-fallback");
  }
  apply(document.documentElement);
  document.addEventListener("astro:after-swap", function () {
    apply(document.documentElement);
  });
})();
