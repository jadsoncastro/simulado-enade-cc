import {
  sb, el, toast, pct, dataHora, MODOS, carregarProvas, questoesDaTentativa, ehAleatoria, nomeProva,
  imagemQuestao, blocoPadrao,
  buscarTudo, baixarCSV, modal, exigirLogin, montarCabecalho,
} from "./app.js";

const main = document.getElementById("conteudo");
const D = { perfis: [], tentativas: [], respostas: [], gabarito: new Map(), provas: [], questoes: new Map() };
let abaAtual = "resumo";

async function iniciar() {
  const u = await exigirLogin({ professor: true });
  if (!u) return;
  montarCabecalho(u.perfil);
  await carregar();
  render();
}

async function carregar() {
  main.replaceChildren(el("p", { class: "suave" }, "Carregando dados…"));
  const [provas, perfis, tentativas, respostas, gab] = await Promise.all([
    carregarProvas(),
    buscarTudo(() => sb.from("perfis").select("*").order("nome")),
    buscarTudo(() => sb.from("tentativas").select("*").order("iniciada_em", { ascending: false })),
    buscarTudo(() => sb.from("respostas")
      .select("id,tentativa_id,aluno_id,questao_id,tipo,alternativa,correta,autoavaliacao,nota_professor,atualizada_em")
      .order("id")),
    buscarTudo(() => sb.from("gabarito").select("*")),
  ]);
  Object.assign(D, { provas, perfis, tentativas, respostas });
  D.gabarito = new Map(gab.map((g) => [g.questao_id, g.resposta]));
  D.questoes = new Map(provas.flatMap((p) => p.questoes.map((q) => [q.id, q])));
  D.perfilPorId = new Map(perfis.map((p) => [p.id, p]));
  D.respPorTentativa = new Map();
  for (const r of respostas) {
    if (!D.respPorTentativa.has(r.tentativa_id)) D.respPorTentativa.set(r.tentativa_id, []);
    D.respPorTentativa.get(r.tentativa_id).push(r);
  }
}

const finalizadas = () => D.tentativas.filter((t) => t.finalizada_em);
const nomeAluno = (id) => { const p = D.perfilPorId.get(id); return p ? p.nome || p.github : "—"; };

const ABAS = {
  resumo: ["Resumo", renderResumo],
  alunos: ["Alunos", renderAlunos],
  tentativas: ["Tentativas", renderTentativas],
  discursivas: ["Discursivas", renderDiscursivas],
  questoes: ["Questões", renderQuestoes],
  professores: ["Professores", renderProfessores],
};

function render() {
  const corpo = el("div");
  main.replaceChildren(
    el("div", { class: "linha" }, el("h1", { style: "margin:0" }, "Painel do professor"), el("span", { class: "espaco" }),
      el("button", { class: "btn btn-sec btn-peq", onclick: async () => { await carregar(); render(); } }, "↻ Atualizar dados")),
    el("nav", { class: "abas", style: "margin-top:1rem" }, Object.entries(ABAS).map(([k, [nome]]) =>
      el("button", { class: "aba" + (k === abaAtual ? " ativa" : ""), onclick: () => { abaAtual = k; render(); } }, nome))),
    corpo);
  ABAS[abaAtual][1](corpo);
}

function tabela(cabecalhos, linhas, numericas = []) {
  return el("div", { class: "tabela-rolagem" }, el("table", {},
    el("thead", {}, el("tr", {}, cabecalhos.map((h, i) => el("th", { class: numericas.includes(i) ? "num" : null }, h)))),
    el("tbody", {}, linhas)));
}

function selectAno(incluirTodos = true, valor = "") {
  return el("select", {},
    incluirTodos ? el("option", { value: "" }, "Todas as edições") : null,
    incluirTodos ? el("option", { value: "aleatorio" }, "Simulado aleatório") : null,
    [...D.provas].sort((a, b) => b.ano - a.ano).map((p) =>
      el("option", { value: p.ano, selected: String(p.ano) === String(valor) }, `ENADE ${p.ano}`)));
}

// Filtro de edição aplicado a uma tentativa ("" = todas, "aleatorio" = simulados aleatórios)
const tentativaNoFiltro = (t, valor) =>
  !valor || (valor === "aleatorio" ? ehAleatoria(t) : t.ano === Number(valor));

