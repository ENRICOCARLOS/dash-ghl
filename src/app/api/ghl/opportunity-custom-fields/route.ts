import { getGhlCredentials } from "@/lib/ghl-credentials";
import { ghlErrorResponse } from "@/lib/ghl-error-response";
import { getOpportunityCustomFields } from "@/lib/ghl";
import { NextRequest, NextResponse } from "next/server";

/** Lista campos customizados de oportunidades da location (para a tela de pré-definições "data da venda"). */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id");
  const cred = await getGhlCredentials(request, clientId);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });

  try {
    const customFields = await getOpportunityCustomFields(cred.ghl_api_key, cred.ghl_location_id);
    return NextResponse.json({ customFields });
  } catch (e) {
    return ghlErrorResponse(e, "Erro ao buscar campos customizados de oportunidades");
  }
}
