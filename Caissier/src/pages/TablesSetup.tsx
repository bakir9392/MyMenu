import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { TableQrCodes } from "@/components/tables/table-qr-codes";

interface TablesSetupProps {
  currentUser: string;
  onLogout: () => void;
}

/** Configuration des tables et impression de leurs QR codes, depuis la caisse */
export const TablesSetup = ({ currentUser, onLogout }: TablesSetupProps) => {
  const navigate = useNavigate();

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={() => navigate("/")} className="flex items-center gap-2">
          <ArrowLeft className="h-4 w-4" />
          Retour
        </Button>
        <div className="flex items-center gap-4">
          <div className="text-sm text-muted-foreground">
            Connecté en tant que: <span className="font-medium text-foreground">{currentUser}</span>
          </div>
          <Button variant="outline" onClick={onLogout}>
            Déconnexion
          </Button>
        </div>
      </div>

      <TableQrCodes notify={(title, isError) => (isError ? toast.error(title) : toast.success(title))} />
    </div>
  );
};
