import { getFacebookCredentials } from "@/lib/facebook-credentials";
import { facebookErrorResponse } from "@/lib/facebook-error-response";
import { getInsights } from "@/lib/facebook-ads";
import { NextRequest, NextResponse } from "next/server";

/** Retorna insights (métricas) da conta de anúncios no período. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id");
  const since = searchParams.get("since") ?? undefined;
  const until = searchParams.get("until") ?? undefined;
  const date_preset = searchParams.get("date_preset") ?? undefined;
  const level = searchParams.get("level") as "account" | "campaign" | "adset" | "ad" | undefined;

  const cred = await getFacebookCredentials(request, clientId, true);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });

  try {
    const insights = await getInsights(cred.fb_access_token, cred.fb_ad_account_id, {
      since,
      until,
      date_preset,
      level,
    });
    return NextResponse.json({ insights });
  } catch (e) {
    return facebookErrorResponse(e, "Erro ao buscar insights do Facebook Ads");
  }
}
