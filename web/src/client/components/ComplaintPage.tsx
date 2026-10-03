import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, Send, Clock, User } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ORDER_SERVER_URL } from "@/lib/orderServer";
import { useI18n } from "@/lib/i18n";
import PageHeader from "./PageHeader";

interface ComplaintPageProps {
  onBack: () => void;
  tableNumber: number | string | null;
  /** Session de table (QR code scanné) : la réclamation est rattachée à la table */
  sessionToken?: string | null;
  /** Fuseau du restaurant pour la date affichée */
  timeZone?: string | null;
}

const ComplaintPage = ({ onBack, tableNumber, sessionToken, timeZone }: ComplaintPageProps) => {
  const [complaint, setComplaint] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { toast } = useToast();
  const { t, formatDateTime } = useI18n();

  const currentDateTime = formatDateTime(new Date(), timeZone);

  const handleSubmit = async () => {
    if (!complaint.trim()) {
      toast({
        title: t("common.error"),
        description: t("client.complaint.emptyError"),
        variant: "destructive"
      });
      return;
    }

    if (!sessionToken) {
      toast({
        title: t("client.toast.scanTitle"),
        description: t("client.complaint.scanToast"),
        variant: "destructive"
      });
      return;
    }

    setIsSubmitting(true);
    try {
      // Envoyée au restaurant : l'admin la voit avec le numéro de table, la date et le caissier en service
      const response = await fetch(`${ORDER_SERVER_URL}/api/complaints`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionToken, text: complaint.trim() }),
      });
      if (response.status === 403) {
        // Visite terminée depuis plus de 3 h : le serveur n'accepte plus de réclamation
        toast({
          title: t("client.complaint.expiredTitle"),
          description: t("client.complaint.expiredText"),
          variant: "destructive"
        });
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      toast({
        title: t("client.complaint.sentTitle"),
        description: t("client.complaint.sentText"),
      });
      setComplaint("");
      onBack();
    } catch {
      toast({
        title: t("client.complaint.failedTitle"),
        description: t("client.complaint.failedText"),
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-restaurant-cream to-background">
      <PageHeader title={t("client.complaint.title")} subtitle={t("client.complaint.subtitle")} onBack={onBack} />

      <div className="container mx-auto px-4 py-6">
        <Card className="bg-card/95 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              {t("client.complaint.formTitle")}
            </CardTitle>
          </CardHeader>

          <CardContent className="space-y-6">
            {/* Order Info */}
            <div className="grid grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{t("client.complaint.table")}</p>
                  <p className="text-lg font-bold text-primary">{tableNumber ?? "—"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{t("client.complaint.dateTime")}</p>
                  <p className="text-sm text-muted-foreground">{currentDateTime}</p>
                </div>
              </div>
            </div>

            {/* Complaint Text */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {t("client.complaint.details")} <span className="text-destructive">*</span>
              </label>
              <Textarea
                placeholder={t("client.complaint.placeholder")}
                value={complaint}
                onChange={(e) => setComplaint(e.target.value.slice(0, 500))}
                className="min-h-[120px]"
                disabled={!sessionToken}
              />
              <p className="text-xs text-muted-foreground text-end">
                {complaint.length}/500
              </p>
            </div>

            {/* Pas de table connue : le client doit scanner le QR code de sa table */}
            {!sessionToken && (
              <div className="bg-amber-50 border border-amber-200 p-4 rounded-lg">
                <p className="text-sm text-amber-800">
                  <strong>{t("client.complaint.scanTitle")}</strong> {t("client.complaint.scanText")}
                </p>
              </div>
            )}

            {/* Info Message */}
            <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>{t("client.complaint.infoTitle")}</strong> {t("client.complaint.infoText")}
              </p>
            </div>

            {/* Submit Button */}
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !sessionToken || complaint.trim().length === 0}
              className="w-full bg-gradient-to-r from-primary to-restaurant-warm hover:from-primary/90 hover:to-restaurant-warm/90 text-white font-medium h-12"
            >
              {isSubmitting ? (
                t("client.complaint.sending")
              ) : (
                <>
                  <Send className="h-5 w-5 me-2 rtl:-scale-x-100" />
                  {t("client.complaint.send")}
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ComplaintPage;
