import { getGhlCredentials } from "@/lib/ghl-credentials";
import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

function parseMs(value: string | null): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Retorna investimento (soma de spend) do Facebook Ads no período.
 * Query: client_id, start, end (ms). Retorna total e previousTotal (período anterior).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id");
  const startMs = parseMs(searchParams.get("start"));
  const endMs = parseMs(searchParams.get("end"));

  const cred = await getGhlCredentials(request, clientId);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });
  if (startMs == null || endMs == null) {
    return NextResponse.json({ error: "Query start e end (ms) são obrigatórios" }, { status: 400 });
  }

  const periodLength = endMs - startMs;
  const previousEndMs = startMs - 1;
  const previousStartMs = previousEndMs - periodLength;

  const service = createServiceClient();
  const startDate = new Date(startMs).toISOString().slice(0, 10);
  const endDate = new Date(endMs).toISOString().slice(0, 10);
  const prevStartDate = new Date(previousStartMs).toISOString().slice(0, 10);
  const prevEndDate = new Date(previousEndMs).toISOString().slice(0, 10);

  const { data: curr } = await service
    .from("facebook_ads_daily_insights")
    .select("spend")
    .eq("client_id", cred.client_id)
    .gte("date", startDate)
    .lte("date", endDate);

  const { data: prev } = await service
    .from("facebook_ads_daily_insights")
    .select("spend")
    .eq("client_id", cred.client_id)
    .gte("date", prevStartDate)
    .lte("date", prevEndDate);

  const total = (curr ?? []).reduce((s, r) => s + Number(r.spend ?? 0), 0);
  const previousTotal = (prev ?? []).reduce((s, r) => s + Number(r.spend ?? 0), 0);

  return NextResponse.json({ total, previousTotal });
}
