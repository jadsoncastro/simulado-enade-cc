// Supabase falso (em memória + localStorage) que imita as regras de supabase/schema.sql.
const LS = "fakedb";
const GAB = window.__GABARITO__ || {};
function db() {
  let d = JSON.parse(localStorage.getItem(LS) || "null");
  if (!d) {
    d = {
      perfis: [
        { id: "u-aluno1", email: "a1@ufop.edu.br", github: "aluno1", nome: null, matricula: null, avatar_url: null, papel: "aluno", criado_em: new Date().toISOString() },
        { id: "u-prof1", email: "p1@ufop.edu.br", github: "prof1", nome: "Professora Um", matricula: null, avatar_url: null, papel: "professor", criado_em: new Date().toISOString() },
      ],
      tentativas: [], respostas: [], professores_autorizados: [{ github: "prof1", incluido_em: new Date().toISOString() }],
      seq: 1,
    };
    save(d);
  }
  return d;
}
function save(d) { localStorage.setItem(LS, JSON.stringify(d)); }
const uid = () => localStorage.getItem("fakeuser");
const isProf = (d) => d.perfis.some((p) => p.id === uid() && p.papel === "professor");
const gabRows = () => Object.entries(GAB).map(([questao_id, g]) => ({ questao_id, ...g }));

function visible(d, t) {
  const me = uid(), prof = isProf(d);
  if (t === "perfis") return d.perfis.filter((p) => p.id === me || prof);
  if (t === "tentativas") return d.tentativas.filter((x) => x.aluno_id === me || prof);
  if (t === "respostas") return d.respostas.filter((x) => x.aluno_id === me || prof);
  if (t === "gabarito") return gabRows().filter((g) => prof || d.tentativas.some((x) => x.aluno_id === me && x.finalizada_em &&
    (x.ano === g.ano || (x.questoes || []).includes(g.questao_id))));
  if (t === "professores_autorizados") return prof ? d.professores_autorizados : [];
  throw new Error("tabela desconhecida " + t);
}
function corrigir(r) {
  if (r.tipo === "objetiva") {
    const g = GAB[r.questao_id]?.resposta;
    r.correta = !g || g === "ANULADA" || !r.alternativa ? null : r.alternativa === g;
    r.texto = null;
  } else { r.correta = null; r.alternativa = null; }
  r.atualizada_em = new Date().toISOString();
}
const erro = (message) => ({ data: null, error: { message } });

class Q {
  constructor(t) { Object.assign(this, { t, filters: [], op: "select", ord: null, sing: null, rng: null }); }
  select() { return this; }
  eq(c, v) { this.filters.push((r) => String(r[c]) === String(v)); return this; }
  in(c, vs) { this.filters.push((r) => vs.map(String).includes(String(r[c]))); return this; }
  not(c) { this.filters.push((r) => r[c] !== null && r[c] !== undefined); return this; }
  order(c, o = {}) { this.ord = [c, o.ascending !== false]; return this; }
  range(a, b) { this.rng = [a, b]; return this; }
  maybeSingle() { this.sing = "maybe"; return this; }
  single() { this.sing = "one"; return this; }
  insert(p) { this.op = "insert"; this.payload = p; return this; }
  upsert(p, o) { this.op = "upsert"; this.payload = p; this.conf = o.onConflict.split(","); return this; }
  update(p) { this.op = "update"; this.payload = p; return this; }
  delete() { this.op = "delete"; return this; }
  then(ok, ko) { return new Promise((r) => setTimeout(() => r(this.exec()), 15)).then(ok, ko); }
  out(rows) {
    if (this.ord) { const [c, asc] = this.ord; rows = [...rows].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1)); }
    if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
    if (this.sing === "one") return rows.length === 1 ? { data: rows[0], error: null } : erro("esperava 1 linha");
    if (this.sing === "maybe") return { data: rows[0] || null, error: null };
    return { data: JSON.parse(JSON.stringify(rows)), error: null };
  }
  exec() {
    const d = db(), me = uid(), t = this.t;
    if (!me) return erro("não autenticado");
    if (this.op === "select") return this.out(visible(d, t).filter((r) => this.filters.every((f) => f(r))));
    if (this.op === "insert") {
      const p = this.payload;
      if (t === "tentativas") {
        if (Object.keys(p).some((k) => !["ano", "modo", "questoes"].includes(k))) return erro("permission denied");
        const q = p.questoes ?? null;
        if ((p.ano == null) === (q == null) || (q && (q.length < 1 || q.length > 40))) return erro("violates check constraint");
        const row = { id: "t-" + d.seq++, aluno_id: me, ano: p.ano ?? null, modo: p.modo, questoes: q, iniciada_em: new Date().toISOString(),
          finalizada_em: null, acertos: null, total_objetivas: null, percentual: null };
        d.tentativas.push(row); save(d); return this.out([row]);
      }
      if (t === "professores_autorizados") {
        if (!isProf(d)) return erro("RLS");
        d.professores_autorizados.push({ github: p.github, incluido_em: new Date().toISOString() });
        d.perfis.filter((x) => (x.github || "").toLowerCase() === p.github.toLowerCase()).forEach((x) => (x.papel = "professor"));
        save(d); return this.out([p]);
      }
      return erro("insert não suportado em " + t);
    }
    if (this.op === "upsert") {
      if (t !== "respostas") return erro("upsert só em respostas");
      const p = this.payload;
      const tent = d.tentativas.find((x) => x.id === p.tentativa_id);
      if (!tent || tent.aluno_id !== me || tent.finalizada_em) return erro("new row violates row-level security policy");
      let row = d.respostas.find((r) => r.tentativa_id === p.tentativa_id && r.questao_id === p.questao_id);
      if (!row) {
        row = { id: d.seq++, aluno_id: me, autoavaliacao: null, nota_professor: null, comentario_professor: null, alternativa: null, texto: null };
        d.respostas.push(row);
      }
      Object.assign(row, p); corrigir(row); save(d); return this.out([row]);
    }
    if (this.op === "update") {
      if (t !== "perfis") return erro("update não suportado");
      if (Object.keys(this.payload).some((k) => !["nome", "matricula"].includes(k))) return erro("permission denied");
      const rows = d.perfis.filter((r) => r.id === me && this.filters.every((f) => f(r)));
      rows.forEach((r) => Object.assign(r, this.payload)); save(d); return this.out(rows);
    }
    if (this.op === "delete") {
      const alvo = visible(d, t).filter((r) => this.filters.every((f) => f(r)));
      if (t === "tentativas") {
        const ids = new Set(alvo.filter((x) => isProf(d) || !x.finalizada_em).map((x) => x.id));
        d.tentativas = d.tentativas.filter((x) => !ids.has(x.id));
        d.respostas = d.respostas.filter((x) => !ids.has(x.tentativa_id));
      } else if (t === "professores_autorizados") {
        const gs = new Set(alvo.map((x) => x.github));
        d.professores_autorizados = d.professores_autorizados.filter((x) => !gs.has(x.github));
        d.perfis.filter((x) => gs.has(x.github)).forEach((x) => (x.papel = "aluno"));
      } else return erro("delete não suportado");
      save(d); return { data: null, error: null };
    }
  }
}

