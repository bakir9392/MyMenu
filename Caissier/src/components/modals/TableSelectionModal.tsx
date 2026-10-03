import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table } from "@/types";
import { Plus, Users, UtensilsCrossed, ShoppingBag } from "lucide-react";

interface TableSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  tables: Table[];
  orders: any[];
  onTableSelect: (table: Table) => void;
  onTakeawaySelect: () => void;
}

export const TableSelectionModal = ({ 
  isOpen, 
  onClose, 
  tables, 
  orders,
  onTableSelect,
  onTakeawaySelect
}: TableSelectionModalProps) => {
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [orderType, setOrderType] = useState<'dine-in' | 'takeaway' | null>(null);

  // Get free tables (tables without active orders)
  const getFreeTables = () => {
    return tables.filter(table => {
      const hasActiveOrder = orders.some(order => 
        order.tableId === table.id && order.status !== 'paid'
      );
      return !hasActiveOrder;
    });
  };

  const freeTables = getFreeTables();

  const handleTableSelect = (table: Table) => {
    setSelectedTable(table);
    setOrderType('dine-in');
  };

  const handleTakeawaySelect = () => {
    setSelectedTable(null);
    setOrderType('takeaway');
  };

  const handleConfirm = () => {
    if (orderType === 'dine-in' && selectedTable) {
      onTableSelect(selectedTable);
    } else if (orderType === 'takeaway') {
      onTakeawaySelect();
    }
    onClose();
    setSelectedTable(null);
    setOrderType(null);
  };

  const handleCancel = () => {
    setSelectedTable(null);
    setOrderType(null);
    onClose();
  };

  const canConfirm = () => {
    if (orderType === 'dine-in') return selectedTable !== null;
    if (orderType === 'takeaway') return true;
    return false;
  };

  const getConfirmButtonText = () => {
    if (orderType === 'dine-in' && selectedTable) {
      return `Continuer avec Table ${selectedTable.number}`;
    }
    if (orderType === 'takeaway') {
      return 'Continuer avec Takeaway';
    }
    return 'Sélectionner une option';
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 bg-primary/20 rounded-lg">
              <Plus className="h-5 w-5 text-primary" />
            </div>
            Nouvelle commande - Choisir le type
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Order Type Selection */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-center">Type de commande</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Dine-in Option */}
              <Card
                className={`p-6 cursor-pointer transition-all duration-200 hover:shadow-lg border-2 ${
                  orderType === 'dine-in' 
                    ? 'border-primary ring-2 ring-primary/20 bg-primary/5' 
                    : 'border-border hover:border-primary/50'
                }`}
                onClick={() => setOrderType('dine-in')}
              >
                <div className="space-y-4 text-center">
                  <div className="flex items-center justify-center">
                    <div className="p-4 bg-primary/20 rounded-full">
                      <UtensilsCrossed className="h-8 w-8 text-primary" />
                    </div>
                  </div>
                  
                  <div>
                    <h3 className="font-bold text-xl">Manger sur place</h3>
                    <p className="text-sm text-muted-foreground">
                      Le client souhaite manger au restaurant
                    </p>
                  </div>

                  {orderType === 'dine-in' && (
                    <Badge className="bg-primary text-primary-foreground">
                      Sélectionné
                    </Badge>
                  )}
                </div>
              </Card>

              {/* Takeaway Option */}
              <Card
                className={`p-6 cursor-pointer transition-all duration-200 hover:shadow-lg border-2 ${
                  orderType === 'takeaway' 
                    ? 'border-primary ring-2 ring-primary/20 bg-primary/5' 
                    : 'border-border hover:border-primary/50'
                }`}
                onClick={handleTakeawaySelect}
              >
                <div className="space-y-4 text-center">
                  <div className="flex items-center justify-center">
                    <div className="p-4 bg-accent/20 rounded-full">
                      <ShoppingBag className="h-8 w-8 text-accent" />
                    </div>
                  </div>
                  
                  <div>
                    <h3 className="font-bold text-xl">À emporter</h3>
                    <p className="text-sm text-muted-foreground">
                      Le client souhaite emporter sa commande
                    </p>
                  </div>

                  {orderType === 'takeaway' && (
                    <Badge className="bg-accent text-accent-foreground">
                      Sélectionné
                    </Badge>
                  )}
                </div>
              </Card>
            </div>
          </div>

          {/* Table Selection (only if dine-in is selected) */}
          {orderType === 'dine-in' && (
            <div className="space-y-4">
              <div className="text-center p-4 bg-muted/20 rounded-lg">
                <p className="text-sm text-muted-foreground">
                  Sélectionnez une table libre pour le client
                </p>
              </div>

              {freeTables.length > 0 ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-medium">Tables disponibles</h3>
                    <Badge variant="secondary">
                      {freeTables.length} table{freeTables.length > 1 ? 's' : ''} libre{freeTables.length > 1 ? 's' : ''}
                    </Badge>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {freeTables.map((table) => (
                      <Card
                        key={table.id}
                        className={`p-4 cursor-pointer transition-all duration-200 hover:shadow-lg border-2 ${
                          selectedTable?.id === table.id 
                            ? 'border-primary ring-2 ring-primary/20' 
                            : 'border-border hover:border-primary/50'
                        }`}
                        onClick={() => handleTableSelect(table)}
                      >
                        <div className="space-y-3 text-center">
                          <div className="flex items-center justify-center">
                            <div className="p-3 bg-success/20 rounded-full">
                              <Users className="h-6 w-6 text-success" />
                            </div>
                          </div>
                          
                          <div>
                            <h3 className="font-bold text-lg">Table {table.number}</h3>
                            <p className="text-sm text-muted-foreground">
                              {table.seats} place{table.seats > 1 ? 's' : ''}
                            </p>
                          </div>

                          {selectedTable?.id === table.id && (
                            <Badge className="bg-primary text-primary-foreground">
                              Sélectionnée
                            </Badge>
                          )}
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-6">
                  <div className="p-4 bg-muted/20 rounded-full w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                    <Users className="h-8 w-8 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-medium mb-2">Aucune table libre</h3>
                  <p className="text-sm text-muted-foreground">
                    Toutes les tables sont actuellement occupées
                  </p>
                  <Button 
                    variant="outline" 
                    className="mt-4"
                    onClick={() => setOrderType('takeaway')}
                  >
                    Changer pour à emporter
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="outline" onClick={handleCancel}>
              Annuler
            </Button>
            <Button 
              onClick={handleConfirm}
              disabled={!canConfirm()}
              className="min-w-[150px]"
            >
              {getConfirmButtonText()}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
