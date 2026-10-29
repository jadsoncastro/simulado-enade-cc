# Passo a passo de publicação

São cerca de 30 minutos, sem custo: o GitHub Pages é gratuito para repositórios públicos e o
Supabase tem plano gratuito.

Ao longo do guia, troque:

| Marcador | Exemplo |
|---|---|
| `<usuario>` | usuário ou organização do GitHub dono do repositório (ex.: `cocic-ufop`) |
| `<repo>` | nome do repositório (ex.: `simulado-enade-cc`) |
| `<ref>` | identificador do projeto no Supabase (ex.: `abcdefghijklmno`) |

O endereço final do site será `https://<usuario>.github.io/<repo>/`.

---

## 1. Publicar o código no GitHub

1. Entre em <https://github.com/new> e crie o repositório `<repo>` como **Public**, sem README,
   .gitignore ou licença (eles já existem no projeto).
   - Repositório privado também funciona com o GitHub Pages, mas só em planos pagos ou do
     GitHub Education/Team.
2. No terminal, dentro da pasta `simulado-enade-cc` (o repositório local já foi criado e tem o
   primeiro commit):

   ```bash
   git remote add origin https://github.com/<usuario>/<repo>.git
   git push -u origin main
   ```

## 2. Criar o projeto no Supabase

1. Entre em <https://supabase.com> com a conta do GitHub e clique em **New project**.
2. Escolha um nome (ex.: `simulado-enade`), uma senha forte para o banco (guarde-a) e a região
   **South America (São Paulo)**.
3. Quando o projeto ficar pronto, abra **SQL Editor → New query** e:
   1. cole todo o conteúdo de [`supabase/schema.sql`](../supabase/schema.sql) e clique em **Run**;
   2. em outra query, cole [`supabase/seed_gabarito.sql`](../supabase/seed_gabarito.sql) e clique em **Run**;
   3. cadastre o primeiro professor (o seu usuário do GitHub, sem `@`):

      ```sql
      insert into public.professores_autorizados (github) values ('seu-usuario-github');
      ```
4. Confira em **Table Editor**: a tabela `gabarito` deve ter **210 linhas**.

## 3. Criar o aplicativo OAuth no GitHub (login)

1. Abra <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**.
   (Para deixar o app em nome da organização: *Organização → Settings → Developer settings → OAuth Apps*.)
2. Preencha:
   - **Application name**: `Simulado ENADE – Ciência da Computação`
   - **Homepage URL**: `https://<usuario>.github.io/<repo>/`
   - **Authorization callback URL**: `https://<ref>.supabase.co/auth/v1/callback`
     (no Supabase: **Authentication → Sign In / Providers → GitHub**, que mostra a *Callback URL* pronta para copiar)
3. Clique em **Register application**, copie o **Client ID** e gere um **Client secret**
   (**Generate a new client secret**). Copie o segredo na hora, porque ele não é mostrado de novo.

## 4. Ligar o login GitHub no Supabase

1. **Authentication → Sign In / Providers → GitHub**: ative, cole o *Client ID* e o
   *Client secret* e salve.
2. **Authentication → URL Configuration**:
   - **Site URL**: `https://<usuario>.github.io/<repo>/`
   - **Redirect URLs** (adicione as duas):
     - `https://<usuario>.github.io/<repo>/**`
     - `http://localhost:8000/**` (para testar no seu computador)

## 5. Configurar o site

1. No Supabase, abra **Project Settings → API Keys** (ou o botão **Connect**) e copie:
   - a **Project URL** (`https://<ref>.supabase.co`);
   - a chave pública **anon** / **publishable**. **Não** use a `service_role`/`secret`.
2. Edite [`assets/js/config.js`](../assets/js/config.js):

   ```js
   export const SUPABASE_URL = "https://<ref>.supabase.co";
   export const SUPABASE_ANON_KEY = "eyJhbGciOi...";   // chave anon/publishable
   ```
3. Envie a alteração:

   ```bash
   git add assets/js/config.js
   git commit -m "Configura Supabase"
   git push
   ```

## 6. Ativar o GitHub Pages

