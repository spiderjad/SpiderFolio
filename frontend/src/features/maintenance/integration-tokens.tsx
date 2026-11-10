// The SGA's integration tokens (docs/spec/mantenimiento.md, section 6), in the module's card: create one
// (its value shown once, to copy), see when each was last used, revoke. Only the owner (the server
// enforces it).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Badge, Banner } from "@/components/ui/display";
import { Checkbox, FormField, Input } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/overlay";
import { adminErrorText } from "@/features/admin/admin-utils";
import { formatDateTime } from "@/lib/utils";
import {
  maintenanceApi,
  maintenanceKeys,
  TOKEN_SCOPES,
  type IntegrationToken,
  type TokenScope,
} from "./maintenance-api";
import { texts } from "@/i18n";

const t = texts.maintenance.integration;

export function IntegrationTokens() {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<IntegrationToken | null>(null);
  const tokens = useQuery({
    queryKey: maintenanceKeys.tokens(workspaceSlug),
    queryFn: () => maintenanceApi.tokens(workspaceSlug),
    select: (data) => data.tokens,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => maintenanceApi.revokeToken(workspaceSlug, id),
    onSuccess: async () => {
      setRevoking(null);
      await queryClient.invalidateQueries({ queryKey: maintenanceKeys.tokens(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <div className="grid gap-3 border-t border-border pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium">
            <KeyRound className="size-4 text-primary" aria-hidden="true" />
            {t.title}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
          <p className="mt-1 break-words text-xs text-muted-foreground">{t.docs}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setCreating(true);
          }}
        >
          <Plus className="size-4" aria-hidden="true" />
          {t.new}
        </Button>
      </div>
      {(tokens.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {(tokens.data ?? []).map((token) => (
            <li key={token.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{token.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{token.prefix}…</span>
                  {token.revokedAt !== null && <Badge tone="danger">{t.revoked}</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[
                    token.scopes
                      .map(
                        (scope) => (t.scopes[scope as TokenScope] as string | undefined) ?? scope,
                      )
                      .join(" · "),
                    token.lastUsedAt === null
                      ? t.neverUsed
                      : t.lastUsed(formatDateTime(token.lastUsedAt)),
                  ].join(" · ")}
                </p>
              </div>
              {token.revokedAt === null && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-danger"
                  onClick={() => {
                    setRevoking(token);
                  }}
                >
                  {t.revoke}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {creating && (
        <CreateDialog
          onClose={() => {
            setCreating(false);
          }}
        />
      )}
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null);
        }}
        icon={KeyRound}
        tone="destructive"
        title={t.revokeTitle}
        description={`${revoking?.name ?? ""} · ${t.revokeText}`}
        confirmLabel={t.revoke}
        pendingLabel={texts.admin.common.saving}
        onConfirm={async () => {
          if (revoking !== null) await revoke.mutateAsync(revoking.id).catch(() => undefined);
        }}
      />
    </div>
  );
}

function CreateDialog({ onClose }: { onClose: () => void }) {
  const { workspaceSlug = "" } = useParams();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<TokenScope[]>([...TOKEN_SCOPES]);
  const [token, setToken] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => maintenanceApi.createToken(workspaceSlug, { name: name.trim(), scopes }),
    onSuccess: async (result) => {
      setToken(result.token);
      await queryClient.invalidateQueries({ queryKey: maintenanceKeys.tokens(workspaceSlug) });
    },
    onError: (error) => {
      toast.error(adminErrorText(error));
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={t.new}
        footer={
          token === null ? (
            <>
              <DialogClose asChild>
                <Button variant="outline" disabled={create.isPending}>
                  {texts.admin.common.cancel}
                </Button>
              </DialogClose>
              <Button
                disabled={name.trim() === "" || scopes.length === 0 || create.isPending}
                onClick={() => {
                  create.mutate();
                }}
              >
                {t.create}
              </Button>
            </>
          ) : (
            <Button onClick={onClose}>{t.done}</Button>
          )
        }
      >
        {token === null ? (
          <div className="grid gap-4">
            <FormField label={t.name}>
              {(control) => (
                <Input
                  {...control}
                  maxLength={120}
                  placeholder={t.namePlaceholder}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                />
              )}
            </FormField>
            <div className="grid gap-2">
              {TOKEN_SCOPES.map((scope) => (
                <Checkbox
                  key={scope}
                  label={t.scopes[scope]}
                  checked={scopes.includes(scope)}
                  onChange={(event) => {
                    setScopes((current) =>
                      event.target.checked
                        ? [...current, scope]
                        : current.filter((value) => value !== scope),
                    );
                  }}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="grid gap-3">
            <Banner tone="warning">{t.created}</Banner>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-muted px-3 py-2 font-mono text-xs">
                {token}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(token).then(() => {
                    toast.success(t.copied);
                  });
                }}
              >
                <Copy className="size-4" aria-hidden="true" />
                {t.copy}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
