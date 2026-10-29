#!/usr/bin/env python3
"""
Gera o banco de questões do simulado a partir dos PDFs oficiais do ENADE.

Para cada edição (2005-2021) o script:
  1. localiza os títulos "QUESTÃO N" / "QUESTÃO DISCURSIVA N" no caderno de prova (PV);
  2. recorta cada questão (respeitando as duas colunas e a quebra de página) e salva em WebP;
  3. recorta o padrão de resposta oficial de cada questão discursiva;
  4. lê o gabarito (GB) e gera supabase/seed_gabarito.sql (o gabarito NÃO vai para o site público);
  5. escreve data/provas.json, usado pelo front-end.

Somente as questões que fazem parte da prova de Bacharelado em Ciência da Computação são mantidas
(nas edições 2005, 2008 e 2011 o caderno era único para toda a área de Computação).

Uso:
    python tools/build_questions.py --pdfs "../Simulado"
Requer: PyMuPDF (fitz) e Pillow.
"""
import argparse
import json
import os
import re
import sys

import fitz  # PyMuPDF
from PIL import Image, ImageChops

ZOOM = 2.0          # resolução de renderização (2.0 = 144 dpi)
WEBP_QUALITY = 82

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------------------
# Configuração por edição
#   top/bottom   : faixa útil da página (exclui cabeçalho e rodapé), em pontos PDF
#   last_page    : última página com questões (depois vem o questionário de percepção)
#   cut_rascunho : corta a questão DISCURSIVA no quadro "RASCUNHO"/"Área livre" (nas objetivas
#                  o corte é sempre feito). Em 2005/2008 o enunciado continua depois do 1º rascunho.
#   secao(k, n)  : devolve (componente, nome da seção) ou None se a questão não é de CC
# ---------------------------------------------------------------------------


def secao_2005(k, n):
    if n <= 10:
        return "FG", "Formação Geral"
    if 41 <= n <= 55:
        return "CE", "Componente Específico – Núcleo comum (CC/EC)"
    if 56 <= n <= 70:
        return "CE", "Componente Específico – Ciência da Computação"
    return None


def secao_2008(k, n):
    if n <= 10:
        return "FG", "Formação Geral"
    if n <= 20:
        return "CE", "Componente Específico – Núcleo comum"
    if n <= 40:
        return "CE", "Componente Específico – Ciência da Computação"
    return None


def secao_2011(k, n):
    if k == "D":
        return ("FG", "Formação Geral") if n <= 2 else ("CE", "Componente Específico – Núcleo comum")
    if n <= 8:
        return "FG", "Formação Geral"
    if n <= 30:
        return "CE", "Componente Específico – Núcleo comum"
    if 36 <= n <= 40:
        return "CE", "Componente Específico – Ciência da Computação"
    return None


def secao_cc(k, n):
    if (k == "D" and n <= 2) or (k == "Q" and n <= 8):
        return "FG", "Formação Geral"
    return "CE", "Componente Específico"


PROVAS = {
    "2005": dict(top=38, bottom=790, last_page=31, cut_rascunho=False, secao=secao_2005,
                 unified=True, padrao="texto"),
    "2008": dict(top=58, bottom=780, last_page=34, cut_rascunho=False, secao=secao_2008,
                 unified=True, padrao="numerado", padrao_re=r"^Quest[ãa]o\s+(\d+)$"),
    "2011": dict(top=64, bottom=734, last_page=31, cut_rascunho=True, secao=secao_2011,
                 unified=False, padrao="numerado", padrao_re=r"^QUEST[ÃA]O DISCURSIVA\s+(\d+)$"),
    "2014": dict(top=80, bottom=724, last_page=27, cut_rascunho=True, secao=secao_cc,
                 unified=False, padrao="sequencial"),
    "2017": dict(top=82, bottom=764, last_page=33, cut_rascunho=True, secao=secao_cc,
                 unified=False, padrao="sequencial"),
    "2021": dict(top=72, bottom=741, last_page=43, cut_rascunho=True, secao=secao_cc,
                 unified=False, padrao="sequencial"),
}