// ---------------------------------------------------------------------------
// Resumo
// ---------------------------------------------------------------------------
function renderResumo(corpo) {
  const alunos = D.perfis.filter((p) => p.papel === "aluno");
  const fin = finalizadas();
  const comSimulado = new Set(fin.map((t) => t.aluno_id));
  const media = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  const grupos = [
    { nome: "Simulado aleatório", ts: fin.filter(ehAleatoria) },
    ...[...D.provas].sort((a, b) => b.ano - a.ano).map((p) => ({ nome: `ENADE ${p.ano}`, ts: fin.filter((t) => t.ano === p.ano) })),
  ];
  const porAno = grupos.map(({ nome, ts }) => {
    const comp = (c) => {
      const vals = ts.map((t) => {
        const qs = questoesDaTentativa(D.provas, t).filter((q) => q.tipo === "objetiva" && !q.anulada && q.componente === c);
        if (!qs.length) return null;
        const rs = D.respPorTentativa.get(t.id) || [];
        return (100 * rs.filter((r) => r.correta && qs.some((q) => q.id === r.questao_id)).length) / qs.length;
      }).filter((v) => v !== null);
      return media(vals);
    };
    return el("tr", {},
      el("td", {}, nome),
      el("td", { class: "num" }, ts.length),
      el("td", { class: "num" }, new Set(ts.map((t) => t.aluno_id)).size),
      el("td", { class: "num" }, pct(media(ts.map((t) => Number(t.percentual))))),
      el("td", { class: "num" }, pct(comp("FG"))),
      el("td", { class: "num" }, pct(comp("CE"))));
  });

  corpo.append(
    el("div", { class: "resumo-kpis" },
      el("div", { class: "kpi" }, el("strong", {}, alunos.length), "alunos cadastrados"),
      el("div", { class: "kpi" }, el("strong", {}, comSimulado.size), "alunos com simulado finalizado"),
      el("div", { class: "kpi" }, el("strong", {}, fin.length), "tentativas finalizadas"),
      el("div", { class: "kpi" }, el("strong", {}, D.tentativas.length - fin.length), "em andamento"),
      el("div", { class: "kpi" }, el("strong", {}, pct(media(fin.map((t) => Number(t.percentual))))), "aproveitamento médio")),
    el("div", { class: "cartao" }, el("h2", {}, "Desempenho por edição"),
      tabela(["Edição", "Tentativas", "Alunos", "Média geral", "Formação Geral", "Específico"], porAno, [1, 2, 3, 4, 5]),
      el("p", { class: "suave" }, "Médias calculadas sobre as tentativas finalizadas, desconsiderando as questões anuladas.")),
    el("div", { class: "cartao" }, el("h2", {}, "Alunos cadastrados sem nenhum simulado finalizado"),
      (() => {
        const sem = alunos.filter((a) => !comSimulado.has(a.id));
        return sem.length
          ? tabela(["Nome", "Matrícula", "GitHub"], sem.map((a) =>
              el("tr", {}, el("td", {}, a.nome || "—"), el("td", {}, a.matricula || "—"), el("td", {}, a.github || "—"))))
          : el("p", { class: "suave" }, "Todos os alunos cadastrados já finalizaram ao menos um simulado.");
      })()));
}