1. No repositório: **Settings → Pages**.
2. Em **Build and deployment → Source**, escolha **Deploy from a branch**, branch **main** e
   pasta **/ (root)**, e clique em **Save**.
3. Aguarde 1 a 2 minutos. O endereço `https://<usuario>.github.io/<repo>/` aparece no topo da página.

## 7. Testar antes de divulgar

1. Abra o site e clique em **Entrar com GitHub**. Como seu usuário está em
   `professores_autorizados`, o link **Painel do professor** deve aparecer no topo.
2. Faça um simulado curto (modo *Só Formação Geral*) e finalize. Confira se a correção e os
   padrões de resposta aparecem.
3. Peça a um aluno (ou use outra conta do GitHub) para entrar. Ele deve ver apenas os próprios
   dados e pedir nome e matrícula no primeiro acesso.
4. No painel, abra **Discursivas**, dê uma nota e confira se o aluno a vê na correção.

## 8. Divulgar aos alunos

Mensagem sugerida:

> Está no ar o simulado do ENADE com as provas oficiais de Ciência da Computação (2005–2021):
> https://<usuario>.github.io/<repo>/
> Entre com a sua conta do GitHub (crie uma gratuitamente em github.com, se ainda não tiver) e
> informe nome e matrícula no primeiro acesso. Suas respostas são salvas automaticamente. Ao
> finalizar, você vê o gabarito oficial e o padrão de resposta das discursivas.

**Dados pessoais (LGPD):** o site guarda o nome, a matrícula, o usuário e o e-mail do GitHub e
as respostas. Esses dados são usados só pela coordenação para acompanhar a preparação para o
ENADE. Vale informar isso aos alunos.

---

## Manutenção

**Incluir/remover professores:** pelo painel (aba **Professores**) ou por SQL:

```sql
insert into public.professores_autorizados (github) values ('usuario');
delete from public.professores_autorizados where github = 'usuario';
```

**Projeto pausado (plano gratuito):** o Supabase pausa projetos gratuitos depois de 7 dias sem
nenhum acesso. Se o login parar de funcionar após as férias, entre no painel do Supabase e
clique em **Restore project**.

**Backup dos resultados:** no painel do professor, **Alunos → Exportar CSV**. Também dá para
exportar cada tabela pelo **Table Editor** do Supabase (**Export → CSV**).

**Novas provas ou correções nos recortes:** coloque os PDFs na pasta `Simulado` (mesmo padrão de
nomes) e rode `python tools/build_questions.py --pdfs "../Simulado"`. Uma edição nova exige uma
entrada em `PROVAS` no script. Depois faça `git push` e rode de novo `supabase/seed_gabarito.sql`.

**Zerar os dados de teste antes de divulgar:**

```sql
delete from public.tentativas;   -- apaga também as respostas
```

## Solução de problemas

| Sintoma | Causa provável e solução |
|---|---|
| Depois do login, o navegador vai para `localhost:3000` | **Site URL** não configurada (passo 4.2). |
| "redirect_uri is not associated with this application" | A *Authorization callback URL* do OAuth App no GitHub está diferente da *Callback URL* do Supabase (passo 3.2). |
| "Perfil não encontrado" | O usuário entrou antes de `schema.sql` ser executado. Rode o SQL abaixo. |
| Login funciona, mas não aparece o Painel do professor | O usuário do GitHub em `professores_autorizados` está com grafia diferente. Confira na tabela `perfis`, coluna `github`. |
| "Configuração pendente" na página inicial | `assets/js/config.js` não foi editado ou o push não foi feito. |
| Página 404 no GitHub Pages | Pages ainda publicando (aguarde) ou pasta errada (precisa ser **/ (root)** da branch **main**). |
| Alterações não aparecem | Cache do navegador: recarregue com Ctrl+F5. |

SQL para criar perfis de quem entrou antes do esquema:

```sql
insert into public.perfis (id, email, github, nome, avatar_url)
select id, email,
       raw_user_meta_data ->> 'user_name',
       coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'user_name'),
       raw_user_meta_data ->> 'avatar_url'
  from auth.users
on conflict (id) do nothing;

update public.perfis p set papel = 'professor'
  from public.professores_autorizados a
 where lower(p.github) = lower(a.github);
```
