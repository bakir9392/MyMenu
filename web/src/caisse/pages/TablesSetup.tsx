import { toast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { TableQrCodes } from "@/components/tables/table-qr-codes";

/** Configuration des tables et impression de leurs QR codes, depuis la caisse */
export const TablesSetup = () => (
  <div className="container mx-auto p-4 sm:p-6 space-y-6">
    <PageHeader />
    <TableQrCodes notify={(title, isError) => (isError ? toast.error(title) : toast.success(title))} />
  </div>
);