// ---------------------------------------------------------------------------
// Alunos
// ---------------------------------------------------------------------------
function renderAlunos(corpo) {
  const busca = el("input", { type: "text", placeholder: "Buscar por nome, matrícula ou GitHub" });
  const lista = el("div");
  const desenhar = () => {
    const termo = busca.value.trim().toLowerCase();
    const alunos = D.perfis.filter((p) => p.papel === "aluno" &&
      [p.nome, p.matricula, p.github, p.email].some((v) => (v || "").toLowerCase().includes(termo)));
    const linhas = alunos.map((a) => {
      const ts = D.tentativas.filter((t) => t.aluno_id === a.id);
      const fin = ts.filter((t) => t.finalizada_em);
      const melhor = fin.length ? Math.max(...fin.map((t) => Number(t.percentual))) : null;
      const ultima = ts[0]?.iniciada_em;
      return el("tr", { class: "clicavel", onclick: () => detalheAluno(a) },
        el("td", {}, a.nome || "—"), el("td", {}, a.matricula || "—"), el("td", {}, a.github || "—"),
        el("td", { class: "num" }, fin.length), el("td", { class: "num" }, ts.length - fin.length),
        el("td", { class: "num" }, pct(melhor)), el("td", {}, dataHora(ultima)));
    });
    lista.replaceChildren(tabela(["Nome", "Matrícula", "GitHub", "Finalizadas", "Em andamento", "Melhor %", "Última atividade"], linhas, [3, 4, 5]));
  };
  busca.addEventListener("input", desenhar);
  desenhar();
  corpo.append(el("div", { class: "cartao" },
    el("div", { class: "filtros" }, el("div", { style: "flex:1" }, busca),
      el("button", { class: "btn btn-sec", onclick: exportarAlunos }, "Exportar CSV")), lista));
}

function exportarAlunos() {
  const linhas = [["Nome", "Matrícula", "GitHub", "E-mail", "Edição", "Modo", "Início", "Fim", "Acertos", "Total", "%"]];
  for (const a of D.perfis.filter((p) => p.papel === "aluno")) {
    const ts = finalizadas().filter((t) => t.aluno_id === a.id);
    if (!ts.length) linhas.push([a.nome, a.matricula, a.github, a.email, "", "", "", "", "", "", ""]);
    for (const t of ts) linhas.push([a.nome, a.matricula, a.github, a.email, nomeProva(t), MODOS[t.modo].nome,
      dataHora(t.iniciada_em), dataHora(t.finalizada_em), t.acertos, t.total_objetivas, String(t.percentual).replace(".", ",")]);
  }
  baixarCSV(`alunos_simulado_enade_${new Date().toISOString().slice(0, 10)}.csv`, linhas);
}

function detalheAluno(a) {
  const ts = D.tentativas.filter((t) => t.aluno_id === a.id);
  modal(`${a.nome || a.github} ${a.matricula ? "· " + a.matricula : ""}`, el("div", {},
    el("p", { class: "suave" }, `GitHub: ${a.github || "—"} · e-mail: ${a.email || "—"} · cadastro em ${dataHora(a.criado_em)}`),
    ts.length ? tabela(["Edição", "Modo", "Início", "Situação", "Acertos", "%", ""], ts.map((t) =>
      el("tr", {}, el("td", {}, nomeProva(t)), el("td", {}, MODOS[t.modo].nome), el("td", {}, dataHora(t.iniciada_em)),
        el("td", {}, t.finalizada_em ? "Finalizada" : "Em andamento"),
        el("td", { class: "num" }, t.finalizada_em ? `${t.acertos}/${t.total_objetivas}` : "—"),
        el("td", { class: "num" }, pct(t.percentual)),
        el("td", {}, el("button", { class: "btn btn-sec btn-peq", onclick: () => detalheTentativa(t) }, "Ver respostas")))), [4, 5])
      : el("p", {}, "Nenhuma tentativa.")), { largo: true });
}

// ---------------------------------------------------------------------------
// Tentativas
// ---------------------------------------------------------------------------
function renderTentativas(corpo) {
  const ano = selectAno();
  const situ = el("select", {}, el("option", { value: "" }, "Todas"), el("option", { value: "f" }, "Finalizadas"),
    el("option", { value: "a" }, "Em andamento"));
  const lista = el("div");
  const desenhar = () => {
    const ts = D.tentativas.filter((t) => tentativaNoFiltro(t, ano.value) &&
      (!situ.value || (situ.value === "f") === !!t.finalizada_em));
    lista.replaceChildren(ts.length ? tabela(["Aluno", "Edição", "Modo", "Início", "Fim", "Respondidas", "Acertos", "%", ""],
      ts.map((t) => {
        const n = (D.respPorTentativa.get(t.id) || []).filter((r) => r.alternativa || r.tipo === "discursiva").length;
        return el("tr", {},
          el("td", {}, nomeAluno(t.aluno_id)), el("td", {}, nomeProva(t)), el("td", {}, MODOS[t.modo].nome),
          el("td", {}, dataHora(t.iniciada_em)), el("td", {}, dataHora(t.finalizada_em)),
          el("td", { class: "num" }, n),
          el("td", { class: "num" }, t.finalizada_em ? `${t.acertos}/${t.total_objetivas}` : "—"),
          el("td", { class: "num" }, pct(t.percentual)),
          el("td", {}, el("div", { class: "linha" },
            el("button", { class: "btn btn-sec btn-peq", onclick: () => detalheTentativa(t) }, "Ver"),
            el("button", { class: "btn btn-perigo btn-peq", onclick: () => excluirTentativa(t) }, "Excluir"))));
      }), [5, 6, 7]) : el("p", { class: "suave" }, "Nenhuma tentativa com esses filtros."));
  };
  ano.addEventListener("change", desenhar);
  situ.addEventListener("change", desenhar);
  desenhar();
  corpo.append(el("div", { class: "cartao" },
    el("div", { class: "filtros" }, el("div", {}, el("label", {}, "Edição"), ano), el("div", {}, el("label", {}, "Situação"), situ)),
    lista));
}

