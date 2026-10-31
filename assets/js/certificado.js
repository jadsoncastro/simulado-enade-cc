// Certificado em PDF (prova completa com 60% ou mais), desenhado sobre certificado/certificado.jpg.
// O código de verificação é o id da tentativa; verificar.html confirma o certificado no banco.
import { ehAleatoria, CERTIFICADO_MINIMO } from "./app.js";

const FUNDO = "certificado/certificado.jpg";
const JSPDF = "https://cdn.jsdelivr.net/npm/jspdf@4.2.1/+esm";

// O fundo tem 1376 × 768 px; as posições abaixo estão em pixels da imagem
const IMG_L = 1376, IMG_A = 768;
const PAG_L = 297, PAG_A = (PAG_L * IMG_A) / IMG_L; // mm, mesma proporção da imagem
const mm = (px) => (px * PAG_L) / IMG_L;
const AZUL = [31, 58, 95], CINZA = [70, 70, 70];

function carregarImagem(src) {
  return new Promise((ok, erro) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => erro(new Error("Não foi possível carregar o fundo do certificado."));
    img.src = src;
  });
}

const dataExtenso = (iso) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
const numero = (v) => Number(v).toFixed(1).replace(".", ",");

export const urlVerificacao = (id) => new URL(`verificar.html${id ? `?c=${id}` : ""}`, location.href).href;

export async function emitirCertificado(t, perfil, provas) {
  if (!t.finalizada_em || t.modo !== "completa" || Number(t.percentual) < CERTIFICADO_MINIMO) {
    throw new Error(`O certificado é emitido para a prova completa com ${CERTIFICADO_MINIMO}% ou mais.`);
  }
  const [{ jsPDF }, fundo] = await Promise.all([import(JSPDF), carregarImagem(FUNDO)]);
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: [PAG_L, PAG_A] });
  doc.setProperties({ title: "Certificado – Simulado ENADE", subject: `Código ${t.id}` });
  doc.addImage(fundo, "JPEG", 0, 0, PAG_L, PAG_A);

  const centro = mm(IMG_L / 2);
  doc.setTextColor(...CINZA);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(13);
  doc.text("Certificamos que", centro, mm(282), { align: "center" });

  // Nome: diminui a fonte até caber na largura disponível
  const nome = (perfil.nome || perfil.github || "").toUpperCase();
  doc.setTextColor(...AZUL);
  doc.setFont("times", "bold");
  let tam = 28;
  doc.setFontSize(tam);
  while (tam > 14 && doc.getTextWidth(nome) > mm(940)) doc.setFontSize(--tam);
  doc.text(nome, centro, mm(335), { align: "center" });

  doc.setTextColor(...CINZA);
  doc.setFont("helvetica", "normal");
  if (perfil.matricula) {
    doc.setFontSize(10);
    doc.text(`Matrícula ${perfil.matricula}`, centro, mm(366), { align: "center" });
  }

  const anos = provas.map((p) => p.ano).sort();
  const prova = ehAleatoria(t)
    ? `com questões sorteadas das edições de ${anos[0]} a ${anos[anos.length - 1]}`
    : `com a prova da edição de ${t.ano}`;
  const texto = `concluiu o Simulado ENADE de Ciência da Computação (prova completa), ${prova}, ` +
    `em ${new Date(t.finalizada_em).toLocaleDateString("pt-BR")}, obtendo aproveitamento de ${numero(t.percentual)}% ` +
    `nas questões objetivas (${t.acertos} acertos em ${t.total_objetivas} questões). Consideramos um total de 4 (quatro) horas de atividades.`;
  doc.setFontSize(12.5);
  doc.text(doc.splitTextToSize(texto, mm(900)), centro, mm(412), { align: "center", lineHeightFactor: 1.5 });

  // Linha da direita: local e data de emissão, e o código de verificação
  const direita = mm(1062);
  doc.setFontSize(11);
  doc.text(`Ouro Preto, ${dataExtenso(new Date().toISOString())}`, direita, mm(597), { align: "center" });
  doc.setFontSize(10);
  doc.text("Data de emissão", direita, mm(632), { align: "center" });
  doc.setFontSize(6.5);
  doc.text(`Código de verificação: ${t.id}`, direita, mm(656), { align: "center" });
  const verifique = `Verifique em ${urlVerificacao().replace(/^https?:\/\//, "")}`;
  doc.setTextColor(...AZUL);
  doc.textWithLink(verifique, direita - doc.getTextWidth(verifique) / 2, mm(674), { url: urlVerificacao(t.id) });

  const arquivo = nome.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  doc.save(`certificado_simulado_enade_${arquivo || "aluno"}.pdf`);
}
