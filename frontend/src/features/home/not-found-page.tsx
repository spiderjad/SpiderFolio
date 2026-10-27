import { SearchX } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { EmptyState, Logo } from "@/components/ui/display";
import { texts } from "@/i18n";

export function NotFoundPage({
  title = texts.shell.notFound.title,
  text,
}: {
  title?: string;
  text?: string;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface px-4 py-6">
      <Logo />
      <main className="flex flex-1 items-center justify-center">
        <EmptyState
          icon={SearchX}
          title={title}
          action={
            <Button asChild>
              <Link to="/app">{texts.shell.notFound.action}</Link>
            </Button>
          }
        >
          {text ?? ""}
        </EmptyState>
      </main>
    </div>
  );
}