async function excluirTentativa(t) {
  if (!confirm(`Excluir a tentativa de ${nomeAluno(t.aluno_id)} (${nomeProva(t)})? As respostas serão apagadas.`)) return;
  const { error } = await sb.from("tentativas").delete().eq("id", t.id);
  if (error) return toast(error.message, "erro");
  toast("Tentativa excluída.", "ok");
  await carregar();
  render();
}

async function detalheTentativa(t) {
  const { data: rs, error } = await sb.from("respostas").select("*").eq("tentativa_id", t.id);
  if (error) return toast(error.message, "erro");
  const porQ = new Map(rs.map((r) => [r.questao_id, r]));
  const linhas = questoesDaTentativa(D.provas, t).map((q) => {
    const r = porQ.get(q.id);
    const gab = D.gabarito.get(q.id);
    let res = "—";
    if (q.tipo === "objetiva") {
      res = q.anulada ? el("span", { class: "selo alerta" }, "anulada")
        : r?.correta ? el("span", { class: "selo ok" }, "acerto")
        : r?.alternativa ? el("span", { class: "selo erro" }, "erro") : el("span", { class: "selo" }, "em branco");
    } else {
      res = [r?.autoavaliacao != null ? `auto ${r.autoavaliacao}` : null, r?.nota_professor != null ? `prof. ${r.nota_professor}` : null]
        .filter(Boolean).join(" · ") || "—";
    }
    return el("tr", {},
      el("td", {}, el("a", { href: "#", onclick: (e) => { e.preventDefault(); verQuestao(q); } }, q.rotulo)),
      el("td", {}, q.componente),
      el("td", {}, q.tipo === "objetiva" ? r?.alternativa || "—"
        : r?.texto ? el("div", { style: "white-space:pre-wrap;max-width:520px" }, r.texto) : "—"),
      el("td", {}, q.tipo === "objetiva" ? gab || "—" : ""),
      el("td", {}, res));
  });
  modal(`${nomeAluno(t.aluno_id)} · ${nomeProva(t)} · ${MODOS[t.modo].nome}`, el("div", {},
    el("p", { class: "suave" }, `Início ${dataHora(t.iniciada_em)} · fim ${dataHora(t.finalizada_em)} · ` +
      (t.finalizada_em ? `${t.acertos}/${t.total_objetivas} (${pct(t.percentual)})` : "em andamento")),
    tabela(["Questão", "Parte", "Resposta", "Gabarito", "Resultado"], linhas)), { largo: true });
}

function verQuestao(q) {
  q = D.questoes.get(q.id) || q; // no simulado aleatório, mostra a numeração original
  modal(`ENADE ${q.ano} · ${q.rotulo}`, el("div", {},
    el("p", {}, el("span", { class: "selo" }, q.secao), " ",
      q.tipo === "objetiva" ? `Gabarito: ${D.gabarito.get(q.id) || "—"}` : ""),
    el("div", { class: "area-imagem" }, imagemQuestao(q.img, q.largura, q.rotulo)),
    q.tipo === "discursiva" ? blocoPadrao(q) : null), { largo: true });
}

