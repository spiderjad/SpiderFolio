// Notice of an announced server restart (frontend/src/lib/restart.ts), for everyone signed in: a
// countdown so they save what they're editing; it goes away once the server answers again.
import { RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Banner } from "@/components/ui/display";
import { useRestartAt } from "@/lib/restart";
import { texts } from "@/i18n";

export function RestartBanner() {
  const restartAt = useRestartAt();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (restartAt === null) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [restartAt]);
  if (restartAt === null) return null;
  const seconds = Math.max(0, Math.ceil((new Date(restartAt).getTime() - now) / 1000));
  return (
    <div className="mb-4">
      <Banner tone="warning" icon={RotateCw}>
        {texts.license.license.restartBanner(seconds)}
      </Banner>
    </div>
  );
}
