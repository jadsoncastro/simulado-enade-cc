"""Testa supabase/schema.sql num PostgreSQL embutido, simulando o ambiente do Supabase.

Uso: pip install pgserver psycopg2-binary && python tests/test_schema.py
"""
import sys, os, tempfile, uuid
import pgserver, psycopg2

REPO = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tmp = tempfile.mkdtemp(prefix="pgtest_")
srv = pgserver.get_server(tmp, cleanup_mode="stop")
conn = psycopg2.connect(srv.get_uri())
conn.autocommit = True
cur = conn.cursor()

STUB = """
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
-- o Supabase concede tudo por padrão às tabelas novas do schema public
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
"""
cur.execute(STUB)
cur.execute(open(os.path.join(REPO, "supabase", "schema.sql"), encoding="utf-8").read())
cur.execute(open(os.path.join(REPO, "supabase", "seed_gabarito.sql"), encoding="utf-8").read())
cur.execute("insert into public.professores_autorizados (github) values ('Prof1')")

ids = {}
for nome in ["aluno1", "aluno2", "prof1"]:
    ids[nome] = str(uuid.uuid4())
    cur.execute("insert into auth.users values (%s, %s, %s)",
                (ids[nome], f"{nome}@ufop.edu.br",
                 f'{{"user_name": "{nome}", "full_name": "Nome {nome}", "avatar_url": "x"}}'))
cur.execute("select github, papel from perfis order by github")
print("perfis:", cur.fetchall())

ok = True
def check(cond, msg):
    global ok
    print(("  OK   " if cond else "  FALHA") + " " + msg)
    ok &= bool(cond)

def as_user(nome):
    cur.execute("reset role")
    cur.execute("select set_config('request.jwt.claim.sub', %s, false)", (ids[nome],))
    cur.execute("set role authenticated")

def fails(sql, args=()):
    try:
        cur.execute("savepoint s"); cur.execute(sql, args); cur.execute("release savepoint s")
        return False
    except psycopg2.Error as e:
        cur.execute("rollback to savepoint s")
        return True

cur.execute("begin")
UPSERT = """insert into respostas (tentativa_id, questao_id, tipo, alternativa, texto)
            values (%s, %s, %s, %s, %s)
            on conflict (tentativa_id, questao_id) do update set
              tentativa_id = excluded.tentativa_id, questao_id = excluded.questao_id,
              tipo = excluded.tipo, alternativa = excluded.alternativa, texto = excluded.texto"""

print("aluno1:")
as_user("aluno1")
cur.execute("insert into tentativas (ano, modo) values (2021, 'completa') returning id")
t1 = cur.fetchone()[0]
cur.execute("select count(*) from gabarito"); check(cur.fetchone()[0] == 0, "não vê gabarito antes de finalizar")
cur.execute(UPSERT, (t1, "2021-Q01", "objetiva", "A", None))
cur.execute(UPSERT, (t1, "2021-Q01", "objetiva", "E", None))   # troca para a correta
cur.execute(UPSERT, (t1, "2021-Q02", "objetiva", "A", None))   # errada (gabarito C)
cur.execute(UPSERT, (t1, "2021-Q29", "objetiva", "A", None))   # anulada
cur.execute(UPSERT, (t1, "2021-D03", "discursiva", None, "Minha resposta"))
cur.execute("select questao_id, correta from respostas order by questao_id")
r = dict(cur.fetchall())
check(r == {"2021-D03": None, "2021-Q01": True, "2021-Q02": False, "2021-Q29": None}, f"correção no servidor {r}")
check(fails("update respostas set correta = true"), "não altera 'correta'")
check(fails("update respostas set nota_professor = 10"), "não altera nota do professor")
check(fails("update perfis set papel = 'professor'"), "não se promove a professor")
check(fails("update tentativas set acertos = 35"), "não altera acertos")
check(fails("insert into tentativas (ano, modo, finalizada_em) values (2021,'completa', now())"), "não cria tentativa já finalizada")
check(fails("insert into gabarito values ('x', 2021, 'FG', 'A')"), "não grava gabarito")
check(fails("select avaliar_discursiva(1, 10, 'x')"), "aluno não avalia discursiva")
check(fails("select autoavaliar(%s, '2021-D03', 8)", (t1,)), "autoavaliação só após finalizar")
cur.execute("update perfis set nome = 'Fulano', matricula = '21.1.4000' where id = auth.uid()")
check(cur.rowcount == 1, "edita nome e matrícula")
cur.execute("select acertos, total_objetivas, percentual from finalizar_tentativa(%s)", (t1,))
res = cur.fetchone(); check(res[0] == 1 and res[1] == 33, f"finaliza: {res}")
cur.execute("select count(*) from gabarito"); check(cur.fetchone()[0] == 35, "vê gabarito de 2021 após finalizar")
cur.execute("select count(*) from gabarito where ano <> 2021"); check(cur.fetchone()[0] == 0, "não vê gabarito de outros anos")
cur.execute("update respostas set alternativa = 'C' where questao_id = '2021-Q02'")
check(cur.rowcount == 0, "não altera resposta após finalizar")
check(fails(UPSERT, (t1, "2021-Q03", "objetiva", "B", None)), "não insere resposta após finalizar")
cur.execute("select autoavaliar(%s, '2021-D03', 7.5)", (t1,))
cur.execute("select autoavaliacao from respostas where questao_id = '2021-D03'")
check(cur.fetchone()[0] == 7.5, "autoavaliação gravada")
cur.execute("insert into tentativas (ano, modo) values (2014, 'formacao_geral') returning id")
t2 = cur.fetchone()[0]
cur.execute(UPSERT, (t2, "2014-Q01", "objetiva", "A", None))
cur.execute("select total_objetivas from finalizar_tentativa(%s)", (t2,))
check(cur.fetchone()[0] == 8, "modo Formação Geral conta 8 objetivas")