// ---------------------------------------------------------------------------
// Discursivas
// ---------------------------------------------------------------------------
async function renderDiscursivas(corpo) {
  const ano = selectAno();
  const filtro = el("select", {}, el("option", { value: "pend" }, "Sem nota do professor"), el("option", { value: "" }, "Todas"));
  const lista = el("div", { style: "display:grid;gap:1rem" }, el("p", { class: "suave" }, "Carregando respostas…"));
  corpo.append(el("div", { class: "cartao" },
    el("div", { class: "filtros" }, el("div", {}, el("label", {}, "Edição"), ano), el("div", {}, el("label", {}, "Mostrar"), filtro)),
    el("p", { class: "suave" }, "Respostas discursivas de tentativas finalizadas. A nota do professor fica visível para o aluno na correção.")),
    lista);

  const fin = new Map(finalizadas().map((t) => [t.id, t]));
  let itens;
  try {
    itens = (await buscarTudo(() => sb.from("respostas").select("*").eq("tipo", "discursiva").not("texto", "is", null).order("id")))
      .filter((r) => fin.has(r.tentativa_id) && r.texto.trim());
  } catch (e) { return toast(e.message, "erro"); }

  const desenhar = () => {
    const sel = itens.filter((r) => tentativaNoFiltro(fin.get(r.tentativa_id), ano.value) &&
      (!filtro.value || r.nota_professor === null));
    if (!sel.length) return lista.replaceChildren(el("p", { class: "suave" }, "Nenhuma resposta com esses filtros."));
    lista.replaceChildren(...sel.slice(0, 60).map(cartaoDiscursiva), sel.length > 60
      ? el("p", { class: "suave" }, `Mostrando 60 de ${sel.length}. Avalie estas e use "Atualizar dados" para ver as próximas.`) : "");
  };
  ano.addEventListener("change", desenhar);
  filtro.addEventListener("change", desenhar);
  desenhar();
}

function cartaoDiscursiva(r) {
  const q = D.questoes.get(r.questao_id);
  const nota = el("input", { type: "number", min: 0, max: 10, step: 0.5, value: r.nota_professor ?? "" });
  const coment = el("textarea", { style: "min-height:70px", placeholder: "Comentário para o aluno (opcional)" });
  coment.value = r.comentario_professor || "";
  const btn = el("button", { class: "btn btn-peq" }, "Salvar avaliação");
  btn.addEventListener("click", async () => {
    const v = nota.value === "" ? null : Number(nota.value);
    if (v !== null && (v < 0 || v > 10)) return toast("A nota deve estar entre 0 e 10.", "erro");
    const { error } = await sb.rpc("avaliar_discursiva", { p_resposta: r.id, p_nota: v, p_comentario: coment.value || null });
    if (error) return toast(error.message, "erro");
    r.nota_professor = v;
    r.comentario_professor = coment.value;
    toast("Avaliação salva.", "ok");
  });
  return el("div", { class: "cartao disc-item" },
    el("div", { class: "linha" }, el("strong", {}, nomeAluno(r.aluno_id)), el("span", { class: "selo" }, `ENADE ${q?.ano} · ${q?.rotulo}`),
      r.autoavaliacao != null ? el("span", { class: "selo alerta" }, `autoavaliação ${String(r.autoavaliacao).replace(".", ",")}`) : null,
      el("span", { class: "espaco" }),
      el("button", { class: "btn btn-sec btn-peq", onclick: () => verQuestao(q) }, "Enunciado e padrão")),
    el("div", { class: "resposta-aluno" }, r.texto),
    el("div", { class: "nota" }, el("label", { style: "margin:0" }, "Nota (0–10)"), nota, btn),
    coment);
}

