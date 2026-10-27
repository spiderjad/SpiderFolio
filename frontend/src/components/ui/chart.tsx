// Tooltip de gráficos (10.5) con los tokens del sistema. No importa Recharts: recibe las props
// que Recharts le pasa a `content`, así este archivo no arrastra la librería al bundle principal.
export interface ChartTooltipProps {
  active?: boolean | undefined;
  label?: string | number | undefined;
  payload?:
    readonly { dataKey?: unknown; value?: unknown; color?: string | undefined }[] | undefined;
  /** Nombre visible de cada serie, por dataKey. */
  names: Record<string, string>;
  formatLabel?: (label: string) => string;
}

export function ChartTooltip({ active, label, payload, names, formatLabel }: ChartTooltipProps) {
  if (active !== true || payload === undefined || payload.length === 0) return null;
  const title = label === undefined ? "" : String(label);
  return (
    <div className="min-w-36 rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-pop">
      {title !== "" && (
        <p className="mb-1.5 font-medium">
          {formatLabel === undefined ? title : formatLabel(title)}
        </p>
      )}
      <ul className="grid gap-1">
        {payload.map((item) => {
          const key = typeof item.dataKey === "string" ? item.dataKey : String(item.dataKey);
          return (
            <li key={key} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2.5 rounded-sm bg-muted"
                // React aplica style por CSSOM: la CSP no lo bloquea.
                style={item.color === undefined ? undefined : { backgroundColor: item.color }}
              />
              <span className="flex-1 text-muted-foreground">{names[key] ?? key}</span>
              <span className="font-medium tabular-nums">
                {typeof item.value === "number" || typeof item.value === "string" ? item.value : 0}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
