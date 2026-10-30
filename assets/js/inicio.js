import {
  sb, configurado, el, toast, dataHora, pct, duracao, MODOS, carregarProvas, questoesDoModo,
  sortearQuestoes, contagemAleatoria, ehAleatoria, nomeProva, entrarComGitHub, usuarioAtual, montarCabecalho,
} from "./app.js";

const main = document.getElementById("conteudo");
const ICONE_GITHUB =
  '<svg class="icone-github" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';

async function iniciar() {
  if (!configurado) {
    montarCabecalho(null);
    main.replaceChildren(
      el("div", { class: "cartao aviso" },
        el("h2", {}, "Configuração pendente"),
        el("p", {}, "Preencha SUPABASE_URL e SUPABASE_ANON_KEY em ", el("code", {}, "assets/js/config.js"),
          ". Veja o passo a passo em ", el("code", {}, "docs/PUBLICACAO.md"), "."))
    );
    return;
  }
  const { sessao, perfil } = await usuarioAtual();
  montarCabecalho(perfil);
  if (!sessao) return telaLogin();
  if (!perfil) {
    main.replaceChildren(el("div", { class: "cartao aviso" }, el("h2", {}, "Perfil não encontrado"),
      el("p", {}, "O login funcionou, mas o perfil não foi criado. Verifique se o arquivo supabase/schema.sql foi executado.")));
    return;
  }
  if (!perfil.nome || (perfil.papel === "aluno" && !perfil.matricula)) return telaCadastro(perfil);
  telaPrincipal(perfil);
}

function telaLogin() {
  const btn = el("button", { class: "btn btn-grande", html: `${ICONE_GITHUB} Entrar com GitHub` });
  btn.addEventListener("click", entrarComGitHub);
  main.replaceChildren(
    el("section", { class: "heroi" },
      el("h1", {}, "Simulado ENADE · Ciência da Computação"),
      el("p", {}, "Resolva as provas oficiais do ENADE de Bacharelado em Ciência da Computação (2005 a 2021). " +
        "As objetivas são corrigidas na hora. Nas discursivas, você compara sua resposta com o padrão de resposta do INEP."),
      btn,
      el("p", { class: "suave", style: "margin-top:1rem;font-size:.9rem" },
        "Não tem conta no GitHub? Crie uma gratuitamente em github.com e volte aqui."))
  );
}

function telaCadastro(perfil) {
  const nome = el("input", { type: "text", id: "nome", value: perfil.nome || "", required: true, maxlength: 120 });
  const matricula = el("input", { type: "text", id: "matricula", value: perfil.matricula || "", maxlength: 20,
    placeholder: "ex.: 21.1.4001" });
  const form = el("form", { class: "cartao", style: "max-width:520px;margin:2rem auto" },
    el("h2", {}, "Complete seu cadastro"),
    el("p", { class: "suave" }, "Estes dados aparecem apenas para os professores do curso."),
    el("div", { class: "campo" }, el("label", { for: "nome" }, "Nome completo"), nome),
    el("div", { class: "campo" }, el("label", { for: "matricula" }, "Matrícula"), matricula),
    el("div", { class: "linha fim" }, el("button", { class: "btn", type: "submit" }, "Salvar e continuar")));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!nome.value.trim()) return toast("Informe o nome.", "erro");
    if (perfil.papel === "aluno" && !matricula.value.trim()) return toast("Informe a matrícula.", "erro");
    const { error } = await sb.from("perfis")
      .update({ nome: nome.value.trim(), matricula: matricula.value.trim() || null }).eq("id", perfil.id);
    if (error) return toast("Erro ao salvar: " + error.message, "erro");
    location.reload();
  });
  main.replaceChildren(form);
}

async function telaPrincipal(perfil) {
  const [provas, { data: tentativas, error }] = await Promise.all([
    carregarProvas(),
    sb.from("tentativas").select("*").eq("aluno_id", perfil.id).order("iniciada_em", { ascending: false }),
  ]);
  if (error) toast("Erro ao carregar suas tentativas: " + error.message, "erro");
  const abertas = new Map((tentativas || []).filter((t) => !t.finalizada_em)
    .map((t) => [`${ehAleatoria(t) ? "aleatorio" : t.ano}-${t.modo}`, t]));

  const cartoes = [...provas].sort((a, b) => b.ano - a.ano).map((p) => {
    const sel = el("select", { "aria-label": "Modo" },
      Object.entries(MODOS).map(([k, m]) => el("option", { value: k }, m.nome)));
    const btn = el("button", { class: "btn" }, "Iniciar");
    const atualizarBotao = () => {
      const aberta = abertas.get(`${p.ano}-${sel.value}`);
      btn.textContent = aberta ? "Continuar" : "Iniciar";
      const qs = questoesDoModo(p, sel.value);
      info.textContent = `${qs.filter((q) => q.tipo === "objetiva").length} objetivas · ` +
        `${qs.filter((q) => q.tipo === "discursiva").length} discursivas · tempo sugerido ${duracao(MODOS[sel.value].minutos)}`;
    };
    const info = el("small");
    sel.addEventListener("change", atualizarBotao);
    btn.addEventListener("click", async () => {
      const aberta = abertas.get(`${p.ano}-${sel.value}`);
      if (aberta) return (location.href = `simulado.html?t=${aberta.id}`);
      btn.disabled = true;
      const { data, error } = await sb.from("tentativas").insert({ ano: p.ano, modo: sel.value }).select().single();
      if (error) { btn.disabled = false; return toast("Não foi possível iniciar: " + error.message, "erro"); }
      location.href = `simulado.html?t=${data.id}`;
    });
    atualizarBotao();
    return el("div", { class: "cartao prova" },
      el("h3", {}, `ENADE ${p.ano}`),
      el("div", { class: "numeros" },
        el("span", { class: "selo" }, `${p.total_objetivas} objetivas`),
        el("span", { class: "selo" }, `${p.total_discursivas} discursivas`)),
      el("p", { class: "obs" }, p.observacao),
      sel, el("div", { class: "linha" }, btn, el("span", { class: "espaco" })), info);
  });

  main.replaceChildren(
    el("section", { class: "secao" },
      el("h1", {}, `Olá, ${(perfil.nome || "").split(" ")[0]}!`),
      el("p", { class: "suave" }, "Faça um simulado aleatório ou escolha uma edição do ENADE. Suas respostas são salvas automaticamente: você pode parar e continuar depois.")),
    el("section", { class: "secao grade" }, cartaoAleatorio(provas, abertas), cartoes),
    el("section", { class: "secao cartao" }, el("h2", {}, "Minhas tentativas"), tabelaTentativas(tentativas || []))
  );
}

