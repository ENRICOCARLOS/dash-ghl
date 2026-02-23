import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** Limpa a sessão no servidor (cookies). O cliente deve redirecionar para "/" após chamar. */
export async function POST() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return POST();
}
