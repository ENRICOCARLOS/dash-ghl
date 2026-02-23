import { createClient, getAuthUser } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const supabase = await createClient();

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "ADM") return NextResponse.json({ error: "Apenas ADM" }, { status: 403 });

  const body = await request.json();
  const { user_id, new_password } = body as { user_id: string; new_password: string };
  if (!user_id || !new_password) {
    return NextResponse.json({ error: "user_id e new_password obrigatórios." }, { status: 400 });
  }

  const service = createServiceClient();
  const { error } = await service.auth.admin.updateUserById(user_id, { password: new_password });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
