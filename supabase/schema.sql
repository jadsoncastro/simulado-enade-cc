-- =============================================================================
-- Simulado ENADE – Ciência da Computação
-- Esquema do banco (Supabase / PostgreSQL)
--
-- Execute este arquivo inteiro no SQL Editor do Supabase e, em seguida,
-- supabase/seed_gabarito.sql. Pode ser executado de novo sem perder dados.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Perfis (um por usuário autenticado via GitHub)
-- -----------------------------------------------------------------------------
create table if not exists public.perfis (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  github      text,
  nome        text,
  matricula   text,
  avatar_url  text,
  papel       text not null default 'aluno' check (papel in ('aluno', 'professor')),
  criado_em   timestamptz not null default now()
);

-- Lista de usuários do GitHub que entram como professor
create table if not exists public.professores_autorizados (
  github      text primary key,
  incluido_em timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Gabarito (nunca exposto antes de o aluno finalizar a prova)
-- -----------------------------------------------------------------------------
create table if not exists public.gabarito (
  questao_id  text primary key,                 -- ex.: 2014-Q09
  ano         int  not null,
  componente  text not null check (componente in ('FG', 'CE')),
  resposta    text not null check (resposta in ('A', 'B', 'C', 'D', 'E', 'ANULADA'))
);

-- -----------------------------------------------------------------------------
-- Tentativas e respostas
-- -----------------------------------------------------------------------------
create table if not exists public.tentativas (
  id               uuid primary key default gen_random_uuid(),
  aluno_id         uuid not null default auth.uid() references public.perfis (id) on delete cascade,
  ano              int  not null,
  modo             text not null default 'completa'
                   check (modo in ('completa', 'formacao_geral', 'especifico')),
  iniciada_em      timestamptz not null default now(),
  finalizada_em    timestamptz,
  acertos          int,
  total_objetivas  int,
  percentual       numeric(5, 1)
);
create index if not exists tentativas_aluno_idx on public.tentativas (aluno_id);

-- Simulado aleatório: ano nulo e a lista de questões sorteadas para o aluno
alter table public.tentativas alter column ano drop not null;
alter table public.tentativas add column if not exists questoes text[];
alter table public.tentativas drop constraint if exists tentativas_tipo_check;
alter table public.tentativas add constraint tentativas_tipo_check check (
  (ano is not null and questoes is null)
  or (ano is null and coalesce(cardinality(questoes), 0) between 1 and 40));

create table if not exists public.respostas (
  id                    bigint generated always as identity primary key,
  tentativa_id          uuid not null references public.tentativas (id) on delete cascade,
  aluno_id              uuid not null default auth.uid() references public.perfis (id) on delete cascade,
  questao_id            text not null,
  tipo                  text not null check (tipo in ('objetiva', 'discursiva')),
  alternativa           text check (alternativa in ('A', 'B', 'C', 'D', 'E')),
  texto                 text check (char_length(texto) <= 4000),
  correta               boolean,                          -- preenchido pelo banco
  autoavaliacao         numeric(4, 1) check (autoavaliacao between 0 and 10),
  nota_professor        numeric(4, 1) check (nota_professor between 0 and 10),
  comentario_professor  text,
  atualizada_em         timestamptz not null default now(),
  unique (tentativa_id, questao_id)
);
create index if not exists respostas_questao_idx on public.respostas (questao_id);

-- -----------------------------------------------------------------------------
-- Funções auxiliares
-- -----------------------------------------------------------------------------
create or replace function public.is_professor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and papel = 'professor');
$$;

-- Cria o perfil no primeiro login (dados vindos do GitHub)
create or replace function public.criar_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_github text := coalesce(new.raw_user_meta_data ->> 'user_name',
                            new.raw_user_meta_data ->> 'preferred_username');
