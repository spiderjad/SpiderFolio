// Diagramas y botones de la portada: agrega .is-in a cada [data-animate] cuando entra en pantalla (la
// animación está en el CSS de cada componente, dentro de prefers-reduced-motion: no-preference) y
// copia el comando de instalación con [data-copy]. Sin JavaScript, los diagramas se ven en su estado final.

function initAnimations(): void {
  const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-animate]"));
  if (!("IntersectionObserver" in window)) return;
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-in");
        observer.unobserve(entry.target);
      }
    },
    { threshold: 0.35 },
  );
  for (const target of targets) observer.observe(target);
}

function initCopy(): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-copy]")) {
    button.addEventListener("click", () => {
      const text = button.dataset.copy ?? "";
      const label = button.querySelector<HTMLElement>("[data-copy-label]");
      void navigator.clipboard.writeText(text).then(() => {
        if (label === null) return;
        const original = label.textContent;
        label.textContent = button.dataset.copied ?? original;
        button.classList.add("is-copied");
        window.setTimeout(() => {
          label.textContent = original;
          button.classList.remove("is-copied");
        }, 1800);
      });
    });
  }
}

document.addEventListener("astro:page-load", () => {
  initAnimations();
  initCopy();
});
