import { Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { getThemePreference, setThemePreference, type ThemePreference } from "@/lib/theme";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./overlay";
import { texts } from "@/i18n";

const options: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: texts.common.theme.light, icon: Sun },
  { value: "dark", label: texts.common.theme.dark, icon: Moon },
  { value: "system", label: texts.common.theme.system, icon: Monitor },
];

export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>(getThemePreference);
  const Current = preference === "dark" ? Moon : preference === "light" ? Sun : Monitor;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={texts.common.theme.label}>
          <Current strokeWidth={1.75} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {options.map(({ value, label, icon: Icon }) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => {
              setThemePreference(value);
              setPreference(value);
            }}
            aria-checked={preference === value}
            role="menuitemradio"
          >
            <Icon strokeWidth={1.75} />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