# Algumas provas (2014/2017) usam fontes sem mapeamento Unicode. Os títulos das questões
# aparecem com glifos deslocados; estes trechos foram identificados manualmente.
GLYPH_FIX = [("Yh\x1c^d\x08K", "QUESTÃO"), ("\x18/^\x12hZ^/s\x04", "DISCURSIVA"),
             ("Z^\x12hE,K", "RASCUNHO"), ("\x06ƌĞĂ\x03ůŝǀƌĞ", "ÁREA LIVRE"), ("\x03", " ")]

HEAD_RE = re.compile(r"^QUEST[^0-9]{1,3}?(DISCURSIVA)?(\d{1,2})(?:[-–—]?DISCURSIVA)?$")
CUT_RE = re.compile(r"^(RASCUNHO|[ÁA]REALIVRE)")
PREFIX_RE = re.compile(r"PARA\s+RESPONDER\s+[ÀA]S?\s+QUEST[ÃA]O\s+0*(\d+)", re.I)
BANNER_RE = re.compile(r"ATEN[ÇC][ÃA]O|LEIA ATENTAMENTE|SER[ÃA]O APRESENTADAS|PREZADO|"
                       r"QUEST[ÕO]ES DE \d+ A \d+|A SEGUIR,? S[ÃA]O ESPEC", re.I)


def norm(t):
    for a, b in GLYPH_FIX:
        t = t.replace(a, b)
    # dígitos deslocados (U+03EC.. -> '0'..)
    t = "".join(chr(ord(c) - 0x3BC) if 0x3EC <= ord(c) <= 0x3F5 else c for c in t)
    return re.sub(r"\s+", "", t).upper()


def page_lines(page):
    out = []
    for b in page.get_text("dict")["blocks"]:
        if b["type"] == 1:  # imagem
            out.append(dict(bbox=b["bbox"], text="", img=True))
            continue
        for l in b.get("lines", []):
            t = "".join(s["text"] for s in l["spans"])
            out.append(dict(bbox=l["bbox"], text=t, img=False))
    return out


class Page:
    def __init__(self, doc, idx, cfg, lmargin, rmargin):
        self.idx = idx
        self.page = doc[idx]
        self.W = self.page.rect.width
        self.top, self.bottom = cfg["top"], cfg["bottom"]
        self.L, self.R = lmargin, rmargin
        self.lines = page_lines(self.page)
        self.heads = []
        self.boundary = self.W / 2

    def xr(self, col):
        return {"F": (self.L, self.R), "L": (self.L, self.boundary), "R": (self.boundary, self.R)}[col]


def find_heads(doc, cfg, ano):
    heads = []
    for i in range(1, cfg["last_page"]):
        for ln in page_lines(doc[i]):
            if ln["img"]:
                continue
            m = HEAD_RE.fullmatch(norm(ln["text"]))
            if not m:
                continue
            tail = norm(ln["text"])
            kind = "D" if "DISCURSIVA" in tail else "Q"
            heads.append(dict(page=i, x=ln["bbox"][0], y=ln["bbox"][1], kind=kind, n=int(m.group(2))))
    # ordena pela posição no caderno: página, depois numeração
    heads.sort(key=lambda h: (h["page"], h["n"]))
    # remove duplicatas (mesmo rótulo)
    seen, out = set(), []
    for h in heads:
        key = (h["kind"], h["n"]) if not cfg["unified"] else h["n"]
        if key in seen:
            continue
        seen.add(key)
        out.append(h)
    return out


def classify(pages, heads):
    for h in heads:
        pages[h["page"]].heads.append(h)
    for p in pages.values():
        rights = [h["x"] for h in p.heads if h["x"] > p.W * 0.4]
        p.boundary = find_boundary(p, min(rights) - 5 if rights else p.W / 2)
        for h in p.heads:
            if h["kind"] == "D" or not rights:
                # discursivas e páginas sem questão na coluna direita: largura total
                h["col"] = "F"
                continue
            if h["x"] > p.W * 0.4:
                h["col"] = "R"
                continue
            below = [o["y"] for o in p.heads if o["y"] > h["y"] + 5]
            y_end = min(below) if below else p.bottom
            side_by_side = any(o["x"] > p.W * 0.4 and abs(o["y"] - h["y"]) < 40 for o in p.heads)
            span = sum(1 for ln in p.lines
                       if h["y"] + 8 < ln["bbox"][1] < y_end
                       and ln["bbox"][0] < p.boundary - 30 and ln["bbox"][2] > p.boundary + 30)
            h["col"] = "F" if (span >= 2 and not side_by_side) else "L"


