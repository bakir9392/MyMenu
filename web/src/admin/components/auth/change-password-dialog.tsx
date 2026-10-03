import { FormEvent, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordRequest } from "@/lib/auth-api";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "../../../shared/i18n";

interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Changement du mot de passe de l'administrateur (POST /api/auth/change-password) */
export function ChangePasswordDialog({ open, onOpenChange }: ChangePasswordDialogProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCurrent("");
      setNext("");
      setConfirm("");
      setError(null);
    }
  }, [open]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (next.length < 8) return setError(t("auth.err.password"));
    if (next !== confirm) return setError(t("auth.passwordsMismatch"));
    setIsSaving(true);
    const reply = await changePasswordRequest(current, next);
    setIsSaving(false);
    if (reply.ok) {
      toast({ title: t("auth.passwordChanged") });
      onOpenChange(false);
    } else if (reply.status === 401) {
      setError(t("auth.wrongCurrentPassword"));
    } else if (reply.status === 0) {
      setError(t("auth.networkError"));
    } else if (reply.status === 422) {
      setError(t("auth.err.password"));
    } else {
      setError(t("auth.genericError"));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader className="text-start">
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            {t("auth.changePassword")}
          </DialogTitle>
          <DialogDescription>{t("auth.changePasswordHint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="currentPassword">{t("auth.currentPassword")}</Label>
            <Input id="currentPassword" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">{t("auth.newPassword")}</Label>
            <Input id="newPassword" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" placeholder={t("auth.passwordMin")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">{t("auth.confirmPassword")}</Label>
            <Input id="confirmPassword" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSaving || !current || !next || !confirm}>
              {isSaving ? t("common.loading") : t("common.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
