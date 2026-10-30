// Verificação pública de certificado (não exige login)
import { sb, configurado, el, toast, pct, montarCabecalho, usuarioAtual } from "./app.js";

const main = document.getElementById("conteudo");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function iniciar() {
  montarCabecalho(configurado ? (await usuarioAtual()).perfil : null);
  const codigo = el("input", { type: "text", id: "codigo", placeholder: "Código de verificação impresso no certificado",
    value: new URLSearchParams(location.search).get("c") || "" });
  const resultado = el("div");
  const form = el("form", { class: "cartao", style: "max-width:640px;margin:2rem auto" },
    el("h2", {}, "Verificar certificado"),
    el("div", { class: "campo" }, el("label", { for: "codigo" }, "Código de verificação"), codigo),
    el("div", { class: "linha fim" }, el("button", { class: "btn", type: "submit" }, "Verificar")),
    resultado);
  form.addEventListener("submit", (e) => { e.preventDefault(); verificar(codigo.value.trim(), resultado); });
  main.replaceChildren(form);
  if (codigo.value) verificar(codigo.value.trim(), resultado);
}

async function verificar(codigo, resultado) {
  const invalido = () => resultado.replaceChildren(el("div", { class: "cartao aviso", style: "margin-top:1rem" },
    el("strong", {}, "Certificado não encontrado."),
    el("p", { style: "margin:.3rem 0 0" }, "Confira se o código foi digitado corretamente.")));
  if (!configurado || !UUID.test(codigo)) return invalido();
  const { data, error } = await sb.rpc("verificar_certificado", { p_codigo: codigo });
  if (error) return toast("Erro ao verificar: " + error.message, "erro");
  const c = data?.[0];
  if (!c) return invalido();
  resultado.replaceChildren(el("div", { class: "cartao certificado" },
    el("h3", { style: "margin-top:0" }, "Certificado válido"),
    el("p", {}, el("strong", {}, c.nome), " concluiu o Simulado ENADE de Ciência da Computação (prova completa, ",
      c.aleatorio ? "simulado aleatório" : `edição de ${c.ano}`, ") em ",
      new Date(c.finalizada_em).toLocaleDateString("pt-BR"), ", com aproveitamento de ", pct(c.percentual),
      ` nas questões objetivas (${c.acertos} de ${c.total_objetivas}).`)));
}

iniciar().catch((e) => { console.error(e); toast("Erro inesperado: " + e.message, "erro"); });