def find_boundary(p, hint):
    """x da divisão entre colunas: posição perto do centro cruzada pelo menor número de linhas."""
    best = None
    for x in range(int(p.W * 0.42), int(p.W * 0.58)):
        c = sum(1 for ln in p.lines if not ln["img"] and ln["bbox"][0] < x < ln["bbox"][2])
        key = (c, abs(x - hint))
        if best is None or key < best[0]:
            best = (key, x)
    return best[1]


def col_bottom(p, y):
    fulls = [h["y"] for h in p.heads if h["col"] == "F" and h["y"] > y + 5]
    return min(fulls) - 3 if fulls else p.bottom


def right_start(p, s):
    """Início da coluna direita que continua a questão s (que começou na coluna esquerda).
    Se acima de s houver conteúdo de largura total (questão ou aviso), a coluna começa em s."""
    if any(h["col"] == "F" and h["y"] < s["y"] for h in p.heads):
        return s["y"] - 3
    crossing = [ln["bbox"][3] for ln in p.lines
                if p.top <= ln["bbox"][1] < s["y"] - 2 and ln["bbox"][0] < p.boundary - 30
                and ln["bbox"][2] > p.boundary + 30]
    return max(crossing) + 2 if crossing else p.top


def segments(pages, s, n, cfg):
    p = pages[s["page"]]
    y0 = s["y"] - 4
    segs = []
    if n and n["page"] == s["page"]:
        if s["col"] == "L" and n["col"] == "R":
            segs.append((p, "L", y0, col_bottom(p, s["y"])))
            rt = right_start(p, s)
            # no topo da página exige folga maior (evita pegar só o cabeçalho de seção)
            if n["y"] - rt > (45 if rt == p.top else 10):
                segs.append((p, "R", rt, n["y"] - 4))
        elif s["col"] == "R" and n["col"] != "R":
            segs.append((p, "R", y0, p.bottom))
        else:
            segs.append((p, s["col"], y0, n["y"] - 4))
        return segs
    # a questão termina em outra página
    if s["col"] == "F":
        segs.append((p, "F", y0, p.bottom))
    elif s["col"] == "L":
        segs.append((p, "L", y0, col_bottom(p, s["y"])))
        rt = right_start(p, s)
        segs.append((p, "R", rt, p.bottom))
    else:
        segs.append((p, "R", y0, p.bottom))
    end_page = n["page"] if n else s["page"] + 1
    for q in range(s["page"] + 1, min(end_page, cfg["last_page"])):
        if q in pages:
            segs.append((pages[q], "F", pages[q].top, pages[q].bottom))
    if n and n["page"] in pages:
        q = pages[n["page"]]
        if n["y"] - q.top > 45:
            if n["col"] == "R":
                segs += [(q, "L", q.top, q.bottom), (q, "R", q.top, n["y"] - 4)]
            else:
                segs.append((q, "F", q.top, n["y"] - 4))
    return segs


