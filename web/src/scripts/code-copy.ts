// "Copy" button on every code block (<pre>) of the website and the guides. It copies only the code:
// the button sits outside the <pre> and the Windows/Linux tab labels are outside it too. Labels come
// from <body data-copy-label data-copied-label> (i18n catalog); styles live in global.css, so it works
// with the CSP (no inline styles or scripts). Blocks marked data-no-copy are left alone.

const ICONS = {
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
} as const;
const COPIED_MS = 1800;

function icon(name: keyof typeof ICONS): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({
    viewBox: "0 0 24 24",
    width: "14",
    height: "14",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  })) {
    svg.setAttribute(key, value);
  }
  svg.innerHTML = ICONS[name];
  return svg;
}

function addButton(pre: HTMLPreElement, copyLabel: string, copiedLabel: string): void {
  const wrapper = document.createElement("div");
  wrapper.className = "code-block";
  pre.before(wrapper);
  wrapper.append(pre);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "code-copy";
  const label = document.createElement("span");
  label.textContent = copyLabel;
  // Screen readers announce the change to "Copied".
  label.setAttribute("aria-live", "polite");
  button.append(icon("copy"), label);
  wrapper.append(button);

  let timer: number | undefined;
  button.addEventListener("click", () => {
    const text = (pre.querySelector("code") ?? pre).textContent;
    void navigator.clipboard.writeText(text.replace(/\n+$/, "")).then(() => {
      window.clearTimeout(timer);
      label.textContent = copiedLabel;
      button.firstElementChild?.replaceWith(icon("check"));
      button.classList.add("is-copied");
      timer = window.setTimeout(() => {
        label.textContent = copyLabel;
        button.firstElementChild?.replaceWith(icon("copy"));
        button.classList.remove("is-copied");
      }, COPIED_MS);
    });
  });
}

function initCodeCopy(): void {
  const { copyLabel = "Copy", copiedLabel = "Copied ✓" } = document.body.dataset;
  for (const pre of document.querySelectorAll<HTMLPreElement>("main pre:not([data-no-copy])")) {
    if (pre.parentElement?.classList.contains("code-block")) continue;
    addButton(pre, copyLabel, copiedLabel);
  }
}

document.addEventListener("astro:page-load", initCodeCopy);
