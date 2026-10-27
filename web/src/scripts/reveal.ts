// Alternativa a las scroll-driven animations: donde el navegador no soporta animation-timeline,
// theme-init.js marca <html class="reveal-fallback"> (antes del primer pintado, para que no haya
// parpadeo) y acá se agrega .is-in a cada elemento cuando entra en pantalla. La transición está en
// src/styles/global.css. Sin JavaScript no hay clase y el contenido se ve de entrada.

// Misma lista que en global.css: cambiarlas juntas.
const REVEAL_SELECTOR =
  "main :is(h1, h2, h3, h4, p, li, article, figure, details, table, pre, img, .reveal):not(.hero-stagger *, .hero-shot *, .reveal *, article *, figure *, details *, table *)";

function initReveal(): void {
  if (!document.documentElement.classList.contains("reveal-fallback")) return;
  const targets = Array.from(document.querySelectorAll<HTMLElement>(REVEAL_SELECTOR));
  if (!("IntersectionObserver" in window)) {
    targets.forEach((el) => {
      el.classList.add("is-in");
    });
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.1, rootMargin: "0px 0px -6% 0px" },
  );
  targets.forEach((el) => {
    observer.observe(el);
  });
}

// astro:page-load se dispara en la carga inicial y tras cada navegación con ClientRouter.
document.addEventListener("astro:page-load", initReveal);
