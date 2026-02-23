-- ============================================================
-- Corrigir / criar profile para um usuário (ex.: após login que não avança)
-- Execute no SQL Editor do Supabase (Dashboard → SQL Editor).
-- Troque o e-mail abaixo pelo seu se for outro usuário.
-- ============================================================

-- Cria o profile se não existir (usando o id do auth.users) e garante role ADM
INSERT INTO public.profiles (id, email, full_name, role, created_at, updated_at)
SELECT
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', ''),
  'ADM',
  now(),
  now()
FROM auth.users u
WHERE u.email = 'carlos.en.cordeiro@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO UPDATE SET
  role = 'ADM',
  updated_at = now();

-- Se o usuário ainda não existir em auth.users, crie-o antes em:
-- Authentication → Users → Add user (e-mail + senha).
-- Depois execute este script de novo.
