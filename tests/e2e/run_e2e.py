"""Teste de ponta a ponta do site no Microsoft Edge (Playwright), com um Supabase simulado em memória.

Uso: pip install playwright && python tests/e2e/run_e2e.py   (capturas de tela em tests/e2e/screenshots)
"""
import functools, http.server, json, os, re, sys, threading
from playwright.sync_api import sync_playwright, expect

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(HERE))
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, "screenshots")
os.makedirs(OUT, exist_ok=True)

gab = {}
for m in re.finditer(r"\('([\w-]+)', (\d+), '(\w+)', '(\w+)'\)", open(os.path.join(REPO, "supabase", "seed_gabarito.sql"), encoding="utf-8").read()):
    gab[m.group(1)] = {"ano": int(m.group(2)), "componente": m.group(3), "resposta": m.group(4)}

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass
Handler = functools.partial(Quiet, directory=REPO)
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8765), Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:8765/"

FAKE = open(os.path.join(HERE, "fake_supabase.js"), encoding="utf-8").read()
CONFIG = 'export const SUPABASE_URL="https://teste.supabase.co";export const SUPABASE_ANON_KEY="chave-teste";export const INSTITUICAO="Ciência da Computação · UFOP";'
erros = []
passos = 0

def ok(msg):
    global passos
    passos += 1
    print("  OK ", msg)

