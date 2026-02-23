import { getGhlCredentials } from "@/lib/ghl-credentials";
import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/** GET: retorna a data do último salvamento das predefinições (pipelines/calendários/usuários). */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id");

  const cred = await getGhlCredentials(request, clientId ?? undefined);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });

  const service = createServiceClient();
  const { data: row } = await service
    .from("location_predefinitions")
    .select("value")
    .eq("client_id", cred.client_id)
    .eq("key", "predefinitions_last_saved_at")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    last_saved_at: row?.value ?? null,
  });
}
