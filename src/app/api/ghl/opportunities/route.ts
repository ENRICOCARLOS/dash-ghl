import { getGhlCredentials } from "@/lib/ghl-credentials";
import { ghlErrorResponse } from "@/lib/ghl-error-response";
import { getOpportunities } from "@/lib/ghl";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id");
  const pipelineId = searchParams.get("pipeline_id") ?? undefined;
  const stageId = searchParams.get("stage_id") ?? undefined;
  const cred = await getGhlCredentials(request, clientId);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });

  try {
    const opportunities = await getOpportunities(cred.ghl_api_key, cred.ghl_location_id, {
      pipelineId,
      stageId,
    });
    return NextResponse.json({ opportunities });
  } catch (e) {
    return ghlErrorResponse(e, "Erro ao buscar oportunidades");
  }
}
