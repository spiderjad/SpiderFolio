/*
 * Se carga antes que la app (index.html), como script clásico: tiene que correr también en
 * navegadores viejos, así que está escrito en ES5, sin módulos ni dependencias.
 *
 * 1. Tema sin parpadeo: aplica la clase .dark antes del primer pintado (misma preferencia
 *    que guarda la app en localStorage, clave "spiderfolio-theme").
 * 2. Navegadores compatibles (CLAUDE.md, sección 10.10): Tailwind 4 necesita color-mix y
 *    @property (Safari 16.4+, Chrome/Edge 111+, Firefox 128+). Si faltan, marca <html> con
 *    data-unsupported (la app no arranca) y muestra una página simple con estilos propios.
 */
(function () {
  var root = document.documentElement;

  function readPreference() {
    try {
      return window.localStorage.getItem("spiderfolio-theme");
    } catch (error) {
      // Sin almacenamiento (modo privado o bloqueado): tema del sistema.
      return null;
    }
  }
  var preference = readPreference();
  var prefersDark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (preference === "dark" || (preference !== "light" && prefersDark)) {
    root.classList.add("dark");
  }

  function isSupported() {
    var css = window.CSS;
    return Boolean(
      css &&
      typeof css.supports === "function" &&
      css.supports("color", "color-mix(in srgb, red 50%, blue)") &&
      typeof css.registerProperty === "function"
    );
  }

  if (isSupported()) return;

  root.setAttribute("data-unsupported", "");

  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "/compat.css";
  document.head.appendChild(link);

  function render() {
    document.body.innerHTML =
      '<main class="compat">' +
      '<p class="compat-brand">SpiderFolio</p>' +
      "<h1>Tu navegador necesita una actualización</h1>" +
      "<p>SpiderFolio usa funciones modernas que este navegador todavía no tiene. Para entrar, " +
      "actualizalo a una de estas versiones o más nuevas:</p>" +
      "<ul>" +
      "<li><strong>Chrome o Edge</strong> 111</li>" +
      "<li><strong>Safari</strong> 16.4 (en iPhone y iPad, iOS 16.4)</li>" +
      "<li><strong>Firefox</strong> 128</li>" +
      "</ul>" +
      "<p>Si es un equipo de la empresa y no podés actualizarlo, pedile ayuda a quien administra " +
      "los equipos o abrí SpiderFolio desde otro dispositivo.</p>" +
      '<p class="compat-links">' +
      '<a href="https://www.google.com/chrome/" rel="noopener">Descargar Chrome</a>' +
      '<a href="https://www.mozilla.org/firefox/" rel="noopener">Descargar Firefox</a>' +
      "</p>" +
      "</main>";
  }

  if (document.body) {
    render();
  } else {
    document.addEventListener("DOMContentLoaded", render);
  }
})();
