import { getGhlCredentials } from "@/lib/ghl-credentials";
import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

type PipelinePayload = { id: string; name: string; stages?: { id: string; name: string }[] };
type CalendarPayload = { id: string; name: string };
type UserPayload = { id: string; name: string; email?: string };

/**
 * Salva os dados de predefinições (puxados do GHL) no Supabase.
 * - Upsert com active=true para os que vêm no payload.
 * - Estágios: desativar (active=false) somente quando o usuário clicou em Salvar e enviou uma lista
 *   não vazia de estágios; os que estão no banco e não estão nessa lista são desativados.
 *   Se stages vier vazio para uma pipeline (ex.: API não retornou estágios ao carregar), não desativar
 *   nenhum estágio existente.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const clientId = (body.client_id as string) || null;
  const pipelines = (body.pipelines ?? []) as PipelinePayload[];
  const calendars = (body.calendars ?? []) as CalendarPayload[];
  const users = (body.users ?? []) as UserPayload[];

  const cred = await getGhlCredentials(request, clientId);
  if ("error" in cred) return NextResponse.json({ error: cred.error }, { status: cred.status });

  const { client_id } = cred;
  const service = createServiceClient();

  try {
    const ghlPipelineIds = pipelines.map((p) => p.id);
    const ghlCalendarIds = calendars.map((c) => c.id);
    const ghlUserIds = users.map((u) => u.id);

    // ——— Pipelines: upsert com active=true; desativar os que não vêm no payload ———
    for (const p of pipelines) {
      await service
        .from("pipelines")
        .upsert(
          {
            client_id,
            ghl_pipeline_id: p.id,
            name: p.name,
            active: true,
          },
          { onConflict: "client_id,ghl_pipeline_id" }
        );

      const { data: pipeRow, error: pipeErr } = await service
        .from("pipelines")
        .select("id")
        .eq("client_id", client_id)
        .eq("ghl_pipeline_id", p.id)
        .single();

      if (pipeErr || !pipeRow) continue;

      const pipelineId = pipeRow.id;
      const stages = Array.isArray(p.stages) ? p.stages : [];
      const ghlStageIds = stages.map((s) => s.id);

      for (let i = 0; i < stages.length; i++) {
        const { error: stageErr } = await service.from("pipeline_stages").upsert(
          {
            pipeline_id: pipelineId,
            ghl_stage_id: stages[i].id,
            name: stages[i].name,
            position: i,
            active: true,
          },
          { onConflict: "pipeline_id,ghl_stage_id" }
        );
        if (stageErr) throw new Error(`Estágio ${stages[i].name}: ${stageErr.message}`);
      }

      // Desativar estágio só quando o usuário enviou uma lista não vazia e o estágio não está nela.
      // Se stages vier vazio (ex.: API não retornou estágios ao carregar a página), NÃO desativar nada.
      if (stages.length > 0) {
        const { data: existingStages } = await service
          .from("pipeline_stages")
          .select("id, ghl_stage_id")
          .eq("pipeline_id", pipelineId);
        const toDisable = (existingStages ?? []).filter((s) => !ghlStageIds.includes(s.ghl_stage_id));
        for (const row of toDisable) {
          await service.from("pipeline_stages").update({ active: false }).eq("id", row.id);
        }
      }
    }

    const { data: existingPipes } = await service
      .from("pipelines")
      .select("id, ghl_pipeline_id")
      .eq("client_id", client_id);
    const pipesToDisable = (existingPipes ?? []).filter((r) => !ghlPipelineIds.includes(r.ghl_pipeline_id));
    for (const row of pipesToDisable) {
      await service.from("pipelines").update({ active: false }).eq("id", row.id);
    }

    // ——— Calendários: upsert active=true; desativar os que não vêm ———
    for (const c of calendars) {
      await service.from("ghl_calendars").upsert(
        {
          client_id,
          ghl_calendar_id: c.id,
          name: c.name,
          active: true,
        },
        { onConflict: "client_id,ghl_calendar_id" }
      );
    }
    const { data: existingCals } = await service
      .from("ghl_calendars")
      .select("id, ghl_calendar_id")
      .eq("client_id", client_id);
    const calsToDisable = (existingCals ?? []).filter((r) => !ghlCalendarIds.includes(r.ghl_calendar_id));
    for (const row of calsToDisable) {
      await service.from("ghl_calendars").update({ active: false }).eq("id", row.id);
    }

    // ——— Usuários GHL: upsert active=true; desativar os que não vêm ———
    for (const u of users) {
      await service.from("ghl_users").upsert(
        {
          client_id,
          ghl_user_id: u.id,
          name: u.name ?? "",
          email: u.email ?? null,
          active: true,
        },
        { onConflict: "client_id,ghl_user_id" }
      );
    }
    const { data: existingUsers } = await service
      .from("ghl_users")
      .select("id, ghl_user_id")
      .eq("client_id", client_id);
    const usersToDisable = (existingUsers ?? []).filter((r) => !ghlUserIds.includes(r.ghl_user_id));
    for (const row of usersToDisable) {
      await service.from("ghl_users").update({ active: false }).eq("id", row.id);
    }

    // Registrar data do último salvamento das predefinições (pipelines/calendários/usuários)
    const lastSavedAt = new Date().toISOString();
    await service
      .from("location_predefinitions")
      .update({ active: false })
      .eq("client_id", client_id)
      .eq("key", "predefinitions_last_saved_at");
    await service.from("location_predefinitions").insert({
      client_id,
      key: "predefinitions_last_saved_at",
      value: lastSavedAt,
      active: true,
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao salvar predefinições";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
