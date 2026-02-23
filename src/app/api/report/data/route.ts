import { getGhlCredentials } from "@/lib/ghl-credentials";
import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * Retorna apenas dados já salvos no banco (pipelines + oportunidades).
 * Não chama a API do GHL. Use no relatório para exibir rápido sem atualizar.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("client_id");
  const cred = await getGhlCredentials(request, clientId);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });

  const service = createServiceClient();

  const { data: dbPipelines } = await service
    .from("pipelines")
    .select("id, ghl_pipeline_id, name")
    .eq("client_id", cred.client_id)
    .eq("active", true)
    .order("created_at", { ascending: true });

  let pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[] = [];
  if (dbPipelines && dbPipelines.length > 0) {
    const pipelineIds = dbPipelines.map((p) => p.id);
    const { data: dbStages } = await service
      .from("pipeline_stages")
      .select("pipeline_id, ghl_stage_id, name, position")
      .in("pipeline_id", pipelineIds)
      .eq("active", true)
      .order("position", { ascending: true });
    const stagesByPipeline = new Map<string, { id: string; name: string }[]>();
    for (const s of dbStages ?? []) {
      const list = stagesByPipeline.get(s.pipeline_id) ?? [];
      list.push({ id: s.ghl_stage_id, name: s.name });
      stagesByPipeline.set(s.pipeline_id, list);
    }
    pipelines = dbPipelines.map((p) => ({
      id: p.ghl_pipeline_id,
      name: p.name,
      stages: stagesByPipeline.get(p.id) ?? [],
    }));
  }

  const oppRows: { pipeline_id: string | null; stage_id: string | null; source: string | null }[] = [];
  const sourcesSet = new Set<string>();
  let oppOffset = 0;
  const PAGE = 1000;
  while (true) {
    const { data: page } = await service
      .from("opportunities")
      .select("pipeline_id, stage_id, source")
      .eq("client_id", cred.client_id)
      .range(oppOffset, oppOffset + PAGE - 1);
    if (!page?.length) break;
    for (const o of page as { pipeline_id: string | null; stage_id: string | null; source: string | null }[]) {
      const src = (o.source ?? "").toString().trim() || "—";
      sourcesSet.add(src);
    }
    oppRows.push(...(page as { pipeline_id: string | null; stage_id: string | null; source: string | null }[]));
    if (page.length < PAGE) break;
    oppOffset += PAGE;
  }

  const opportunities = oppRows.map((o) => ({
    pipelineId: o.pipeline_id ?? undefined,
    stageId: o.stage_id ?? undefined,
  }));

  const sources = Array.from(sourcesSet).sort();

  return NextResponse.json({ pipelines, opportunities, sources });
}
