# Simulado ENADE – Ciência da Computação

Site de simulado com as provas oficiais do ENADE de **Bacharelado em Ciência da Computação**
(edições 2005, 2008, 2011, 2014, 2017 e 2021). Fica hospedado no **GitHub Pages**, e o login e
os dados ficam no **Supabase**.

- **Alunos** entram com a conta do GitHub, escolhem a edição e o modo (prova completa, só
  Formação Geral ou só Componente Específico) e respondem no próprio site. As respostas são
  salvas automaticamente e dá para parar e continuar depois. Ao finalizar, veem a correção das
  objetivas pelo gabarito oficial e o **padrão de resposta** de cada discursiva, e fazem a
  autoavaliação.
- **Professores** usam um painel com o resumo da turma, a lista de alunos (com exportação CSV),
  as tentativas, a correção das discursivas (com nota e comentário que o aluno vê), o índice de
  acerto por questão e o cadastro de outros professores.

O passo a passo de publicação está em **[docs/PUBLICACAO.md](docs/PUBLICACAO.md)**.

## Conteúdo das provas

| Edição | Objetivas | Discursivas | Observações |
|---|---|---|---|
| 2021 | 35 | 5 | Q29 e Q33 anuladas pelo INEP |
| 2017 | 35 | 5 | |
| 2014 | 35 | 5 | |
| 2011 | 35 | 5 | Caderno de Computação: FG + núcleo comum + específicas de CC (36–40). Q13 anulada |
| 2008 | 35 | 5 | Caderno de Computação: questões 1–40 (FG, núcleo comum e CC) |
| 2005 | 35 | 5 | Caderno de Computação: FG (1–10), núcleo comum CC/EC (41–55) e CC (56–70) |

Nas edições de 2005, 2008 e 2011 o caderno era único para toda a área de Computação. Por isso
ficaram **só as questões que faziam parte da prova de Ciência da Computação**; as exclusivas de
Engenharia de Computação, Sistemas de Informação e Licenciatura foram descartadas.

### Padrões de resposta das discursivas

| Edição | Origem |
|---|---|
| 2008 (20, 39, 40), 2011, 2014, 2017, 2021 | Padrão oficial do INEP, recortado do PDF |
| 2005 (8, 9, 10 – Formação Geral) | Padrão oficial do INEP (Formação Geral 2005), transcrito |
| 2005 (55, 70) e 2008 (9, 10) | **Não oficial**: resposta esperada escrita para este simulado e marcada como "Não oficial" no site |

> O arquivo `Simulado/2005_bacharelado_ciencia_computacao.pdf` da pasta original **não é de
> Computação**: é o padrão de resposta de **Ciências Sociais** 2005. Não foi usado. Se a
> coordenação conseguir o padrão oficial de Computação 2005 (e o de Formação Geral 2008), basta
> trocar os textos em `tools/provas_meta.json` e gerar os dados de novo.

## Estrutura

```
index.html            página inicial: login, cadastro, escolha da prova, histórico
simulado.html         resolução e correção da prova
professor.html        painel do professor
assets/js/config.js   URL e chave pública do Supabase  ← editar na publicação
assets/js/app.js      funções compartilhadas (login, dados, componentes)
assets/js/inicio.js | simulado.js | professor.js
assets/css/style.css
data/provas.json      questões (sem gabarito), seções e padrões de resposta
data/img/<ano>/       recortes das questões (WebP) e padrao/ com os padrões de resposta
supabase/schema.sql   tabelas, RLS, gatilhos e funções
supabase/seed_gabarito.sql   gabaritos oficiais (gerado)
tools/build_questions.py     gera data/ e o seed a partir dos PDFs
tools/provas_meta.json       observações e padrões de resposta em texto
tests/                testes do banco (PostgreSQL embutido) e do site (Playwright)
docs/PUBLICACAO.md    passo a passo de publicação
```

## Segurança

- O **gabarito não está no site público**. Ele fica na tabela `gabarito` do Supabase, e o aluno
  só consegue ler o gabarito de uma edição depois de finalizar uma tentativa dela.
- A correção (`correta`) é feita por um **gatilho no banco**, e a nota final é calculada pela
  função `finalizar_tentativa`. O navegador não consegue alterar acertos, notas nem o próprio papel.
- Depois de finalizada, a tentativa não aceita mais mudanças de resposta.
- Cada aluno só vê os próprios dados. Professores (lista `professores_autorizados`) veem tudo.
- A chave usada no site é a chave **pública** (anon/publishable). A chave `service_role` nunca
  deve ser colocada no repositório.
- Os padrões de resposta são imagens públicas do site, já que são documentos oficiais do INEP.
  Um aluno curioso pode abri-los antes de terminar, sem prejuízo para a nota das objetivas.

## Gerar os dados novamente a partir dos PDFs

```bash
pip install pymupdf pillow
python tools/build_questions.py --pdfs "../Simulado"
```

O script localiza as questões, recorta cada uma respeitando as duas colunas e as quebras de
página e corta os quadros de rascunho. Também lê o gabarito e recorta os padrões de resposta.
Depois de rodar, execute de novo `supabase/seed_gabarito.sql` no Supabase.

## Testes

```bash
pip install pgserver psycopg2-binary playwright
python tests/test_schema.py        # 34 verificações de RLS/permissões num PostgreSQL embutido
python tests/e2e/run_e2e.py        # fluxo completo no Microsoft Edge com um Supabase simulado
```

## Rodar localmente

```bash
python -m http.server 8000
# abra http://localhost:8000  (inclua http://localhost:8000/** nas Redirect URLs do Supabase)
```

## Créditos

Questões, gabaritos e padrões de resposta: **INEP/MEC**, provas do ENADE (documentos públicos).
Uso educacional, sem fins lucrativos.
