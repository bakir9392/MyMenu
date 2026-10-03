import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, Order } from "@/types";
import { Clock, CheckCircle, AlertCircle, ChefHat, Plus } from "lucide-react";
import { useState } from "react";
import { computeBill } from "../../../shared/bill";
import { useI18n } from "../../../shared/i18n";
import { useRestaurant } from "@/hooks/useRestaurant";

interface TableGridProps {
  tables: Table[];
  orders: Order[];
  onTableSelect: (table: Table) => void;
}

export const TableGrid = ({ tables, orders, onTableSelect }: TableGridProps) => {
  const { t } = useI18n();
  const { settings, fmt, time } = useRestaurant();
  const [activeSection, setActiveSection] = useState<string>('all');

  // Toutes les commandes en cours de la table réunies : total cumulé, heure de la première, étape la moins avancée
  const getTableOrder = (tableId: number): Order | undefined => {
    const tableOrders = orders
      .filter(order => order.tableId === tableId && order.status !== 'paid' && order.status !== 'cancelled')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (tableOrders.length === 0) return undefined;
    const stage: Order['status'][] = ['pending', 'confirmed', 'preparing', 'ready', 'served'];
    return {
      ...tableOrders[0],
      status: stage.find(st => tableOrders.some(o => o.status === st)) ?? tableOrders[0].status,
      total: tableOrders.reduce((sum, o) => sum + o.total, 0),
      note: tableOrders.map(o => o.note).filter(Boolean).join(' • ') || undefined,
    };
  };

  // Group tables by status
  const groupedTables = {
    all: tables,
    free: tables.filter(table => !getTableOrder(table.id) && table.status !== 'occupied'),
    pending: tables.filter(table => {
      const order = getTableOrder(table.id);
      return order && order.status === 'pending';
    }),
    preparing: tables.filter(table => {
      const order = getTableOrder(table.id);
      return order && (order.status === 'confirmed' || order.status === 'preparing');
    }),
    payment: tables.filter(table => {
      const order = getTableOrder(table.id);
      return order && order.status === 'served';
    })
  };

  const getTableStatusFromOrder = (order: Order | undefined) => {
    if (!order) return 'free';
    if (order.status === 'pending') return 'pending';
    if (order.status === 'confirmed' || order.status === 'preparing') return 'occupied';
    if (order.status === 'served') return 'payment';
    return 'occupied';
  };

  const getTableStatusColor = (order: Order | undefined) => {
    const status = getTableStatusFromOrder(order);
    switch (status) {
      case 'free':
        return 'bg-success/20 text-success border-success/30';
      case 'pending':
        return 'bg-warning/20 text-warning border-warning/30 animate-pulse';
      case 'occupied':
        return 'bg-accent/20 text-accent border-accent/30';
      case 'payment':
        return 'bg-destructive/20 text-destructive border-destructive/30';
      default:
        return 'bg-muted/20 text-muted-foreground border-muted/30';
    }
  };

  const getTableStatusText = (order: Order | undefined) => {
    const status = getTableStatusFromOrder(order);
    switch (status) {
      case 'free':
        return t("caisse.table.free");
      case 'pending':
        return t("caisse.table.newOrder");
      case 'occupied':
        return t("caisse.table.preparing");
      case 'payment':
        return t("caisse.table.toPay");
      default:
        return t("caisse.table.occupied");
    }
  };

  const getTableIcon = (order: Order | undefined) => {
    const status = getTableStatusFromOrder(order);
    switch (status) {
      case 'pending':
        return <AlertCircle className="h-4 w-4" />;
      case 'payment':
        return <CheckCircle className="h-4 w-4" />;
      default:
        return null;
    }
  };

  const renderTableCard = (table: Table) => {
    const tableOrder = getTableOrder(table.id);
    const seated = !tableOrder && table.status === 'occupied'; // QR scanné, pas encore de commande

    return (
      <Card
        key={table.id}
        className={`p-4 cursor-pointer transition-all duration-200 hover:shadow-lg relative ${
          getTableStatusFromOrder(tableOrder) === 'free' ? 'hover:border-success' :
          'hover:border-primary'
        }`}
        onClick={() => onTableSelect(table)}
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-bold text-lg">{t("caisse.table.label", { number: table.number })}</h3>
            <div className="flex items-center gap-1">
              {getTableIcon(tableOrder)}
              <Badge className={seated ? 'bg-primary/15 text-primary border-primary/30' : getTableStatusColor(tableOrder)}>
                {seated ? t("caisse.table.seated") : getTableStatusText(tableOrder)}
              </Badge>
            </div>
          </div>

          {table.taxRate != null && (
            <Badge variant="outline" className="text-xs font-normal">{t("caisse.table.vat", { rate: table.taxRate })}</Badge>
          )}

          {tableOrder?.createdAt && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{time(tableOrder.createdAt)}</span>
            </div>
          )}

          {tableOrder && (
            <div className="text-sm font-medium text-primary">
              {t("caisse.table.total", { amount: fmt(computeBill(tableOrder.total, settings, table.taxRate).total) })}
            </div>
          )}

          {tableOrder?.note && (
            <div className="text-xs rounded bg-warning/10 border border-warning/30 px-2 py-1 line-clamp-2" title={tableOrder.note}>
              📝 {tableOrder.note}
            </div>
          )}
        </div>
      </Card>
    );
  };

  const sections = [
    {
      id: 'all',
      title: t("caisse.table.sectionAll"),
      icon: <Plus className="h-4 w-4" />,
      color: 'bg-muted/20 text-muted-foreground',
      count: groupedTables.all.length,
      hasNotification: false
    },
    {
      id: 'pending',
      title: t("caisse.table.sectionNew"),
      icon: <AlertCircle className="h-4 w-4 text-warning" />,
      color: 'bg-warning/20 text-warning',
      count: groupedTables.pending.length,
      hasNotification: groupedTables.pending.length > 0
    },
    {
      id: 'preparing',
      title: t("caisse.table.preparing"),
      icon: <ChefHat className="h-4 w-4 text-accent" />,
      color: 'bg-accent/20 text-accent',
      count: groupedTables.preparing.length,
      hasNotification: false
    },
    {
      id: 'payment',
      title: t("caisse.table.sectionPayment"),
      icon: <CheckCircle className="h-4 w-4 text-destructive" />,
      color: 'bg-destructive/20 text-destructive',
      count: groupedTables.payment.length,
      hasNotification: groupedTables.payment.length > 0
    },
    {
      id: 'free',
      title: t("caisse.table.sectionFree"),
      icon: <Plus className="h-4 w-4 text-success" />,
      color: 'bg-success/20 text-success',
      count: groupedTables.free.length,
      hasNotification: false
    }
  ];

  if (!tables || tables.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>{t("caisse.table.none")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Section Tabs */}
      <div className="flex flex-wrap gap-2 border-b pb-4">
        {sections.map((section) => (
          <Button
            key={section.id}
            variant={activeSection === section.id ? "default" : "outline"}
            size="sm"
            onClick={() => setActiveSection(section.id)}
            className="flex items-center gap-2 relative"
          >
            <div className={`p-1 rounded ${section.color}`}>
              {section.icon}
            </div>
            <span>{section.title}</span>
            <Badge variant="secondary" className="ms-1">
              {section.count}
            </Badge>
            {section.hasNotification && (
              <div className="absolute -top-1 -end-1 w-3 h-3 bg-primary rounded-full animate-ping" />
            )}
          </Button>
        ))}
      </div>

      {/* Tables Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8 gap-3">
        {groupedTables[activeSection as keyof typeof groupedTables]?.map(renderTableCard)}
      </div>
    </div>
  );
};
