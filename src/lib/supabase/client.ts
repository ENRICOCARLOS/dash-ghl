import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Variáveis do Supabase não encontradas. Crie o arquivo .env.local na raiz do projeto (copie do .env.example), preencha NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY e reinicie o servidor (npm run dev)."
    );
  }
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}
