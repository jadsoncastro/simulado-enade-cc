import {
  sb, el, toast, pct, dataHora, MODOS, carregarProvas, questoesDaTentativa, ehAleatoria, nomeProva,
  imagemQuestao, blocoPadrao, exigirLogin, montarCabecalho,
} from "./app.js";

const main = document.getElementById("conteudo");
const LETRAS = ["A", "B", "C", "D", "E"];

const estado = {
  tentativa: null,
  questoes: [],
  respostas: new Map(), // questao_id -> linha de respostas
  gabarito: new Map(),  // questao_id -> letra (só após finalizar)
  atual: 0,             // índice da questão; -1 = resumo
  ampliada: false,
  marcadas: new Set(),
};

const finalizada = () => !!estado.tentativa?.finalizada_em;
const chaveMarcadas = () => `marcadas:${estado.tentativa.id}`;

async function iniciar() {
  const u = await exigirLogin();
  if (!u) return;
  montarCabecalho(u.perfil);

  const id = new URLSearchParams(location.search).get("t");
  const { data: t, error } = await sb.from("tentativas").select("*").eq("id", id).maybeSingle();
  if (error || !t) {
    main.replaceChildren(el("div", { class: "cartao aviso" }, el("h2", {}, "Simulado não encontrado"),
      el("a", { class: "btn", href: "index.html" }, "Voltar")));
    return;
  }
  estado.tentativa = t;
  estado.questoes = questoesDaTentativa(await carregarProvas(), t);
  estado.marcadas = new Set(JSON.parse(localStorage.getItem(chaveMarcadas()) || "[]"));

  const { data: resp } = await sb.from("respostas").select("*").eq("tentativa_id", t.id);
  for (const r of resp || []) estado.respostas.set(r.questao_id, r);

  if (finalizada()) {
    await carregarGabarito();
    estado.atual = -1;
  } else {
    const salvo = Number(sessionStorage.getItem(`atual:${t.id}`));
    estado.atual = Number.isInteger(salvo) && salvo < estado.questoes.length ? salvo : 0;
  }
  document.title = `${nomeProva(t)} – Simulado`;
  render();
  if (!finalizada()) setInterval(atualizarRelogio, 1000);
  document.addEventListener("keydown", atalhos);
}

