import { getFacebookCredentials } from "@/lib/facebook-credentials";
import { facebookErrorResponse } from "@/lib/facebook-error-response";
import { getCampaigns } from "@/lib/facebook-ads";
import { NextRequest, NextResponse } from "next/server";

/** Lista campanhas da conta de anúncios configurada no cliente. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id");
  const status = searchParams.get("status") ?? undefined;
  const cred = await getFacebookCredentials(request, clientId, true);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });

  try {
    const campaigns = await getCampaigns(cred.fb_access_token, cred.fb_ad_account_id, {
      status,
    });
    return NextResponse.json({ campaigns });
  } catch (e) {
    return facebookErrorResponse(e, "Erro ao buscar campanhas do Facebook");
  }
}
