import { getGhlCredentials } from "@/lib/ghl-credentials";
import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/** GET: retorna valores únicos e não-nulos de utm_source já salvos nas oportunidades do cliente. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id");
  const cred = await getGhlCredentials(request, clientId);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });

  const service = createServiceClient();
  const { data, error } = await service
    .from("opportunities")
    .select("utm_source")
    .eq("client_id", cred.client_id)
    .not("utm_source", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const terms = Array.from(
    new Set(
      (data ?? [])
        .map((r) => (r.utm_source as string | null)?.trim())
        .filter((v): v is string => typeof v === "string" && v.length > 0)
    )
  ).sort((a, b) => a.localeCompare(b));

  return NextResponse.json({ terms });
}