async function carregarGabarito() {
  const t = estado.tentativa;
  const consulta = sb.from("gabarito").select("questao_id,resposta");
  const { data, error } = await (ehAleatoria(t) ? consulta.in("questao_id", t.questoes) : consulta.eq("ano", t.ano));
  if (error) toast("Erro ao carregar o gabarito: " + error.message, "erro");
  estado.gabarito = new Map((data || []).map((g) => [g.questao_id, g.resposta]));
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
let elLateral, elQuestao, elRelogio;

function render() {
  elRelogio = el("div", { class: "relogio" });
  elLateral = el("aside", { class: "painel-lateral" });
  elQuestao = el("section", { class: "questao" });
  main.replaceChildren(el("div", { class: "simulado" }, elLateral, elQuestao));
  renderLateral();
  renderQuestao();
  atualizarRelogio();
}

function situacao(q) {
  const r = estado.respostas.get(q.id);
  if (!finalizada()) {
    const ok = q.tipo === "objetiva" ? !!r?.alternativa : !!r?.texto?.trim();
    return ok ? "respondida" : "";
  }
  if (q.tipo === "discursiva") return r?.texto?.trim() ? "respondida" : "";
  if (q.anulada) return "";
  return r?.correta === true ? "certa" : "errada";
}

function renderLateral() {
  const t = estado.tentativa;
  const grupos = [];
  for (const [i, q] of estado.questoes.entries()) {
    let g = grupos.find((x) => x.secao === q.secao);
    if (!g) grupos.push((g = { secao: q.secao, itens: [] }));
    g.itens.push([i, q]);
  }
  const respondidas = estado.questoes.filter((q) => situacao(q) === "respondida").length;

  const nav = el("div", { class: "navegacao" },
    grupos.map((g) => [
      el("h4", {}, g.secao),
      el("div", { class: "botoes-q" }, g.itens.map(([i, q]) =>
        el("button", {
          class: ["btn-q", situacao(q), i === estado.atual ? "atual" : "", q.tipo === "discursiva" ? "disc" : "",
            estado.marcadas.has(q.id) ? "marcada" : ""].join(" "),
          title: q.rotulo + (q.anulada ? " (anulada)" : ""),
          onclick: () => irPara(i),
        }, q.tipo === "discursiva" ? `D${q.numero}` : q.numero))),
    ]));

  const cartao = el("div", { class: "cartao" },
    el("div", { class: "suave" }, `${nomeProva(t)} · ${MODOS[t.modo].nome}`),
    finalizada()
      ? el("div", {}, el("div", { class: "relogio" }, `${t.acertos}/${t.total_objetivas}`),
          el("small", {}, `acertos nas objetivas (${pct(t.percentual)})`))
      : el("div", {}, elRelogio, el("small", {}, `${respondidas} de ${estado.questoes.length} respondidas`)),
    nav,
    el("div", { class: "legenda" },
      finalizada()
        ? [el("span", {}, "🟩 acerto · 🟥 erro · D = discursiva"), el("span", {}, "Questões anuladas não contam na nota.")]
        : [el("span", {}, "Azul = respondida · ponto laranja = marcada para revisar"),
           el("span", {}, "Atalhos: ← → navegam, A–E marcam")]),
    el("div", { style: "margin-top:1rem;display:grid;gap:.5rem" },
      finalizada()
        ? el("button", { class: "btn btn-sec", onclick: () => irPara(-1) }, "Resumo do resultado")
        : el("button", { class: "btn", onclick: confirmarFinalizacao }, "Finalizar prova"),
      el("a", { class: "btn btn-sec", href: "index.html" }, finalizada() ? "Voltar" : "Sair (continua depois)")));
  elLateral.replaceChildren(cartao);
}

function irPara(i) {
  estado.atual = i;
  if (!finalizada()) sessionStorage.setItem(`atual:${estado.tentativa.id}`, i);
  renderLateral();
  renderQuestao();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function atualizarRelogio() {
  if (!elRelogio || finalizada()) return;
  const limite = MODOS[estado.tentativa.modo].minutos * 60;
  const decorrido = Math.floor((Date.now() - new Date(estado.tentativa.iniciada_em)) / 1000);
  const resta = limite - decorrido;
  const fmt = (s) => {
    s = Math.abs(s);
    return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");
  };
  elRelogio.textContent = resta >= 0 ? fmt(resta) : `+${fmt(resta)}`;
  elRelogio.classList.toggle("alerta", resta < 15 * 60);
  elRelogio.title = resta >= 0 ? "Tempo restante (sugerido)" : "Tempo sugerido esgotado";
}

// ---------------------------------------------------------------------------
// Questão
// ---------------------------------------------------------------------------
function renderQuestao() {
  if (estado.atual === -1) return renderResumo();
  const q = estado.questoes[estado.atual];
  const r = estado.respostas.get(q.id);

  const area = el("div", { class: "area-imagem" + (estado.ampliada ? " ampliada" : "") },
    imagemQuestao(q.img, q.largura, `Enunciado da ${q.rotulo}`));

  const topo = el("div", { class: "questao-topo" },
    el("h2", {}, q.rotulo),
    el("span", { class: "selo" }, q.secao),
    q.anulada ? el("span", { class: "selo alerta" }, "Anulada pelo INEP – não conta na nota") : null,
    el("span", { class: "espaco" }),
    !finalizada() ? el("button", { class: "btn btn-sec btn-peq", onclick: () => alternarMarcada(q) },
      estado.marcadas.has(q.id) ? "★ Marcada" : "☆ Marcar para revisar") : null,
    el("button", { class: "btn btn-sec btn-peq", onclick: () => { estado.ampliada = !estado.ampliada; renderQuestao(); } },
      estado.ampliada ? "Ajustar à tela" : "Ampliar"));

  const resposta = q.tipo === "objetiva" ? blocoObjetiva(q, r) : blocoDiscursiva(q, r);

  const anterior = estado.atual > 0;
  const proxima = estado.atual < estado.questoes.length - 1;
  const rodape = el("div", { class: "rodape-questao" },
    el("button", { class: "btn btn-sec", disabled: !anterior, onclick: () => irPara(estado.atual - 1) }, "← Anterior"),
    proxima
      ? el("button", { class: "btn", onclick: () => irPara(estado.atual + 1) }, "Próxima →")
      : !finalizada() ? el("button", { class: "btn", onclick: confirmarFinalizacao }, "Finalizar prova") : null);

  elQuestao.replaceChildren(topo, area, resposta, rodape);
}

function alternarMarcada(q) {
  estado.marcadas.has(q.id) ? estado.marcadas.delete(q.id) : estado.marcadas.add(q.id);
  localStorage.setItem(chaveMarcadas(), JSON.stringify([...estado.marcadas]));
  renderLateral();
  renderQuestao();
}

function blocoObjetiva(q, r) {
  const marcada = r?.alternativa;
  const gab = estado.gabarito.get(q.id);
  const status = el("span", { class: "status-salvo" });
  const botoes = LETRAS.map((L) => {
    let cls = "alt";
    if (finalizada()) {
      if (L === gab) cls += " certa";
      else if (L === marcada) cls += " errada";
    } else if (L === marcada) cls += " marcada";
    return el("button", {
      class: cls, disabled: finalizada(), "aria-pressed": L === marcada ? "true" : "false",
      onclick: () => salvarObjetiva(q, L === marcada ? null : L, status),
    }, L);
  });
  const bloco = el("div", {}, el("div", { class: "alternativas", role: "group", "aria-label": "Alternativas" }, botoes));
  if (finalizada()) {
    bloco.append(el("p", {},
      q.anulada ? "Questão anulada. "
        : marcada ? (marcada === gab ? el("span", { class: "selo ok" }, "Você acertou") : el("span", { class: "selo erro" }, "Você errou"))
        : el("span", { class: "selo erro" }, "Sem resposta"),
      " ", marcada ? `Sua resposta: ${marcada}. ` : "", gab && gab !== "ANULADA" ? `Gabarito oficial: ${gab}.` : ""));
  } else {
    bloco.append(el("div", { class: "linha" }, status,
      el("small", { class: "suave" }, "Clique de novo na alternativa marcada para desmarcar.")));
  }
  return bloco;
}

async function salvarObjetiva(q, letra, status) {
  status.textContent = "Salvando…";
  const { data, error } = await sb.from("respostas")
    .upsert({ tentativa_id: estado.tentativa.id, questao_id: q.id, tipo: "objetiva", alternativa: letra },
      { onConflict: "tentativa_id,questao_id" })
    .select().single();
  if (error) {
    status.textContent = "";
    return toast("Não foi possível salvar: " + error.message, "erro");
  }
  estado.respostas.set(q.id, data);
  renderLateral();
  renderQuestao();
}

function blocoDiscursiva(q, r) {
  const bloco = el("div", { style: "margin-top:1rem" });
  if (!finalizada()) {
    const status = el("span", { class: "status-salvo" }, r?.texto ? "Salvo" : "");
    const contador = el("small", { class: "suave" });
    const ta = el("textarea", { maxlength: 4000, placeholder: "Escreva sua resposta (no ENADE: até 15 linhas)…",
      "aria-label": "Resposta discursiva" });
    ta.value = r?.texto || "";
    const atualizarContador = () => (contador.textContent = `${ta.value.length}/4000 caracteres · ~${Math.ceil(ta.value.length / 90)} linhas`);
    let timer;
    ta.addEventListener("input", () => {
      atualizarContador();
      status.textContent = "Digitando…";
      clearTimeout(timer);
      timer = setTimeout(() => salvarDiscursiva(q, ta.value, status), 1200);
    });
    ta.addEventListener("blur", () => { clearTimeout(timer); if (ta.value !== (estado.respostas.get(q.id)?.texto || "")) salvarDiscursiva(q, ta.value, status); });
    atualizarContador();
    bloco.append(el("label", {}, "Sua resposta"), ta, el("div", { class: "linha" }, status, el("span", { class: "espaco" }), contador),
      el("p", { class: "suave" }, "O padrão de resposta do INEP aparece depois que você finalizar a prova."));
    return bloco;
  }
  bloco.append(
    el("h3", {}, "Sua resposta"),
    r?.texto?.trim() ? el("div", { class: "resposta-aluno" }, r.texto) : el("p", { class: "suave" }, "Você não respondeu esta questão."),
    blocoPadrao(q),
    blocoAutoavaliacao(q, r));
  if (r?.nota_professor !== null && r?.nota_professor !== undefined) {
    bloco.append(el("div", { class: "cartao", style: "margin-top:1rem" },
      el("h3", {}, `Avaliação do professor: ${String(r.nota_professor).replace(".", ",")} / 10`),
      r.comentario_professor ? el("p", { style: "white-space:pre-wrap" }, r.comentario_professor) : null));
  }
  return bloco;
}

async function salvarDiscursiva(q, texto, status) {
  status.textContent = "Salvando…";
  const { data, error } = await sb.from("respostas")
    .upsert({ tentativa_id: estado.tentativa.id, questao_id: q.id, tipo: "discursiva", texto },
      { onConflict: "tentativa_id,questao_id" })
    .select().single();
  if (error) { status.textContent = "Erro ao salvar"; return toast("Não foi possível salvar: " + error.message, "erro"); }
  estado.respostas.set(q.id, data);
  status.textContent = `Salvo às ${new Date().toLocaleTimeString("pt-BR", { timeStyle: "short" })}`;
  renderLateral();
}

function blocoAutoavaliacao(q, r) {
  const valor = r?.autoavaliacao ?? "";
  const entrada = el("input", { type: "range", min: 0, max: 10, step: 0.5, value: valor === "" ? 5 : valor,
    "aria-label": "Autoavaliação de 0 a 10" });
  const mostra = el("strong", {}, valor === "" ? "—" : String(valor).replace(".", ","));
  entrada.addEventListener("input", () => (mostra.textContent = entrada.value.replace(".", ",")));
  const btn = el("button", { class: "btn btn-sec btn-peq" }, "Salvar autoavaliação");
  btn.addEventListener("click", async () => {
    const { error } = await sb.rpc("autoavaliar",
      { p_tentativa: estado.tentativa.id, p_questao: q.id, p_nota: Number(entrada.value) });
    if (error) return toast(error.message, "erro");
    const atual = estado.respostas.get(q.id) || { questao_id: q.id, tipo: "discursiva" };
    estado.respostas.set(q.id, { ...atual, autoavaliacao: Number(entrada.value) });
    mostra.textContent = entrada.value.replace(".", ",");
    toast("Autoavaliação salva.", "ok");
  });
  return el("div", { class: "cartao", style: "margin-top:1rem" },
    el("h3", {}, "Autoavaliação"),
    el("p", { class: "suave" }, "Compare sua resposta com o padrão e atribua uma nota de 0 a 10. Isso ajuda você e os professores a acompanhar sua evolução."),
    el("div", { class: "linha" }, entrada, mostra, btn));
}

// ---------------------------------------------------------------------------
// Finalização e resumo
// ---------------------------------------------------------------------------
async function confirmarFinalizacao() {
  const faltam = estado.questoes.filter((q) => situacao(q) !== "respondida");
  const msg = faltam.length
    ? `Ainda há ${faltam.length} questão(ões) sem resposta. Depois de finalizar não é possível alterar as respostas. Finalizar mesmo assim?`
    : "Finalizar a prova? Depois disso não é possível alterar as respostas.";
  if (!confirm(msg)) return;
  const { data, error } = await sb.rpc("finalizar_tentativa", { p_tentativa: estado.tentativa.id });
  if (error) return toast("Erro ao finalizar: " + error.message, "erro");
  estado.tentativa = data;
  const { data: resp } = await sb.from("respostas").select("*").eq("tentativa_id", data.id);
  estado.respostas = new Map((resp || []).map((r) => [r.questao_id, r]));
  await carregarGabarito();
  sessionStorage.removeItem(`atual:${data.id}`);
  estado.atual = -1;
  render();
  toast("Prova finalizada!", "ok");
}

function renderResumo() {
  const t = estado.tentativa;
  const objetivas = estado.questoes.filter((q) => q.tipo === "objetiva" && !q.anulada);
  const porComp = (c) => {
    const qs = objetivas.filter((q) => q.componente === c);
    const ac = qs.filter((q) => estado.respostas.get(q.id)?.correta).length;
    return qs.length ? { ac, total: qs.length, p: (100 * ac) / qs.length } : null;
  };
  const fg = porComp("FG"), ce = porComp("CE");
  const disc = estado.questoes.filter((q) => q.tipo === "discursiva");
  const auto = disc.map((q) => estado.respostas.get(q.id)?.autoavaliacao).filter((v) => v !== null && v !== undefined);

  const secoes = [...new Set(objetivas.map((q) => q.secao))].map((s) => {
    const qs = objetivas.filter((q) => q.secao === s);
    const ac = qs.filter((q) => estado.respostas.get(q.id)?.correta).length;
    const p = (100 * ac) / qs.length;
    return el("tr", {}, el("td", {}, s), el("td", { class: "num" }, `${ac}/${qs.length}`),
      el("td", {}, el("div", { class: "barra" }, el("span", { style: `width:${p}%` }))), el("td", { class: "num" }, pct(p)));
  });

  elQuestao.replaceChildren(el("div", { class: "cartao" },
    el("h2", {}, `Resultado – ${nomeProva(t)}`),
    el("p", { class: "suave" }, `${MODOS[t.modo].nome} · iniciada em ${dataHora(t.iniciada_em)} · finalizada em ${dataHora(t.finalizada_em)}`),
    el("div", { class: "resumo-kpis" },
      el("div", { class: "kpi" }, el("strong", {}, `${t.acertos}/${t.total_objetivas}`), "acertos nas objetivas"),
      el("div", { class: "kpi" }, el("strong", {}, pct(t.percentual)), "aproveitamento"),
      fg ? el("div", { class: "kpi" }, el("strong", {}, pct(fg.p)), `Formação Geral (${fg.ac}/${fg.total})`) : null,
      ce ? el("div", { class: "kpi" }, el("strong", {}, pct(ce.p)), `Componente Específico (${ce.ac}/${ce.total})`) : null,
      disc.length ? el("div", { class: "kpi" },
        el("strong", {}, auto.length ? (auto.reduce((a, b) => a + b, 0) / auto.length).toFixed(1).replace(".", ",") : "—"),
        `autoavaliação média das discursivas (${auto.length}/${disc.length})`) : null),
    el("h3", {}, "Desempenho por parte da prova"),
    el("div", { class: "tabela-rolagem" }, el("table", {},
      el("thead", {}, el("tr", {}, el("th", {}, "Parte"), el("th", { class: "num" }, "Acertos"), el("th", {}, ""), el("th", { class: "num" }, "%"))),
      el("tbody", {}, secoes))),
    disc.length ? el("p", { style: "margin-top:1rem" },
      "Agora revise as discursivas: compare sua resposta com o padrão de resposta e faça a autoavaliação. ",
      el("button", { class: "btn btn-peq", onclick: () => irPara(estado.questoes.indexOf(disc[0])) }, "Ir para as discursivas")) : null,
    el("p", { class: "suave" }, "Use a grade ao lado para revisar cada questão: verde = acerto, vermelho = erro.")));
}

// ---------------------------------------------------------------------------
// Atalhos de teclado
// ---------------------------------------------------------------------------
function atalhos(e) {
  if (["TEXTAREA", "INPUT", "SELECT"].includes(document.activeElement?.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (document.querySelector(".modal-fundo")) return;
  if (e.key === "ArrowRight" && estado.atual < estado.questoes.length - 1) irPara(estado.atual + 1);
  else if (e.key === "ArrowLeft" && estado.atual > 0) irPara(estado.atual - 1);
  else if (!finalizada() && estado.atual >= 0) {
    const L = e.key.toUpperCase();
    const q = estado.questoes[estado.atual];
    if (q.tipo === "objetiva" && LETRAS.includes(L)) {
      const atual = estado.respostas.get(q.id)?.alternativa;
      salvarObjetiva(q, atual === L ? null : L, document.querySelector(".status-salvo") || el("span"));
    }
  }
}

iniciar().catch((e) => { console.error(e); toast("Erro inesperado: " + e.message, "erro"); });
