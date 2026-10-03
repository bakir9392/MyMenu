import { useEffect, useState } from "react";
import { toast } from "@/hooks/use-toast";
import { useSocket } from "@/hooks/useSocket";
import { PageHeader } from "@/components/layout/PageHeader";
import { ComplaintsPage } from "@/components/complaints/complaints-page";

/** Réclamations des clients, depuis la caisse (mise à jour en temps réel) */
export const ComplaintsSetup = () => {
  const { socket } = useSocket();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => setRefreshKey((n) => n + 1);
    socket.on("complaint-created", refresh);
    socket.on("complaint-updated", refresh);
    return () => {
      socket.off("complaint-created", refresh);
      socket.off("complaint-updated", refresh);
    };
  }, [socket]);

  return (
    <div className="container mx-auto p-4 sm:p-6 space-y-6">
      <PageHeader />
      <ComplaintsPage
        refreshKey={refreshKey}
        notify={(title, isError) => (isError ? toast.error(title) : toast.success(title))}
      />
    </div>
  );
};
