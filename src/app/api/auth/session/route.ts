import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  let user = (await supabase.auth.getUser()).data.user;
  let usedToken = false;

  if (!user) {
    const authHeader = request.headers.get("Authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    if (token) {
      const { data } = await supabase.auth.getUser(token);
      user = data.user;
      usedToken = !!user;
    }
  }

  if (!user) {
    return NextResponse.json({ user: null, clients: [] }, { status: 200 });
  }

  const db = usedToken ? createServiceClient() : supabase;

  let profile = (await db
    .from("profiles")
    .select("id, email, full_name, role")
    .eq("id", user.id)
    .single()).data;

  let createdProfile = false;
  if (!profile) {
    const service = createServiceClient();
    const { count } = await service.from("profiles").select("id", { count: "exact", head: true });
    const isFirstUser = (count ?? 0) === 0;
    const { data: inserted, error } = await service.from("profiles").insert({
      id: user.id,
      email: user.email ?? "",
      full_name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
      role: isFirstUser ? "ADM" : "user",
    }).select("id, email, full_name, role").single();
    if (error) {
      if (error.code === "23505") {
        const { data: existing } = await service.from("profiles").select("id, email, full_name, role").eq("id", user.id).single();
        if (existing) {
          profile = existing;
        } else {
          console.error("[session] Profile já existe mas não foi possível ler:", error.message);
          return NextResponse.json({ user: null, clients: [] }, { status: 200 });
        }
      } else {
        console.error("[session] Erro ao criar profile:", error);
        return NextResponse.json({ user: null, clients: [] }, { status: 200 });
      }
    } else {
      profile = inserted;
      createdProfile = true;
    }
  }

  // Sempre usar service role para buscar clientes (evita RLS/cookie no servidor deixar lista vazia)
  const dataClient = createServiceClient();
  type ClientRow = { id: string; name: string; ghl_location_id: string; report_slug: string };
  let clients: ClientRow[] = [];
  if (profile.role === "ADM") {
    const { data: allClients } = await dataClient.from("clients").select("id, name, ghl_location_id, report_slug").order("name");
    clients = (allClients ?? []) as ClientRow[];
  } else {
    const { data: links } = await dataClient
      .from("user_clients")
      .select("clients(id, name, ghl_location_id, report_slug)")
      .eq("user_id", user.id);
    const raw = (links ?? []) as unknown as { clients: ClientRow | null }[];
    clients = raw.map((l) => l.clients).filter((c): c is ClientRow => c != null);
  }

  return NextResponse.json({
    user: {
      id: profile.id,
      email: profile.email,
      full_name: profile.full_name,
      role: profile.role,
    },
    clients,
  });
}