begin
  insert into public.perfis (id, email, github, nome, avatar_url, papel)
  values (
    new.id,
    new.email,
    v_github,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', v_github),
    new.raw_user_meta_data ->> 'avatar_url',
    case when exists (select 1 from public.professores_autorizados p
                      where lower(p.github) = lower(v_github))
         then 'professor' else 'aluno' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil();

-- Mantém o papel sincronizado com a lista de professores
create or replace function public.sincronizar_professores()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.perfis set papel = 'professor' where lower(github) = lower(new.github);
    return new;
  else
    update public.perfis set papel = 'aluno' where lower(github) = lower(old.github);
    return old;
  end if;
end;
$$;

drop trigger if exists ao_alterar_professores on public.professores_autorizados;
create trigger ao_alterar_professores
  after insert or delete on public.professores_autorizados
  for each row execute function public.sincronizar_professores();

-- Corrige a questão objetiva no servidor (o navegador nunca vê o gabarito antes)
create or replace function public.corrigir_resposta()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_gab text;
begin
  new.atualizada_em := now();
  new.aluno_id := (select aluno_id from public.tentativas where id = new.tentativa_id);
  if new.tipo = 'objetiva' then
    select resposta into v_gab from public.gabarito where questao_id = new.questao_id;
    new.correta := case
      when v_gab is null or v_gab = 'ANULADA' or new.alternativa is null then null
      else new.alternativa = v_gab end;
    new.texto := null;
  else
    new.correta := null;
    new.alternativa := null;
  end if;
  return new;
end;
$$;

drop trigger if exists ao_salvar_resposta on public.respostas;
create trigger ao_salvar_resposta
  before insert or update of alternativa, texto on public.respostas
  for each row execute function public.corrigir_resposta();

-- Finaliza a tentativa e calcula a nota das objetivas
create or replace function public.finalizar_tentativa(p_tentativa uuid)
returns public.tentativas language plpgsql security definer set search_path = public as $$
declare
  t public.tentativas;
  v_total int;
  v_acertos int;
begin
  select * into t from public.tentativas where id = p_tentativa for update;
  if t.id is null or t.aluno_id <> auth.uid() then
    raise exception 'Tentativa não encontrada';
  end if;
  if t.finalizada_em is not null then
    return t;
  end if;

  if t.questoes is not null then
    select count(*) into v_total
      from public.gabarito g
     where g.questao_id = any (t.questoes) and g.resposta <> 'ANULADA';
  else
    select count(*) into v_total
      from public.gabarito g
     where g.ano = t.ano and g.resposta <> 'ANULADA'
       and (t.modo = 'completa'
            or (t.modo = 'formacao_geral' and g.componente = 'FG')
            or (t.modo = 'especifico' and g.componente = 'CE'));
  end if;

  select count(*) into v_acertos
    from public.respostas r
   where r.tentativa_id = t.id and r.tipo = 'objetiva' and r.correta
     and (t.questoes is null or r.questao_id = any (t.questoes));

  update public.tentativas
     set finalizada_em   = now(),
         acertos         = v_acertos,
         total_objetivas = v_total,
         percentual      = case when v_total > 0 then round(100.0 * v_acertos / v_total, 1) end
   where id = t.id
  returning * into t;
  return t;
end;
$$;

-- Autoavaliação da discursiva (aluno, depois de ver o padrão de resposta)
create or replace function public.autoavaliar(p_tentativa uuid, p_questao text, p_nota numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.tentativas
                 where id = p_tentativa and aluno_id = auth.uid() and finalizada_em is not null) then
    raise exception 'Finalize a prova antes de se autoavaliar';
  end if;
  insert into public.respostas (tentativa_id, questao_id, tipo, autoavaliacao)
  values (p_tentativa, p_questao, 'discursiva', p_nota)
  on conflict (tentativa_id, questao_id) do update set autoavaliacao = excluded.autoavaliacao;
end;
$$;

-- Correção da discursiva pelo professor
create or replace function public.avaliar_discursiva(p_resposta bigint, p_nota numeric, p_comentario text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_professor() then
    raise exception 'Apenas professores podem avaliar';
  end if;
  update public.respostas
     set nota_professor = p_nota, comentario_professor = p_comentario
   where id = p_resposta and tipo = 'discursiva';
end;
$$;

-- -----------------------------------------------------------------------------
-- Segurança em nível de linha (RLS)
-- -----------------------------------------------------------------------------
alter table public.perfis                  enable row level security;
alter table public.professores_autorizados enable row level security;
alter table public.gabarito                enable row level security;
alter table public.tentativas              enable row level security;
alter table public.respostas               enable row level security;

-- perfis
drop policy if exists perfis_ler on public.perfis;
create policy perfis_ler on public.perfis for select
  using (id = auth.uid() or public.is_professor());
drop policy if exists perfis_editar on public.perfis;
create policy perfis_editar on public.perfis for update
  using (id = auth.uid()) with check (id = auth.uid());

-- professores_autorizados: só professores leem e alteram
drop policy if exists prof_ler on public.professores_autorizados;
create policy prof_ler on public.professores_autorizados for select using (public.is_professor());
drop policy if exists prof_incluir on public.professores_autorizados;
create policy prof_incluir on public.professores_autorizados for insert with check (public.is_professor());
drop policy if exists prof_remover on public.professores_autorizados;
create policy prof_remover on public.professores_autorizados for delete using (public.is_professor());

-- gabarito: professor sempre; aluno só do ano (ou das questões sorteadas) de uma tentativa
-- que ele já finalizou
drop policy if exists gabarito_ler on public.gabarito;
create policy gabarito_ler on public.gabarito for select using (
  public.is_professor() or exists (
    select 1 from public.tentativas t
     where t.aluno_id = auth.uid() and t.finalizada_em is not null
       and (t.ano = gabarito.ano or gabarito.questao_id = any (t.questoes)))
);

-- tentativas
drop policy if exists tentativas_ler on public.tentativas;
create policy tentativas_ler on public.tentativas for select
  using (aluno_id = auth.uid() or public.is_professor());
drop policy if exists tentativas_criar on public.tentativas;
create policy tentativas_criar on public.tentativas for insert
  with check (aluno_id = auth.uid() and finalizada_em is null);
drop policy if exists tentativas_excluir on public.tentativas;
create policy tentativas_excluir on public.tentativas for delete
  using ((aluno_id = auth.uid() and finalizada_em is null) or public.is_professor());

-- respostas: o aluno grava apenas enquanto a tentativa está aberta
drop policy if exists respostas_ler on public.respostas;
create policy respostas_ler on public.respostas for select
  using (aluno_id = auth.uid() or public.is_professor());
drop policy if exists respostas_criar on public.respostas;
create policy respostas_criar on public.respostas for insert with check (
  exists (select 1 from public.tentativas t
           where t.id = tentativa_id and t.aluno_id = auth.uid() and t.finalizada_em is null));
drop policy if exists respostas_editar on public.respostas;
create policy respostas_editar on public.respostas for update
  using (exists (select 1 from public.tentativas t
                  where t.id = tentativa_id and t.aluno_id = auth.uid() and t.finalizada_em is null))
  with check (exists (select 1 from public.tentativas t
                       where t.id = tentativa_id and t.aluno_id = auth.uid() and t.finalizada_em is null));

-- -----------------------------------------------------------------------------
-- Privilégios por coluna (o aluno não consegue alterar nota, papel etc.)
-- -----------------------------------------------------------------------------
revoke all on public.perfis, public.tentativas, public.respostas,
              public.gabarito, public.professores_autorizados from anon;

revoke update on public.perfis from authenticated;
grant  select on public.perfis to authenticated;
grant  update (nome, matricula) on public.perfis to authenticated;

revoke insert, update on public.tentativas from authenticated;
grant  select, delete on public.tentativas to authenticated;
grant  insert (ano, modo, questoes) on public.tentativas to authenticated;

revoke insert, update on public.respostas from authenticated;
grant  select on public.respostas to authenticated;
grant  insert (tentativa_id, questao_id, tipo, alternativa, texto) on public.respostas to authenticated;
-- o upsert do supabase-js reenvia todas as colunas do payload; a RLS impede mudar de tentativa
-- e o gatilho corrigir_resposta recalcula "correta" e "aluno_id"
grant  update (tentativa_id, questao_id, tipo, alternativa, texto) on public.respostas to authenticated;

revoke insert, update, delete on public.gabarito from authenticated;
grant  select on public.gabarito to authenticated;

grant select, insert, delete on public.professores_autorizados to authenticated;

revoke execute on function public.finalizar_tentativa(uuid)                  from anon, public;
revoke execute on function public.autoavaliar(uuid, text, numeric)           from anon, public;
revoke execute on function public.avaliar_discursiva(bigint, numeric, text)  from anon, public;
grant  execute on function public.finalizar_tentativa(uuid)                  to authenticated;
grant  execute on function public.autoavaliar(uuid, text, numeric)           to authenticated;
grant  execute on function public.avaliar_discursiva(bigint, numeric, text)  to authenticated;
