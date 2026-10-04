import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, Order } from "@/types";
import { CheckCircle, Banknote, Printer, Receipt, ChefHat, Trash2, MessageSquare, DoorOpen } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { breakdownLines, computeBill, includedTaxNote } from "../../../shared/bill";
import { PaperFormat } from "../../../shared/receipt";
import { useI18n } from "../../../shared/i18n";
import { useRestaurant } from "@/hooks/useRestaurant";
import { PaperFormatSelect, usePaperFormat } from "@/components/print/paper-format-select";

interface TableManagementModalProps {
  table: Table | null;
  order: Order | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirmOrder: (orderId: string) => void;
  onMarkReady: (orderId: string) => void;
  onProcessPayment: (orderId: string) => void;
  onDeleteOrder: (orderId: string) => void;
  /** Ouvre la fenêtre de message au client de la table (à tout moment) */
  onSendMessage: (table: Table) => void;
  /** Libere la table (client parti) : la visite se termine, les commandes non payees sont annulees */
  onReleaseTable: (table: Table, hasOrder: boolean) => Promise<void>;
  /** Imprime l'addition en cours de la table, sur le format de papier choisi */
  onPrintBill: (table: Table, order: Order, paper: PaperFormat) => void;
}

export const TableManagementModal = ({
  table,
  order,
  isOpen,
  onClose,
  onConfirmOrder,
  onMarkReady,
  onProcessPayment,
  onDeleteOrder,
  onSendMessage,
  onReleaseTable,
  onPrintBill,
}: TableManagementModalProps) => {
  const { t } = useI18n();
  const { settings, fmt } = useRestaurant();
  const [paper, setPaper] = usePaperFormat();
  const [isProcessing, setIsProcessing] = useState(false);
  // Confirmation d'annulation affichée dans la fenêtre (plus de boîte grise du navigateur)
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmRelease, setConfirmRelease] = useState(false);

  if (!table) return null;

  const bill = order ? computeBill(order.total, settings, table.taxRate) : null;
  const taxNote = bill ? includedTaxNote(bill, t, fmt) : null;

  const handleConfirmOrder = async () => {
    if (!order) return;
    setIsProcessing(true);

    try {
      await onConfirmOrder(order.id);
      toast.success(t("caisse.modal.confirmed", { table: table.number }));
    } catch (error) {
      toast.error(t("caisse.modal.confirmFailed"));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMarkReady = async () => {
    if (!order) return;
    setIsProcessing(true);

    try {
      await onMarkReady(order.id);
      toast.success(t("caisse.modal.served", { table: table.number }));
    } catch (error) {
      toast.error(t("caisse.modal.serveFailed"));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleProcessPayment = async () => {
    if (!order) return;
    setIsProcessing(true);

    try {
      await onProcessPayment(order.id);
      onClose();
    } catch (error) {
      toast.error(t("caisse.modal.payFailed"));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDeleteOrder = async () => {
    if (!order) return;
    setIsProcessing(true);

    try {
      await onDeleteOrder(order.id);
      toast.success(t("caisse.modal.cancelled", { table: table.number }));
      setConfirmCancel(false);
      onClose();
    } catch (error) {
      toast.error(t("caisse.modal.cancelFailed"));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRelease = async () => {
    setIsProcessing(true);
    try {
      await onReleaseTable(table, !!order);
      toast.success(t("caisse.modal.released", { table: table.number }));
      setConfirmRelease(false);
      onClose();
    } catch (error) {
      toast.error(t("caisse.modal.releaseFailed"));
    } finally {
      setIsProcessing(false);
    }
  };

  const occupied = table.status === 'occupied';
  const actionColumns = 1 + (order ? 1 : 0) + (occupied ? 1 : 0);

  const getStatusBadge = () => {
    if (!order) {
      return <Badge className="bg-success/20 text-success border-success/30">{t("caisse.modal.freeTable")}</Badge>;
    }

    switch (order.status) {
      case 'pending':
        return <Badge className="bg-warning/20 text-warning border-warning/30 animate-pulse">{t("caisse.table.newOrder")}</Badge>;
      case 'confirmed':
        return <Badge className="bg-accent/20 text-accent border-accent/30">{t("caisse.modal.badgeConfirmed")}</Badge>;
      case 'ready':
        return <Badge className="bg-primary/20 text-primary border-primary/30 animate-pulse">{t("caisse.modal.badgeReady")}</Badge>;
      case 'served':
        return <Badge className="bg-muted/20 text-muted-foreground border-muted/30">{t("caisse.modal.badgeServed")}</Badge>;
      default:
        return <Badge variant="secondary">{t(`status.${order.status}`)}</Badge>;
    }
  };

  const renderActionButtons = () => {
    if (!order) return null;

    switch (order.status) {
      case 'pending':
        return (
          <div className="space-y-3">
            <Button
              onClick={handleConfirmOrder}
              disabled={isProcessing}
              className="w-full"
              variant="success"
            >
              <CheckCircle className="h-4 w-4 me-2" />
              {isProcessing ? t("caisse.modal.confirming") : t("caisse.modal.confirmOrder")}
            </Button>
          </div>
        );

      case 'confirmed':
        return (
          <div className="space-y-3">
            <Button
              onClick={handleMarkReady}
              disabled={isProcessing}
              className="w-full"
              variant="gradient"
            >
              <ChefHat className="h-4 w-4 me-2" />
              {isProcessing ? t("caisse.modal.updating") : t("caisse.modal.markServed")}
            </Button>
          </div>
        );

      case 'ready':
      case 'served':
        return (
          <div className="space-y-3">
            <Button
              onClick={handleProcessPayment}
              disabled={isProcessing}
              className="w-full"
              variant="success"
            >
              <Banknote className="h-4 w-4 me-2" />
              {isProcessing ? t("caisse.modal.processing") : t("caisse.modal.confirmPayment")}
            </Button>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={() => { setConfirmCancel(false); onClose(); }}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader className="pe-8">
          <DialogTitle className="flex flex-wrap items-center gap-3">
            <div className="p-2 bg-primary/20 rounded-lg">
              <Receipt className="h-5 w-5 text-primary" />
            </div>
            <span>{t("caisse.table.label", { number: table.number })}</span>
            {getStatusBadge()}
            {table.taxRate != null && (
              <Badge variant="outline" className="font-normal">{t("caisse.table.vat", { rate: table.taxRate })}</Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Détails de la commande */}
          {order && bill && (
            <Card className="p-4">
              <h4 className="font-medium mb-3">{t("caisse.modal.details")}</h4>
              <div className="space-y-2">
                {order.items.map((item) => (
                  <div key={item.id} className="flex justify-between gap-2 text-sm">
                    <span>
                      {item.quantity} × {item.menuItem.name}
                      {item.notes && <span className="block text-xs text-muted-foreground">{item.notes}</span>}
                    </span>
                    <span className="whitespace-nowrap">{fmt(item.menuItem.price * item.quantity)}</span>
                  </div>
                ))}
                {order.note && (
                  <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
                    <span className="font-semibold">{t("caisse.modal.customerNote")} </span>{order.note}
                  </div>
                )}
                <Separator />
                {breakdownLines(bill, t).map((line) => (
                  <div key={line.label} className="flex justify-between text-sm text-muted-foreground">
                    <span>{line.label}</span>
                    <span>{fmt(line.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between font-medium">
                  <span>{t("caisse.modal.totalToCollect")}</span>
                  <span>{fmt(bill.total)}</span>
                </div>
                {taxNote && (
                  <p className="text-xs text-muted-foreground text-end">{taxNote}</p>
                )}
              </div>
            </Card>
          )}

          {/* Actions */}
          <div className="pt-2 space-y-3">
            {renderActionButtons()}

            {/* Addition provisoire : imprimable dès qu'il y a une commande en cours */}
            {order && (
              <div className="space-y-2">
                <Button variant="outline" className="w-full" onClick={() => onPrintBill(table, order, paper)}>
                  <Printer className="h-4 w-4 me-2" />
                  {t("caisse.modal.printBill")}
                </Button>
                <PaperFormatSelect value={paper} onChange={setPaper} className="w-full h-9 text-xs" />
              </div>
            )}

            {confirmRelease ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-3">
                <p className="text-sm font-medium text-destructive">
                  {t(order ? "caisse.modal.releaseConfirmUnpaid" : "caisse.modal.releaseConfirm", { table: table.number })}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => setConfirmRelease(false)} disabled={isProcessing}>
                    {t("caisse.modal.keep")}
                  </Button>
                  <Button variant="destructive" onClick={handleRelease} disabled={isProcessing}>
                    <DoorOpen className="h-4 w-4 me-1" />
                    {t("caisse.modal.releaseYes")}
                  </Button>
                </div>
              </div>
            ) : confirmCancel && order ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-3">
                <p className="text-sm font-medium text-destructive">
                  {t("caisse.modal.cancelConfirm", { table: table.number })}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => setConfirmCancel(false)} disabled={isProcessing}>
                    {t("caisse.modal.keep")}
                  </Button>
                  <Button variant="destructive" onClick={handleDeleteOrder} disabled={isProcessing}>
                    <Trash2 className="h-4 w-4 me-1" />
                    {t("caisse.modal.yesCancel")}
                  </Button>
                </div>
              </div>
            ) : (
              <div className={`grid gap-2 border-t pt-2 ${actionColumns === 3 ? "grid-cols-3" : actionColumns === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
                <Button
                  variant="ghost"
                  className="text-primary hover:text-primary hover:bg-primary/10"
                  onClick={() => onSendMessage(table)}
                >
                  <MessageSquare className="h-4 w-4 me-1" />
                  {t("caisse.modal.message")}
                </Button>
                {order && (
                  <Button
                    variant="ghost"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setConfirmCancel(true)}
                  >
                    <Trash2 className="h-4 w-4 me-1" />
                    {t("caisse.modal.cancelOrder")}
                  </Button>
                )}
                {occupied && (
                  <Button
                    variant="ghost"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setConfirmRelease(true)}
                  >
                    <DoorOpen className="h-4 w-4 me-1" />
                    {t("caisse.modal.release")}
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
