import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Send } from "lucide-react";
import { useI18n } from "../../../shared/i18n";

// Messages rapides : le texte choisi est envoyé tel quel au client, dans la langue de la caisse
const TEMPLATE_KEYS = [
  "caisse.msg.template1",
  "caisse.msg.template2",
  "caisse.msg.template3",
  "caisse.msg.template4",
  "caisse.msg.template5",
];

interface SendMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableNumber: string | null;
  /** Envoie le message ; reason "no_session" = aucun client connecté à cette table */
  onSend: (text: string) => Promise<{ ok: boolean; reason?: string }>;
  notify: (title: string, isError?: boolean) => void;
}

/** Message libre ou prédéfini envoyé au téléphone du client d'une table (affiché avec un son) */
export function SendMessageDialog({ open, onOpenChange, tableNumber, onSend, notify }: SendMessageDialogProps) {
  const { t } = useI18n();
  const TEMPLATES = TEMPLATE_KEYS.map((key) => t(key));
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    if (open) setText("");
  }, [open]);

  const send = async () => {
    const message = text.trim();
    if (!message || !tableNumber) return;
    setIsSending(true);
    try {
      const reply = await onSend(message);
      if (reply.ok) {
        notify(t("caisse.msg.sent", { table: tableNumber }));
        onOpenChange(false);
      } else if (reply.reason === "no_session") {
        notify(t("caisse.msg.noSession", { table: tableNumber }), true);
      } else {
        notify(t("caisse.msg.failed"), true);
      }
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-primary" />
            {t("caisse.msg.title", { table: tableNumber ?? "" })}
          </DialogTitle>
          <DialogDescription>
            {t("caisse.msg.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground">{t("caisse.msg.quick")}</p>
          <div className="grid gap-1.5">
            {TEMPLATES.map((template) => (
              <button
                key={template}
                type="button"
                onClick={() => setText(template)}
                className={`rounded-lg border px-3 py-2 text-sm text-start transition-colors ${
                  text === template ? "border-primary bg-primary/10 text-primary font-medium" : "border-border hover:border-primary/50 hover:bg-primary/5"
                }`}
              >
                {template}
              </button>
            ))}
          </div>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 300))}
            placeholder={t("caisse.msg.placeholder")}
            rows={3}
            autoFocus
          />
          <p className="text-xs text-muted-foreground text-end -mt-1">{text.length}/300</p>
          <div className="grid grid-cols-3 gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.cancel")}
            </Button>
            <Button className="col-span-2" onClick={send} disabled={!text.trim() || isSending}>
              <Send className="h-4 w-4 me-2 rtl:-scale-x-100" />
              {isSending ? t("caisse.msg.sending") : t("caisse.msg.send")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
