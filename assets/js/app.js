// Funções compartilhadas por todas as páginas.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, INSTITUICAO } from "./config.js";

export const configurado = !SUPABASE_URL.includes("SEU-PROJETO") && !SUPABASE_ANON_KEY.includes("SUA-CHAVE");
export const sb = configurado ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

export const MODOS = {
  completa: { nome: "Prova completa", minutos: 240 },
  formacao_geral: { nome: "Só Formação Geral", minutos: 70 },
  especifico: { nome: "Só Componente Específico", minutos: 170 },
};

// ---------------------------------------------------------------------------
// Utilidades de DOM
// ---------------------------------------------------------------------------
export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

export function toast(msg, tipo = "info") {
  let box = document.getElementById("toasts");
  if (!box) document.body.append((box = el("div", { id: "toasts" })));
  const t = el("div", { class: `toast ${tipo}` }, msg);
  box.append(t);
  setTimeout(() => t.remove(), tipo === "erro" ? 7000 : 3500);
}

export function dataHora(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function pct(v) {
  return v === null || v === undefined || Number.isNaN(v) ? "—" : `${Number(v).toFixed(1).replace(".", ",")}%`;
}

export function duracao(minutos) {
  const h = Math.floor(minutos / 60), m = minutos % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

export function baixarCSV(nome, linhas) {
  const csv = linhas
    .map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";"))
    .join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = el("a", { href: URL.createObjectURL(blob), download: nome });
  document.body.append(a);
  a.click();
  a.remove();
}

export function modal(titulo, conteudo, { largo = false } = {}) {
  const fechar = () => fundo.remove();
  const fundo = el(
    "div",
    { class: "modal-fundo", onclick: (e) => e.target === fundo && fechar() },
    el(
      "div",
      { class: `modal ${largo ? "largo" : ""}`, role: "dialog", "aria-modal": "true" },
      el("div", { class: "modal-topo" }, el("h3", {}, titulo),
        el("button", { class: "btn-icone", "aria-label": "Fechar", onclick: fechar }, "✕")),
      el("div", { class: "modal-corpo" }, conteudo)
    )
  );
  document.addEventListener("keydown", function esc(e) {
    if (e.key === "Escape") { fechar(); document.removeEventListener("keydown", esc); }
  });
  document.body.append(fundo);
  return fechar;
}

// Imagem de questão/padrão no tamanho de leitura do caderno (1,5× o tamanho impresso)
export function imagemQuestao(src, largura, alt) {
  const img = el("img", { src, alt, loading: "lazy", class: "img-questao" });
  img.style.width = `${Math.round(largura * 0.75)}px`;
  return img;
}

export function blocoPadrao(q) {
  const p = q.padrao;
  if (!p) return el("p", { class: "suave" }, "Padrão de resposta indisponível.");
  return el("div", { class: "cartao padrao" + (p.oficial ? "" : " nao-oficial") },
    el("div", { class: "linha" },
      el("h3", { style: "margin:0" }, "Padrão de resposta"),
      el("span", { class: "selo " + (p.oficial ? "ok" : "alerta") }, p.oficial ? "Oficial INEP" : "Não oficial")),
    el("p", { class: "suave", style: "margin:.3rem 0 .8rem" }, p.fonte),
    p.img ? el("div", { class: "area-imagem" }, imagemQuestao(p.img, p.largura, "Padrão de resposta"))
      : el("div", { class: "conteudo-html", html: p.html }));
}

// ---------------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------------
let _provas;
export async function carregarProvas() {
  if (!_provas) {
    const r = await fetch("data/provas.json", { cache: "no-cache" });
    _provas = (await r.json()).provas;
  }
  return _provas;
}

export function questoesDoModo(prova, modo) {
  if (modo === "formacao_geral") return prova.questoes.filter((q) => q.componente === "FG");
  if (modo === "especifico") return prova.questoes.filter((q) => q.componente === "CE");
  return prova.questoes;
}

// ---------------------------------------------------------------------------
// Simulado aleatório: questões sorteadas de todas as edições, na estrutura do ENADE
// ---------------------------------------------------------------------------
export const COMPOSICAO_ALEATORIA = {
  FG: { discursiva: 2, objetiva: 8 },
  CE: { discursiva: 3, objetiva: 27 },
};

const componentesDoModo = (modo) =>
  modo === "formacao_geral" ? ["FG"] : modo === "especifico" ? ["CE"] : ["FG", "CE"];

export function contagemAleatoria(modo) {
  const cs = componentesDoModo(modo).map((c) => COMPOSICAO_ALEATORIA[c]);
  return { objetivas: cs.reduce((s, c) => s + c.objetiva, 0), discursivas: cs.reduce((s, c) => s + c.discursiva, 0) };
}