async function rpc(nome, a) {
  await new Promise((r) => setTimeout(r, 15));
  const d = db(), me = uid();
  if (nome === "finalizar_tentativa") {
    const t = d.tentativas.find((x) => x.id === a.p_tentativa);
    if (!t || t.aluno_id !== me) return erro("Tentativa não encontrada");
    if (!t.finalizada_em) {
      const tot = gabRows().filter((g) => g.resposta !== "ANULADA" && (t.questoes ? t.questoes.includes(g.questao_id) : g.ano === t.ano &&
        (t.modo === "completa" || (t.modo === "formacao_geral" && g.componente === "FG") || (t.modo === "especifico" && g.componente === "CE")))).length;
      const ac = d.respostas.filter((r) => r.tentativa_id === t.id && r.correta && (!t.questoes || t.questoes.includes(r.questao_id))).length;
      Object.assign(t, { finalizada_em: new Date().toISOString(), acertos: ac, total_objetivas: tot,
        percentual: tot ? Math.round(1000 * ac / tot) / 10 : null });
      save(d);
    }
    return { data: { ...t }, error: null };
  }
  if (nome === "autoavaliar") {
    const t = d.tentativas.find((x) => x.id === a.p_tentativa && x.aluno_id === me && x.finalizada_em);
    if (!t) return erro("Finalize a prova antes de se autoavaliar");
    let r = d.respostas.find((x) => x.tentativa_id === t.id && x.questao_id === a.p_questao);
    if (!r) { r = { id: d.seq++, tentativa_id: t.id, aluno_id: me, questao_id: a.p_questao, tipo: "discursiva", texto: null, alternativa: null, correta: null, nota_professor: null }; d.respostas.push(r); }
    r.autoavaliacao = a.p_nota; save(d); return { data: null, error: null };
  }
  if (nome === "avaliar_discursiva") {
    if (!isProf(d)) return erro("Apenas professores podem avaliar");
    const r = d.respostas.find((x) => x.id === a.p_resposta);
    Object.assign(r, { nota_professor: a.p_nota, comentario_professor: a.p_comentario }); save(d);
    return { data: null, error: null };
  }
  return erro("rpc desconhecida " + nome);
}

export function createClient() {
  return {
    auth: {
      async getSession() { const u = uid(); return { data: { session: u ? { user: { id: u } } : null } }; },
      async signInWithOAuth({ options }) { localStorage.setItem("fakeuser", "u-aluno1"); location.href = options.redirectTo; return { error: null }; },
      async signOut() { localStorage.removeItem("fakeuser"); return { error: null }; },
    },
    from: (t) => new Q(t),
    rpc,
  };
}