print("aluno2:")
as_user("aluno2")
cur.execute("select count(*) from tentativas"); check(cur.fetchone()[0] == 0, "não vê tentativas de outro aluno")
cur.execute("select count(*) from respostas"); check(cur.fetchone()[0] == 0, "não vê respostas de outro aluno")
cur.execute("select count(*) from perfis"); check(cur.fetchone()[0] == 1, "vê só o próprio perfil")
check(fails(UPSERT, (t1, "2021-Q05", "objetiva", "A", None)), "não grava na tentativa de outro aluno")
check(fails("select finalizar_tentativa(%s)", (t2,)), "não finaliza tentativa de outro aluno")
cur.execute("delete from tentativas"); check(cur.rowcount == 0, "não exclui tentativa alheia")
check(fails("insert into professores_autorizados values ('aluno2')"), "não se inclui como professor")

print("prof1:")
as_user("prof1")
cur.execute("select count(*) from tentativas"); check(cur.fetchone()[0] == 2, "professor vê todas as tentativas")
cur.execute("select count(*) from perfis"); check(cur.fetchone()[0] == 3, "professor vê todos os perfis")
cur.execute("select id from respostas where questao_id = '2021-D03'")
rid = cur.fetchone()[0]
cur.execute("select avaliar_discursiva(%s, 8.5, 'Bom')", (rid,))
cur.execute("select nota_professor, comentario_professor from respostas where id = %s", (rid,))
check(cur.fetchone() == (8.5, "Bom"), "professor avalia discursiva")
cur.execute("insert into professores_autorizados values ('aluno2')")
cur.execute("select papel from perfis where github = 'aluno2'")
check(cur.fetchone()[0] == "professor", "professor promove outro usuário")
cur.execute("delete from professores_autorizados where github = 'aluno2'")
cur.execute("select papel from perfis where github = 'aluno2'")
check(cur.fetchone()[0] == "aluno", "remoção volta a aluno")
cur.execute("select count(*) from gabarito"); check(cur.fetchone()[0] == 210, "professor vê todo o gabarito")

print("anônimo:")
cur.execute("reset role"); cur.execute("select set_config('request.jwt.claim.sub', '', false)")
cur.execute("set role anon")
check(fails("select * from tentativas"), "anon sem acesso a tentativas")
check(fails("select * from gabarito"), "anon sem acesso ao gabarito")
cur.execute("rollback")

# o esquema precisa poder ser reexecutado
cur.execute("reset role")
cur.execute(open(os.path.join(REPO, "supabase", "schema.sql"), encoding="utf-8").read())
print("  OK    schema.sql reexecutado sem erro")
print("RESULTADO:", "TUDO OK" if ok else "HÁ FALHAS")
conn.close()
sys.exit(0 if ok else 1)