function embaralhar(xs) {
  const a = [...xs], r = new Uint32Array(a.length);
  crypto.getRandomValues(r);
  for (let i = a.length - 1; i > 0; i--) {
    const j = r[i] % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Sorteia os ids das questões (anuladas ficam de fora), na ordem do caderno: discursivas e
// objetivas da Formação Geral, depois as do Componente Específico
export function sortearQuestoes(provas, modo) {
  const todas = provas.flatMap((p) => p.questoes).filter((q) => !q.anulada);
  return componentesDoModo(modo).flatMap((c) => ["discursiva", "objetiva"].flatMap((tipo) =>
    embaralhar(todas.filter((q) => q.componente === c && q.tipo === tipo))
      .slice(0, COMPOSICAO_ALEATORIA[c][tipo])
      .sort((a, b) => a.ano - b.ano || a.numero - b.numero)
      .map((q) => q.id)));
}

// Certificado: prova completa finalizada com este percentual ou mais nas objetivas
// (o mesmo limite está em verificar_certificado, no supabase/schema.sql)
export const CERTIFICADO_MINIMO = 60;
export const podeEmitirCertificado = (t) =>
  !!t.finalizada_em && t.modo === "completa" && Number(t.percentual) >= CERTIFICADO_MINIMO;

export const ehAleatoria = (t) => Array.isArray(t.questoes);
export const nomeProva = (t) => (ehAleatoria(t) ? "Simulado aleatório" : `ENADE ${t.ano}`);

// Questões de uma tentativa. No simulado aleatório elas são renumeradas (1–35 e D1–D5) e o rótulo
// indica a edição e o número de origem.
export function questoesDaTentativa(provas, t) {
  if (!ehAleatoria(t)) return questoesDoModo(provas.find((p) => p.ano === t.ano), t.modo);
  const porId = new Map(provas.flatMap((p) => p.questoes.map((q) => [q.id, q])));
  const cont = { objetiva: 0, discursiva: 0 };
  return t.questoes.map((id) => porId.get(id)).filter(Boolean).map((q) => {
    const n = ++cont[q.tipo];
    return {
      ...q, numero: n,
      rotulo: `${q.tipo === "discursiva" ? "Questão Discursiva" : "Questão"} ${n} · ENADE ${q.ano}, ${q.rotulo.toLowerCase()}`,
      secao: q.componente === "FG" ? "Formação Geral" : "Componente Específico",
    };
  });
}

// Busca todas as linhas de uma consulta (o Supabase limita a 1000 por requisição)
export async function buscarTudo(construir, passo = 1000) {
  let todas = [];
  for (let de = 0; ; de += passo) {
    const { data, error } = await construir().range(de, de + passo - 1);
    if (error) throw error;
    todas = todas.concat(data);
    if (data.length < passo) return todas;
  }
}

// ---------------------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------------------
export async function entrarComGitHub() {
  const destino = new URL("index.html", location.href).href;
  const { error } = await sb.auth.signInWithOAuth({ provider: "github", options: { redirectTo: destino } });
  if (error) toast("Não foi possível iniciar o login: " + error.message, "erro");
}

export async function sair() {
  await sb.auth.signOut();
  location.href = "index.html";
}

export async function usuarioAtual() {
  if (!sb) return { sessao: null, perfil: null };
  const { data } = await sb.auth.getSession();
  const sessao = data.session;
  if (!sessao) return { sessao: null, perfil: null };
  let { data: perfil, error } = await sb.from("perfis").select("*").eq("id", sessao.user.id).maybeSingle();
  if (error) toast("Erro ao carregar o perfil: " + error.message, "erro");
  return { sessao, perfil };
}

// Garante usuário logado; senão volta para a página inicial
export async function exigirLogin({ professor = false } = {}) {
  if (!configurado) { location.href = "index.html"; return null; }
  const u = await usuarioAtual();
  if (!u.sessao) { location.href = "index.html"; return null; }
  if (professor && u.perfil?.papel !== "professor") {
    document.querySelector("main").replaceChildren(
      el("div", { class: "cartao aviso" }, el("h2", {}, "Acesso restrito"),
        el("p", {}, "Esta área é exclusiva para professores. Peça a um professor já cadastrado para incluir o seu usuário do GitHub."),
        el("a", { class: "btn", href: "index.html" }, "Voltar")));
    return null;
  }
  return u;
}

export function montarCabecalho(perfil) {
  const topo = document.getElementById("topo");
  if (!topo) return;
  const direita = el("div", { class: "topo-direita" });
  if (perfil) {
    if (perfil.papel === "professor") direita.append(el("a", { href: "professor.html", class: "link-topo" }, "Painel do professor"));
    direita.append(
      el("a", { href: "index.html", class: "link-topo" }, "Meus simulados"),
      el("span", { class: "usuario" },
        perfil.avatar_url ? el("img", { src: perfil.avatar_url, alt: "", class: "avatar" }) : null,
        perfil.nome || perfil.github),
      el("button", { class: "btn btn-sec btn-peq", onclick: sair }, "Sair")
    );
  }
  topo.replaceChildren(
    el("a", { href: "index.html", class: "marca" },
      el("span", { class: "marca-logo" }, "E"),
      el("span", {}, el("strong", {}, "Simulado ENADE"), el("small", {}, INSTITUICAO))),
    direita
  );
}