import atexit
atexit.register(lambda: [print('  JS:', e) for e in erros])
with sync_playwright() as pw:
    nav = pw.chromium.launch(channel="msedge", headless=True)
    ctx = nav.new_context(viewport={"width": 1366, "height": 900}, locale="pt-BR")
    ctx.add_init_script(f"window.__GABARITO__ = {json.dumps(gab)};")
    ctx.route("**/cdn.jsdelivr.net/**", lambda r: r.fulfill(status=200, content_type="text/javascript", body=FAKE))
    ctx.route("**/assets/js/config.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body=CONFIG))
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: erros.append(f"pageerror: {e}"))
    pg.on("console", lambda m: m.type == "error" and erros.append(f"console: {m.text}"))
    pg.on("dialog", lambda d: d.accept())

    # 1. Login e cadastro
    pg.goto(BASE + "index.html")
    expect(pg.get_by_role("button", name=re.compile("Entrar com GitHub"))).to_be_visible()
    pg.screenshot(path=f"{OUT}/01_login.png")
    ok("tela de login")
    pg.get_by_role("button", name=re.compile("Entrar com GitHub")).click()
    expect(pg.get_by_text("Complete seu cadastro")).to_be_visible()
    pg.fill("#nome", "Ana Souza")
    pg.fill("#matricula", "21.1.4001")
    pg.get_by_role("button", name="Salvar e continuar").click()
    expect(pg.get_by_text("Olá, Ana!")).to_be_visible()
    expect(pg.locator(".prova")).to_have_count(6)
    pg.screenshot(path=f"{OUT}/02_inicio.png", full_page=True)
    ok("cadastro e lista de 6 provas")

    # 2. Inicia ENADE 2021 completa
    card = pg.locator(".prova", has_text="ENADE 2021")
    card.get_by_role("button", name="Iniciar").click()
    expect(pg.get_by_role("heading", name="Questão Discursiva 1")).to_be_visible()
    expect(pg.locator(".btn-q")).to_have_count(40)
    img = pg.locator(".area-imagem img")
    expect(img).to_be_visible()
    assert pg.evaluate("document.querySelector('.area-imagem img').naturalWidth") > 300
    ok("simulado abre com 40 questões e imagem carregada")
    pg.fill("textarea", "Arte e cultura se tensionam; a Constituição garante a liberdade artística.")
    expect(pg.locator(".status-salvo")).to_contain_text("Salvo", timeout=5000)
    ok("discursiva salva automaticamente")
    pg.screenshot(path=f"{OUT}/03_discursiva.png", full_page=True)

    pg.locator(".btn-q", has_text=re.compile(r"^1$")).click()
    expect(pg.get_by_role("heading", name="Questão 1")).to_be_visible()
    pg.keyboard.press("e")
    expect(pg.locator(".alt.marcada")).to_have_text("E")
    ok("atalho de teclado marca alternativa")
    pg.keyboard.press("ArrowRight")
    expect(pg.get_by_role("heading", name="Questão 2")).to_be_visible()
    pg.get_by_role("button", name="A", exact=True).click()
    expect(pg.locator(".alt.marcada")).to_have_text("A")
    pg.get_by_role("button", name=re.compile("Marcar para revisar")).click()
    expect(pg.locator(".btn-q.marcada")).to_have_count(1)
    pg.screenshot(path=f"{OUT}/04_objetiva.png", full_page=True)
    ok("clique marca alternativa e marcação para revisar")

    # 3. Sai e continua depois
    pg.goto(BASE + "index.html")
    expect(pg.get_by_text("Em andamento")).to_be_visible()
    pg.locator(".prova", has_text="ENADE 2021").get_by_role("button", name="Continuar").click()
    expect(pg.get_by_role("heading", name="Questão 2")).to_be_visible()
    expect(pg.locator(".btn-q.respondida")).to_have_count(3)
    ok("continua de onde parou com as respostas salvas")

    # 4. Finaliza
    pg.get_by_role("button", name="Finalizar prova").first.click()
    expect(pg.get_by_role("heading", name="Resultado – ENADE 2021")).to_be_visible()
    expect(pg.locator(".kpi").first).to_contain_text("1/33")
    pg.screenshot(path=f"{OUT}/05_resultado.png", full_page=True)
    ok("resultado 1/33 (Q1 certa, Q2 errada, 2 anuladas fora do total)")
    pg.locator(".btn-q", has_text=re.compile(r"^2$")).click()
    expect(pg.locator(".alt.certa")).to_have_text("C")
    expect(pg.locator(".alt.errada")).to_have_text("A")
    ok("revisão mostra gabarito oficial e erro")
    pg.locator(".btn-q", has_text="D1").click()
    expect(pg.get_by_text("Oficial INEP")).to_be_visible()
    expect(pg.locator(".padrao img")).to_be_visible()
    pg.get_by_role("button", name="Salvar autoavaliação").click()
    expect(pg.get_by_text("Autoavaliação salva.")).to_be_visible()
    pg.screenshot(path=f"{OUT}/06_padrao.png", full_page=True)
    ok("padrão de resposta oficial e autoavaliação")

    # 5. Padrão não oficial (2005, só Formação Geral)
    pg.goto(BASE + "index.html")
    card = pg.locator(".prova", has_text="ENADE 2005")
    card.locator("select").select_option("especifico")
    card.get_by_role("button", name="Iniciar").click()
    expect(pg.locator(".btn-q")).to_have_count(30)
    pg.get_by_role("button", name="Finalizar prova").first.click()
    expect(pg.get_by_role("heading", name="Resultado – ENADE 2005")).to_be_visible()
    expect(pg.locator(".kpi").first).to_contain_text("0/28")
    pg.locator(".btn-q", has_text="D70").click()
    expect(pg.get_by_text("Não oficial")).to_be_visible()
    pg.screenshot(path=f"{OUT}/07_nao_oficial.png", full_page=True)
    ok("modo específico 2005 (28 objetivas) e padrão não oficial")

    # 6. Painel do professor
    pg.evaluate("localStorage.setItem('fakeuser', 'u-prof1')")
    pg.goto(BASE + "professor.html")
    expect(pg.get_by_role("heading", name="Painel do professor")).to_be_visible()
    expect(pg.locator(".kpi").nth(2)).to_contain_text("2")
    pg.screenshot(path=f"{OUT}/08_prof_resumo.png", full_page=True)
    ok("resumo do painel")
    pg.get_by_role("button", name="Alunos").click()
    expect(pg.get_by_text("21.1.4001")).to_be_visible()
    with pg.expect_download() as dl:
        pg.get_by_role("button", name="Exportar CSV").click()
    csv = open(dl.value.path(), encoding="utf-8-sig").read()
    assert "Ana Souza" in csv and "21.1.4001" in csv, csv
    ok("lista de alunos e exportação CSV")
    pg.get_by_role("button", name="Tentativas").click()
    pg.get_by_role("button", name="Ver").first.click()
    expect(pg.locator(".modal")).to_be_visible()
    pg.screenshot(path=f"{OUT}/09_prof_tentativa.png")
    pg.keyboard.press("Escape")
    ok("detalhe de tentativa")
    pg.get_by_role("button", name="Discursivas").click()
    expect(pg.locator(".disc-item")).to_have_count(1)
    pg.locator(".disc-item input[type=number]").fill("8.5")
    pg.locator(".disc-item textarea").fill("Boa articulação entre os textos.")
    pg.get_by_role("button", name="Salvar avaliação").click()
    expect(pg.get_by_text("Avaliação salva.")).to_be_visible()
    pg.screenshot(path=f"{OUT}/10_prof_discursivas.png", full_page=True)
    ok("professor avalia discursiva")
    pg.get_by_role("button", name="Questões").click()
    pg.locator(".filtros select").first.select_option("2021")
    expect(pg.locator("tbody tr")).to_have_count(35)
    pg.screenshot(path=f"{OUT}/11_prof_questoes.png", full_page=True)
    ok("índice de acerto por questão")
    pg.get_by_role("button", name="Professores").click()
    pg.fill("input[placeholder^='usuário']", "aluno1")
    pg.get_by_role("button", name="Incluir").click()
    expect(pg.get_by_text("aluno1 agora é professor.")).to_be_visible()
    ok("inclusão de professor")

    # 7. Aluno vê a nota do professor
    pg.evaluate("localStorage.setItem('fakeuser', 'u-aluno1')")
    d = pg.evaluate("JSON.parse(localStorage.getItem('fakedb'))")
    t2021 = next(t for t in d["tentativas"] if t["ano"] == 2021)
    pg.goto(BASE + f"simulado.html?t={t2021['id']}")
    pg.locator(".btn-q", has_text="D1").click()
    expect(pg.get_by_text("Avaliação do professor: 8,5 / 10")).to_be_visible()
    ok("aluno vê a avaliação do professor")

    # 8. Celular
    m = ctx.new_page()
    m.on("pageerror", lambda e: erros.append(f"pageerror: {e}"))
    m.set_viewport_size({"width": 390, "height": 844})
    m.goto(BASE + f"simulado.html?t={t2021['id']}")
    m.locator(".btn-q", has_text=re.compile(r"^5$")).click()
    m.screenshot(path=f"{OUT}/12_celular.png", full_page=True)
    ok("layout em celular")
    nav.close()
srv.shutdown()
print(f"\n{passos} passos OK")
print("ERROS DE JAVASCRIPT:" if erros else "Sem erros de JavaScript.")
for e in erros:
    print("  ", e)
sys.exit(1 if erros else 0)
