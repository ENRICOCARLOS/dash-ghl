import { createServiceClient, getAuthUser } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const service = createServiceClient();

  const { data } = await service
    .from("user_active_client")
    .select("client_id")
    .eq("user_id", user.id)
    .single();

  return NextResponse.json({ client_id: data?.client_id ?? null });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const service = createServiceClient();

  const body = await request.json();
  const { client_id } = body as { client_id: string };
  if (!client_id) return NextResponse.json({ error: "client_id obrigatório" }, { status: 400 });

  const { data: profile } = await service.from("profiles").select("role").eq("id", user.id).single();
  const isAdm = profile?.role === "ADM";
  if (!isAdm) {
    const { data: link } = await service
      .from("user_clients")
      .select("user_id")
      .eq("user_id", user.id)
      .eq("client_id", client_id)
      .single();
    if (!link) return NextResponse.json({ error: "Sem acesso a esta conta" }, { status: 403 });
  }

  await service.from("user_active_client").upsert(
    { user_id: user.id, client_id },
    { onConflict: "user_id" }
  );

  return NextResponse.json({ ok: true });
}
