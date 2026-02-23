"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

export default function GerenciarClientesLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading, isAdm } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace("/");
      return;
    }
    if (!isAdm) {
      router.replace("/dashboard");
      return;
    }
  }, [user, loading, isAdm, router]);

  if (loading || !user || !isAdm) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
