import { ReactNode } from "react";

interface AuthLayoutProps {
  children: ReactNode;
}

export const AuthLayout = ({ children }: AuthLayoutProps) => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary to-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-2xl shadow-xl border border-border/50 overflow-hidden">
          <div className="bg-gradient-to-r from-primary to-primary-glow p-6 text-center">
            <h1 className="text-2xl font-bold text-primary-foreground mb-2">
              Restaurant POS
            </h1>
            <p className="text-primary-foreground/80 text-sm">
              Système de caisse professionnel
            </p>
          </div>
          <div className="p-6">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};