// Cada aluno recebe questões sorteadas das edições, na estrutura da prova do ENADE
function cartaoAleatorio(provas, abertas) {
  const sel = el("select", { "aria-label": "Modo" },
    Object.entries(MODOS).map(([k, m]) => el("option", { value: k }, m.nome)));
  const btn = el("button", { class: "btn" }, "Gerar simulado");
  const info = el("small");
  const atualizarBotao = () => {
    btn.textContent = abertas.get(`aleatorio-${sel.value}`) ? "Continuar" : "Gerar simulado";
    const n = contagemAleatoria(sel.value);
    info.textContent = `${n.objetivas} objetivas · ${n.discursivas} discursivas · tempo sugerido ${duracao(MODOS[sel.value].minutos)}`;
  };
  sel.addEventListener("change", atualizarBotao);
  btn.addEventListener("click", async () => {
    const aberta = abertas.get(`aleatorio-${sel.value}`);
    if (aberta) return (location.href = `simulado.html?t=${aberta.id}`);
    btn.disabled = true;
    const { data, error } = await sb.from("tentativas")
      .insert({ ano: null, modo: sel.value, questoes: sortearQuestoes(provas, sel.value) }).select().single();
    if (error) { btn.disabled = false; return toast("Não foi possível gerar o simulado: " + error.message, "erro"); }
    location.href = `simulado.html?t=${data.id}`;
  });
  atualizarBotao();
  const anos = provas.map((p) => p.ano).sort();
  return el("div", { class: "cartao prova" },
    el("h3", {}, "Simulado aleatório"),
    el("div", { class: "numeros" }, el("span", { class: "selo ok" }, "Novo a cada tentativa")),
    el("p", { class: "obs" }, `Questões sorteadas das edições de ${anos[0]} a ${anos[anos.length - 1]}, ` +
      "na mesma estrutura da prova do ENADE. Cada aluno recebe um simulado diferente. Questões anuladas ficam de fora."),
    sel, el("div", { class: "linha" }, btn, el("span", { class: "espaco" })), info);
}

function tabelaTentativas(tentativas) {
  if (!tentativas.length) return el("p", { class: "suave" }, "Você ainda não iniciou nenhum simulado.");
  const linhas = tentativas.map((t) => {
    const acoes = el("div", { class: "linha" },
      el("a", { class: "btn btn-peq " + (t.finalizada_em ? "btn-sec" : ""), href: `simulado.html?t=${t.id}` },
        t.finalizada_em ? "Ver correção" : "Continuar"));
    if (!t.finalizada_em) {
      acoes.append(el("button", { class: "btn btn-peq btn-perigo", onclick: async () => {
        if (!confirm("Descartar esta tentativa e todas as respostas dela?")) return;
        const { error } = await sb.from("tentativas").delete().eq("id", t.id);
        if (error) return toast(error.message, "erro");
        location.reload();
      } }, "Descartar"));
    }
    return el("tr", {},
      el("td", {}, nomeProva(t)),
      el("td", {}, MODOS[t.modo]?.nome || t.modo),
      el("td", {}, dataHora(t.iniciada_em)),
      el("td", {}, t.finalizada_em ? el("span", { class: "selo ok" }, "Finalizada") : el("span", { class: "selo alerta" }, "Em andamento")),
      el("td", { class: "num" }, t.finalizada_em ? `${t.acertos}/${t.total_objetivas}` : "—"),
      el("td", { class: "num" }, t.finalizada_em ? pct(t.percentual) : "—"),
      el("td", {}, acoes));
  });
  return el("div", { class: "tabela-rolagem" }, el("table", {},
    el("thead", {}, el("tr", {}, ["Prova", "Modo", "Início", "Situação", "Acertos", "%", ""].map((h, i) =>
      el("th", { class: i === 4 || i === 5 ? "num" : null }, h)))),
    el("tbody", {}, linhas)));
}

iniciar().catch((e) => { console.error(e); toast("Erro inesperado: " + e.message, "erro"); });
