// Portada (/): lleva al idioma guardado (selector de idioma) o al primero de navigator.languages que
// tenga la web; si no hay ninguno, al idioma por defecto. Script externo: la CSP no admite scripts en
// línea. Los idiomas los declara la página en <meta name="spiderfolio-locales">.
(function () {
  var meta = document.querySelector('meta[name="spiderfolio-locales"]');
  if (!meta) return;
  var locales = (meta.getAttribute("content") || "").split(" ").filter(Boolean);
  var fallback = meta.getAttribute("data-default") || locales[0];
  if (!fallback) return;

  function match(tag) {
    var wanted = String(tag || "").toLowerCase();
    if (!wanted) return null;
    var i;
    for (i = 0; i < locales.length; i++) if (locales[i].toLowerCase() === wanted) return locales[i];
    var base = wanted.split("-")[0];
    for (i = 0; i < locales.length; i++)
      if (locales[i].toLowerCase().split("-")[0] === base) return locales[i];
    return null;
  }

  var chosen = null;
  try {
    chosen = match(window.localStorage.getItem("spiderfolio-locale"));
  } catch (e) {
    /* sin almacenamiento: se usa el idioma del navegador */
  }
  var preferred =
    navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  for (var i = 0; !chosen && i < preferred.length; i++) chosen = match(preferred[i]);
  window.location.replace(
    "/" + (chosen || fallback) + window.location.search + window.location.hash,
  );
})();