def render(page, rect):
    pix = page.get_pixmap(matrix=fitz.Matrix(ZOOM, ZOOM), clip=rect, alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def trim(im, pad=10):
    bg = Image.new("RGB", im.size, (255, 255, 255))
    diff = ImageChops.difference(im, bg).convert("L").point(lambda v: 255 if v > 40 else 0)
    box = diff.getbbox()
    if not box:
        return None
    x0, y0, x1, y1 = box
    return im.crop((max(0, x0 - pad), max(0, y0 - pad), min(im.width, x1 + pad), min(im.height, y1 + pad)))


def stack(images, gap=14):
    images = [i for i in images if i is not None]
    if not images:
        return None
    W = max(i.width for i in images)
    H = sum(i.height for i in images) + gap * (len(images) - 1)
    out = Image.new("RGB", (W, H), "white")
    y = 0
    for i in images:
        out.paste(i, (0, y))
        y += i.height + gap
    return out


def cut_y(p, x0, x1, y0, y1):
    """Retorna o y do quadro RASCUNHO/Área livre dentro do retângulo, se houver."""
    ys = []
    for ln in p.lines:
        bx0, by0, bx1, _ = ln["bbox"]
        if y0 < by0 < y1 and bx0 >= x0 - 5 and bx1 <= x1 + 5 and CUT_RE.match(norm(ln["text"])):
            ys.append(by0 - 4)
    return min(ys) if ys else None


def region_text(p, x0, x1, y0, y1):
    return " ".join(ln["text"] for ln in p.lines
                    if y0 <= ln["bbox"][1] <= y1 and ln["bbox"][0] >= x0 - 5 and ln["bbox"][2] <= x1 + 5)


def build_question_image(segs, cfg, is_disc):
    imgs = []
    for k, (p, col, y0, y1) in enumerate(segs):
        x0, x1 = p.xr(col)
        if y1 - y0 < 12:
            continue
        if k > 0 and BANNER_RE.search(region_text(p, x0, x1, y0, y1)):
            break  # chegou a um aviso de troca de seção
        stop = False
        if cfg["cut_rascunho"] or not is_disc:
            c = cut_y(p, x0, x1, y0, y1)
            if c is not None and col == "F" and cut_y(p, p.boundary, x1, y0, y1) == c:
                # quadro de rascunho ocupando a coluna direita: fica só a coluna esquerda
                x1 = p.boundary
                c = cut_y(p, x0, x1, y0, y1)
            if c is not None:
                y1, stop = c, True
        imgs.append(trim(render(p.page, fitz.Rect(x0, y0, x1, y1))))
        if stop:
            break
    return stack(imgs)


# ---------------------------------------------------------------------------
# Padrão de resposta
# ---------------------------------------------------------------------------
STOP_PADRAO = re.compile(r"^(PADR[ÃA]O DE RESPOSTA|QUEST[ÃA]O( DISCURSIVA)?\s*\d+|Quest[ãa]o\s+\d+|"
                         r"CI[ÊE]NCIA DA COMPUTA.*|FORMA[ÇC][ÃA]O GERAL)\s*$")


def padrao_regions(doc, cfg):
    """Lista [(chave, [(page, y0, y1)...])] na ordem em que aparecem no PDF."""
    anchors = []  # (page, y, tipo, numero)
    for i, page in enumerate(doc):
        for ln in page_lines(page):
            t = re.sub(r"\s+", " ", ln["text"]).strip()
            if not t or ln["img"]:
                continue
            if HEAD_RE.fullmatch(norm(t)) and not STOP_PADRAO.match(t):
                anchors.append((i, ln["bbox"][1], "stop", None))  # título com fonte sem Unicode
            elif STOP_PADRAO.match(t):
                tipo = "start" if (
                    (cfg["padrao"] == "sequencial" and re.fullmatch(r"PADR[ÃA]O DE RESPOSTA", t))
                    or (cfg["padrao"] == "numerado" and re.fullmatch(cfg["padrao_re"], t, re.I))) else "stop"
                num = None
                if cfg["padrao"] == "numerado" and tipo == "start":
                    num = int(re.fullmatch(cfg["padrao_re"], t, re.I).group(1))
                anchors.append((i, ln["bbox"][1], tipo, num))
    anchors.sort()
    regions = []
    for k, (pg, y, tipo, num) in enumerate(anchors):
        if tipo != "start":
            continue
        nxt = anchors[k + 1] if k + 1 < len(anchors) else (len(doc) - 1, 10_000, "end", None)
        if nxt[2] == "start":
            # o enunciado da próxima questão costuma vir como imagem logo antes do próximo
            # "PADRÃO DE RESPOSTA": o padrão atual termina no topo dessa imagem
            nxt = enunciado_antes(doc, (pg, y), nxt)
        parts = []
        for q in range(pg, nxt[0] + 1):
            ph = doc[q].rect.height
            a = y - 4 if q == pg else 0
            b = nxt[1] - 4 if q == nxt[0] else ph
            parts.append((q, a, min(b, ph)))
        regions.append((num, parts))
    return regions


def is_marker(t):
    return re.fullmatch(r"\d{1,2}|NOVEMBRO \| \d\d|CI[ÊE]NCIA DA COMPUTA[ÇC][ÃA]O.*|Bacharelado|"
                        r"COMPUTA[ÇC][ÃA]O|FORMA[ÇC][ÃA]O GERAL", t.strip())


def enunciado_antes(doc, inicio, nxt):
    """Se o último elemento antes da âncora nxt for uma imagem grande, devolve uma âncora no topo dela."""
    q, y_lim = nxt[0], nxt[1]
    while q >= inicio[0]:
        items = []
        for ln in page_lines(doc[q]):
            y0 = ln["bbox"][1]
            if y0 >= y_lim - 1 or (q == inicio[0] and y0 <= inicio[1] + 2):
                continue
            if not ln["img"] and (not ln["text"].strip() or is_marker(ln["text"])):
                continue
            items.append(ln)
        if items:
            last = max(items, key=lambda ln: ln["bbox"][3])
            if last["img"] and last["bbox"][3] - last["bbox"][1] > 40:
                return (q, last["bbox"][1], "stop", None)
            return nxt
        q, y_lim = q - 1, 10_000  # nada antes da âncora nesta página: olha a anterior
    return nxt


def page_content_box(page):
    """Faixa vertical útil (ignora números de página/rodapé)."""
    H = page.rect.height
    top, bot = 0, H
    for ln in page_lines(page):
        t = ln["text"].strip()
        x0, y0, x1, y1 = ln["bbox"]
        if ln["img"] and y0 > 0.85 * H and (y1 - y0) < 0.1 * H:
            bot = min(bot, y0 - 2)  # logotipo no rodapé
            continue
        mk = is_marker(t)
        if mk and y1 < 0.10 * H:
            top = max(top, y1 + 2)
        if mk and y0 > 0.90 * H:
            bot = min(bot, y0 - 2)
    # logotipos vetoriais no rodapé
    for dr in page.get_drawings():
        if dr["rect"].y0 > 0.92 * H:
            bot = min(bot, dr["rect"].y0 - 2)
    return top, bot


def render_padrao(doc, parts):
    imgs = []
    for q, a, b in parts:
        page = doc[q]
        top, bot = page_content_box(page)
        a, b = max(a, top), min(b, bot)
        if b - a < 15:
            continue
        imgs.append(trim(render(page, fitz.Rect(0, a, page.rect.width, b)), pad=14))
    return stack(imgs)


# ---------------------------------------------------------------------------
# Gabarito
# ---------------------------------------------------------------------------
def parse_gabarito(path):
    lines = []
    for page in fitz.open(path):
        lines += [re.sub(r"\s+", " ", t).strip() for t in page.get_text().split("\n")]
    lines = [t for t in lines if t]
    gab = {}
    for i, t in enumerate(lines[:-1]):
        m = re.fullmatch(r"(?:QUEST[ÃA]O )?(\d{1,2})(?: -)?", t, re.I)
        if not m:
            continue
        ans = lines[i + 1].upper()
        if re.fullmatch(r"[A-E]|ANULADA", ans):
            gab.setdefault(int(m.group(1)), ans)
    return gab


def save(im, rel):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    im.save(path, "WEBP", quality=WEBP_QUALITY, method=6)
    return rel.replace(os.sep, "/")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdfs", required=True, help="pasta com os PDFs (Simulado)")
    ap.add_argument("--anos", default=",".join(PROVAS))
    args = ap.parse_args()

    meta_path = os.path.join(ROOT, "tools", "provas_meta.json")
    meta = json.load(open(meta_path, encoding="utf-8"))

    provas, seed = [], []
    for ano in args.anos.split(","):
        cfg = PROVAS[ano]
        pv = fitz.open(os.path.join(args.pdfs, f"{ano}_PV_bacharelado_ciencia_computacao.pdf"))
        gab = parse_gabarito(os.path.join(args.pdfs, f"{ano}_GB_bacharelado_ciencia_computacao.pdf"))

        heads = find_heads(pv, cfg, ano)
        xs = [h["x"] for h in heads if h["x"] < pv[1].rect.width * 0.4]
        lm = min(xs) - 6
        rm = pv[1].rect.width - lm + 4
        pages = {i: Page(pv, i, cfg, lm, rm) for i in range(1, cfg["last_page"])}
        classify(pages, heads)

        questoes = []
        n_obj = 0
        prefix = None
        for k, h in enumerate(heads):
            nxt = heads[k + 1] if k + 1 < len(heads) else None
            segs = segments(pages, h, nxt, cfg)
            pre, prefix = prefix, None
            # bloco de apoio do tipo "Observe os gráficos ... para responder à questão N"
            if nxt and segs:
                p_, c_, a_, b_ = segs[-1]
                if p_.idx == nxt["page"] and abs(b_ - (nxt["y"] - 4)) < 1:
                    m = PREFIX_RE.search(region_text(p_, *p_.xr(c_), a_, b_))
                    if m and int(m.group(1)) == nxt["n"]:
                        prefix = segs.pop()
            if pre:
                segs = [pre] + segs
            sec = cfg["secao"](h["kind"], h["n"])
            if not sec:
                continue
            qid = f"{ano}-{h['kind']}{h['n']:02d}"
            img = build_question_image(segs, cfg, h["kind"] == "D")
            if img is None:
                print("  !! sem imagem", qid)
                continue
            rel = save(img, os.path.join("data", "img", ano, f"{h['kind']}{h['n']:02d}.webp"))
            q = dict(id=qid, ano=int(ano), tipo="discursiva" if h["kind"] == "D" else "objetiva",
                     numero=h["n"], rotulo=("Questão Discursiva " if h["kind"] == "D" and not cfg["unified"]
                                            else "Questão ") + str(h["n"]) +
                     (" (discursiva)" if h["kind"] == "D" and cfg["unified"] else ""),
                     componente=sec[0], secao=sec[1], img=rel, largura=img.width)
            if h["kind"] == "Q":
                g = gab.get(h["n"])
                if not g:
                    print("  !! sem gabarito", qid)
                q["anulada"] = g == "ANULADA"
                if g:
                    seed.append((qid, int(ano), sec[0], g))
                n_obj += 1
            questoes.append(q)

        # padrões de resposta
        disc = [q for q in questoes if q["tipo"] == "discursiva"]
        extra = meta.get(ano, {}).get("padroes_texto", {})
        pr_path = os.path.join(args.pdfs, f"{ano}_bacharelado_ciencia_computacao.pdf")
        if cfg["padrao"] != "texto" and os.path.exists(pr_path):
            pr = fitz.open(pr_path)
            regs = padrao_regions(pr, cfg)
            if cfg["padrao"] == "sequencial":
                regs = [(d["numero"], r[1]) for d, r in zip(disc, regs)]
            by_num = {num: parts for num, parts in regs}
            for d in disc:
                parts = by_num.get(d["numero"])
                if parts:
                    im = render_padrao(pr, parts)
                    if im:
                        d["padrao"] = dict(oficial=True, img=save(im, os.path.join(
                            "data", "img", ano, "padrao", f"D{d['numero']:02d}.webp")), largura=im.width)
        for d in disc:
            if str(d["numero"]) in extra:
                d["padrao"] = extra[str(d["numero"])]
            if "padrao" in d and "fonte" not in d["padrao"]:
                d["padrao"]["fonte"] = "INEP – padrão de resposta oficial"
            if "padrao" not in d:
                print("  !! sem padrão de resposta", d["id"])

        info = meta.get(ano, {})
        provas.append(dict(ano=int(ano), titulo=f"ENADE {ano} – Ciência da Computação",
                           observacao=info.get("observacao", ""), duracao_min=240,
                           total_objetivas=n_obj, total_discursivas=len(disc), questoes=questoes))
        print(f"{ano}: {n_obj} objetivas, {len(disc)} discursivas "
              f"(gabarito lido: {len(gab)} itens)")

    with open(os.path.join(ROOT, "data", "provas.json"), "w", encoding="utf-8") as f:
        json.dump(dict(gerado_por="tools/build_questions.py", provas=provas), f, ensure_ascii=False, indent=1)

    with open(os.path.join(ROOT, "supabase", "seed_gabarito.sql"), "w", encoding="utf-8") as f:
        f.write("-- Gerado por tools/build_questions.py — gabaritos oficiais (INEP)\n")
        f.write("-- Execute DEPOIS de supabase/schema.sql\n")
        f.write("insert into public.gabarito (questao_id, ano, componente, resposta) values\n")
        f.write(",\n".join(f"  ('{q}', {a}, '{c}', '{g}')" for q, a, c, g in seed))
        f.write("\non conflict (questao_id) do update set ano = excluded.ano,\n"
                "  componente = excluded.componente, resposta = excluded.resposta;\n")


if __name__ == "__main__":
    sys.exit(main())
