import { toast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/layout/PageHeader";
import { InvoicesPage } from "@/components/invoices/invoices-page";

/** Factures des tables encaissées, depuis la caisse */
export const InvoicesSetup = () => (
  <div className="container mx-auto p-4 sm:p-6 space-y-6">
    <PageHeader />
    <InvoicesPage notify={(title, isError) => (isError ? toast.error(title) : toast.success(title))} />
  </div>
);