// ---------------------------------------------------------------------------
// Questões (índice de acerto)
// ---------------------------------------------------------------------------
function renderQuestoes(corpo) {
  const anos = [...D.provas].sort((a, b) => b.ano - a.ano);
  const ano = selectAno(false, anos[0]?.ano);
  const ordem = el("select", {}, el("option", { value: "num" }, "Ordem da prova"), el("option", { value: "pct" }, "Menor acerto primeiro"));
  const lista = el("div");
  const fin = new Set(finalizadas().map((t) => t.id));
  const desenhar = () => {
    const prova = D.provas.find((p) => p.ano === Number(ano.value));
    let linhas = prova.questoes.filter((q) => q.tipo === "objetiva").map((q) => {
      const rs = D.respostas.filter((r) => r.questao_id === q.id && fin.has(r.tentativa_id));
      const resp = rs.filter((r) => r.alternativa);
      const ac = resp.filter((r) => r.correta).length;
      const dist = Object.fromEntries(["A", "B", "C", "D", "E"].map((L) => [L, resp.filter((r) => r.alternativa === L).length]));
      return { q, n: resp.length, ac, p: resp.length ? (100 * ac) / resp.length : null, dist };
    });
    if (ordem.value === "pct") linhas.sort((a, b) => (a.p ?? 101) - (b.p ?? 101));
    const gabOf = (q) => D.gabarito.get(q.id);
    lista.replaceChildren(tabela(["Questão", "Parte", "Gabarito", "Respostas", "Acerto", "", "Distribuição"],
      linhas.map(({ q, n, p, dist }) => el("tr", { class: "clicavel", onclick: () => verQuestao(q) },
        el("td", {}, q.rotulo), el("td", {}, q.secao), el("td", {}, gabOf(q) || "—"),
        el("td", { class: "num" }, n), el("td", { class: "num" }, pct(p)),
        el("td", {}, el("div", { class: "barra" }, el("span", { style: `width:${p ?? 0}%` }))),
        el("td", {}, el("div", { class: "dist" }, Object.entries(dist).map(([L, v]) =>
          el("span", { class: L === gabOf(q) ? "gab" : "" }, `${L}:${v}`)))))), [3, 4]));
  };
  ano.addEventListener("change", desenhar);
  ordem.addEventListener("change", desenhar);
  desenhar();
  corpo.append(el("div", { class: "cartao" },
    el("div", { class: "filtros" }, el("div", {}, el("label", {}, "Edição"), ano), el("div", {}, el("label", {}, "Ordenar"), ordem)),
    el("p", { class: "suave" }, "Percentual de acerto entre os alunos que responderam a questão (tentativas finalizadas). Clique para ver o enunciado."),
    lista));
}

// ---------------------------------------------------------------------------
// Professores
// ---------------------------------------------------------------------------
async function renderProfessores(corpo) {
  const { data, error } = await sb.from("professores_autorizados").select("*").order("github");
  if (error) return toast(error.message, "erro");
  const entrada = el("input", { type: "text", placeholder: "usuário do GitHub (ex.: maria-silva)" });
  const form = el("form", { class: "filtros" }, el("div", { style: "flex:1" }, el("label", {}, "Incluir professor"), entrada),
    el("button", { class: "btn", type: "submit" }, "Incluir"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const g = entrada.value.trim().replace(/^@/, "");
    if (!g) return;
    const { error } = await sb.from("professores_autorizados").insert({ github: g });
    if (error) return toast(error.message, "erro");
    toast(`${g} agora é professor.`, "ok");
    await carregar();
    render();
  });
  corpo.append(el("div", { class: "cartao" },
    el("p", { class: "suave" }, "Usuários do GitHub nesta lista entram com perfil de professor. A alteração vale imediatamente, inclusive para quem já fez login."),
    form,
    tabela(["Usuário do GitHub", "Incluído em", "Cadastrado no site?", ""], data.map((p) => {
      const perfil = D.perfis.find((x) => (x.github || "").toLowerCase() === p.github.toLowerCase());
      return el("tr", {}, el("td", {}, p.github), el("td", {}, dataHora(p.incluido_em)),
        el("td", {}, perfil ? perfil.nome || "sim" : el("span", { class: "suave" }, "ainda não fez login")),
        el("td", {}, el("button", { class: "btn btn-perigo btn-peq", onclick: async () => {
          if (!confirm(`Remover ${p.github} da lista de professores?`)) return;
          const { error } = await sb.from("professores_autorizados").delete().eq("github", p.github);
          if (error) return toast(error.message, "erro");
          await carregar();
          render();
        } }, "Remover")));
    }))));
}

iniciar().catch((e) => { console.error(e); toast("Erro inesperado: " + e.message, "erro"); });
