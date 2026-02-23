import { getGhlCredentials } from "@/lib/ghl-credentials";
import { ghlErrorResponse } from "@/lib/ghl-error-response";
import { getPipelines, getStagesByPipeline } from "@/lib/ghl";
import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

/**
 * Retorna pipelines e estágios. Usa os dados do banco (Supabase) quando existirem
 * para o cliente, assim o botão "Atualizar dados (GHL → Supabase)" reflete na tela.
 * Se não houver nada no banco, busca direto da API GHL.
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
    // Só usa o banco se houver pelo menos um estágio; senão busca da API GHL para exibir os estágios.
    const hasAnyStages = (dbStages ?? []).length > 0;
    if (hasAnyStages) {
      const pipelines = dbPipelines.map((p) => ({
        id: p.ghl_pipeline_id,
        name: p.name,
        stages: stagesByPipeline.get(p.id) ?? [],
      }));
      return NextResponse.json({ pipelines, source: "database" });
    }
  }

  try {
    const pipelines = await getPipelines(cred.ghl_api_key, cred.ghl_location_id);
    const withStages = await Promise.all(
      pipelines.map(async (p) => {
        try {
          const stages = await getStagesByPipeline(cred.ghl_api_key, cred.ghl_location_id, p.id);
          return { ...p, stages };
        } catch {
          return { ...p, stages: p.stages ?? [] };
        }
      })
    );
    return NextResponse.json({ pipelines: withStages, source: "ghl_api" });
  } catch (e) {
    return ghlErrorResponse(e, "Erro ao buscar pipelines");
  }
}
