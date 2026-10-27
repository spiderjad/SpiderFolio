// Identidad visual de Bian (SVG propio e inline: sin imágenes externas, por la CSP).
// - BianLogo: la palabra «Bian» en violeta de la marca, con una coleta rubia atada con una gomita
//   violeta que cuelga del extremo superior derecho de la «n».
// - BianAvatar: círculo violeta con una «B» blanca y la misma coleta saliendo del borde superior
//   derecho.
// Los violetas salen de los tokens (claro y oscuro); el dorado de la coleta es fijo y se lee bien
// sobre ambos fondos. La coleta se balancea mientras Bian trabaja (`busy`) y da un vaivén al pasar el
// mouse por un elemento con la clase `bian-wiggle`; todo se apaga con prefers-reduced-motion
// (los estilos están en globals.css).
import { useId, type CSSProperties } from "react";
import { cn } from "@/lib/utils";

const HAIR = "#E3B23C";
const HAIR_LIGHT = "#F7DC85";
const HAIR_DARK = "#A8761A";

/** La coleta, dibujada alrededor de su gomita (ox, oy): ahí nace y de ahí se balancea. */
function Ponytail({ ox, oy, scale = 1 }: { ox: number; oy: number; scale?: number }) {
  const style: CSSProperties = { transformOrigin: `${String(ox)}px ${String(oy)}px` };
  return (
    <g className="bian-tail" style={style}>
      <g transform={`translate(${String(ox)} ${String(oy)}) scale(${String(scale)})`}>
        {/* Cuerpo del pelo: sale de la gomita, se abre hacia afuera y cae con una curva suave. */}
        <path
          d="M0 1 C7 -2 14 4 13 12 C12.2 19 8.6 23.4 4.4 26.4 C6.4 21 5.4 16.4 3.2 12 C2 8.6 1 4.6 0 1 Z"
          fill={HAIR}
        />
        {/* Mechones más claros */}
        <path
          d="M2.2 2.6 C7.6 2.4 10.8 6.8 10.4 12.4"
          fill="none"
          stroke={HAIR_LIGHT}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M5.6 15.6 C6.4 18.4 6 21.4 4.8 23.8"
          fill="none"
          stroke={HAIR_LIGHT}
          strokeWidth="1.1"
          strokeLinecap="round"
        />
        {/* Mechones más oscuros */}
        <path
          d="M3.4 5.6 C4.8 9 5.6 12.8 4.6 18"
          fill="none"
          stroke={HAIR_DARK}
          strokeWidth="1.3"
          strokeLinecap="round"
        />
        <path
          d="M9 8.2 C9.8 12.2 8.8 16.4 6.8 20.4"
          fill="none"
          stroke={HAIR_DARK}
          strokeWidth="1.1"
          strokeLinecap="round"
        />
        {/* La gomita violeta, con un borde del color del fondo para despegarla del trazo de la «n» */}
        <rect
          x="-3.6"
          y="-2.4"
          width="7.2"
          height="4.8"
          rx="2.2"
          transform="rotate(-24)"
          className="fill-primary stroke-background"
          strokeWidth="0.9"
        />
      </g>
    </g>
  );
}

/** Logotipo «Bian»: letras dibujadas con trazo redondeado (no dependen de ninguna fuente). */
export function BianLogo({
  className,
  busy = false,
  title = "Bian",
}: {
  className?: string;
  busy?: boolean;
  title?: string;
}) {
  const titleId = useId();
  return (
    <svg
      role="img"
      aria-labelledby={titleId}
      viewBox="0 0 122 54"
      className={cn("h-8 w-auto overflow-visible", className)}
      data-bian-busy={busy ? "true" : undefined}
    >
      <title id={titleId}>{title}</title>
      <g
        fill="none"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-primary"
      >
        {/* B */}
        <path d="M8 6 H17 C23 6 25 10 25 13.5 C25 17 23 21 17 21 H8 M8 21 H19 C25.5 21 28 25 28 29.5 C28 34 25.5 38 19 38 H8 M8 6 V38" />
        {/* i */}
        <path d="M41 18 V38" />
        {/* a */}
        <circle cx="58" cy="28" r="9.5" />
        <path d="M67.5 18.5 V38" />
        {/* n */}
        <path d="M79 18 V38 M79 28 C79 21 83.5 18 89 18 C94.5 18 97.5 22 97.5 28 V38" />
      </g>
      <circle cx="41" cy="9" r="3.2" className="fill-primary" />
      <Ponytail ox={97} oy={21} />
    </svg>
  );
}

/** Avatar de Bian para el chat y los botones: círculo violeta con una «B» y la coleta en el borde. */
export function BianAvatar({ className, busy = false }: { className?: string; busy?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 56 48"
      className={cn("h-7 w-auto overflow-visible", className)}
      data-bian-busy={busy ? "true" : undefined}
    >
      <circle cx="22" cy="26" r="20" className="fill-primary" />
      <path
        d="M8 6 H17 C23 6 25 10 25 13.5 C25 17 23 21 17 21 H8 M8 21 H19 C25.5 21 28 25 28 29.5 C28 34 25.5 38 19 38 H8 M8 6 V38"
        transform="translate(11.4 13.2) scale(0.6)"
        fill="none"
        strokeWidth="5.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-primary-foreground"
      />
      <Ponytail ox={36.4} oy={12} scale={1.1} />
    </svg>
  );
}
