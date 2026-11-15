// TV de Anúncios — toca sem parar os comerciais no ar nos EUA.
// Dados (iSpot + vídeo do YouTube) vêm de dados.json, atualizado todo dia pelo robô do GitHub.
const FONTES_DADOS = [
  "https://raw.githubusercontent.com/0gusth/tv-de-anuncios/main/dados.json",
  "dados.json",
];
const YT_LIMITE_INICIO_MS = 10000;
const DIAS_NOVO = 7;
const HORAS_SEM_REPETIR = 20;

const $ = (id) => document.getElementById(id);
const tv = $("tv"), ytBox = $("yt");
let lista = [], inicio = null, atual = null, historico = [];
let sessao = 0, ytFrame = null, ouvinte = null;

// ---------- preferências guardadas neste navegador ----------
function lerLS(chave, padrao) { try { const v = localStorage.getItem(chave); return v === null ? padrao : JSON.parse(v); } catch (e) { return padrao; } }
function gravarLS(chave, valor) { try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) {} }
let somLigado = lerLS("somLigado", false);
let soCriativos = lerLS("soCriativos", true);
let filtroCategoria = lerLS("filtroCategoria", "");
let filtroAgencia = lerLS("filtroAgencia", "");
let vistos = lerLS("vistos", {});          // id → quando passou
let salvos = lerLS("salvos", []);          // filmes guardados

// ---------- regras ----------
const dia = (iso) => (iso || "").slice(0, 10);
function ehNovo(ad) {
  if (!ad.primeiraVez || !inicio) return false;
  return dia(ad.primeiraVez) > dia(inicio) && Date.now() - new Date(ad.primeiraVez) < DIAS_NOVO * 864e5;
}
function passaNoFiltro(ad) {
  if (soCriativos && ad.oferta) return false;
  if (filtroCategoria && ad.categoria !== filtroCategoria) return false;
  if (filtroAgencia && ad.agencia !== filtroAgencia) return false;
  return true;
}
function embaralhar(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
// ordem: novos não vistos → não vistos → já vistos (o mais antigo primeiro)
function escolherProximo() {
  const limite = Date.now() - HORAS_SEM_REPETIR * 36e5;
  const cand = lista.filter((a) => passaNoFiltro(a) && (!atual || a.id !== atual.id));
  if (!cand.length) return null;
  const naoVistos = cand.filter((a) => !vistos[a.id] || vistos[a.id] < limite);
  const novos = naoVistos.filter(ehNovo);
  if (novos.length) return embaralhar(novos)[0];
  if (naoVistos.length) return embaralhar(naoVistos)[0];
  return cand.slice().sort((a, b) => (vistos[a.id] || 0) - (vistos[b.id] || 0))[0];
}

// ---------- players ----------
function pararTudo() {
  tv.pause(); tv.removeAttribute("src"); tv.load(); tv.style.display = "none";
  if (ytFrame) { ytFrame.remove(); ytFrame = null; }
  if (ouvinte) { window.removeEventListener("message", ouvinte); ouvinte = null; }
  ytBox.style.display = "none";
}
function comandoYT(func, args) {
  if (ytFrame && ytFrame.contentWindow)
    ytFrame.contentWindow.postMessage(JSON.stringify({ event: "command", func, args: args || [] }), "*");
}
function tocarISpot(ad, s) {
  if (s !== sessao) return;
  pararTudo();
  $("fonte").textContent = "vídeo: iSpot";
  tv.style.display = "block";
  tv.muted = !somLigado;
  tv.src = ad.video;
  tv.play().catch(() => { tv.muted = true; marcarSom(false); tv.play().catch(() => {}); });
}
function tocarYouTube(ad, s) {
  pararTudo();
  $("fonte").textContent = "vídeo: YouTube" + (ad.ytCanal ? " · " + ad.ytCanal : "");
  ytBox.style.display = "block";
  const f = document.createElement("iframe");
  f.allow = "autoplay; encrypted-media; fullscreen";
  f.src = `https://www.youtube.com/embed/${ad.yt}?enablejsapi=1&autoplay=1&mute=1&controls=0&rel=0` +
    `&iv_load_policy=3&cc_load_policy=0&disablekb=1&playsinline=1&origin=${encodeURIComponent(location.origin)}`;
  f.addEventListener("load", () =>
    f.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*"));
  ytBox.appendChild(f);
  ytFrame = f;
  let comecou = false;
  const desistir = () => { if (s === sessao) tocarISpot(ad, s); };
  const limite = setTimeout(() => { if (!comecou) desistir(); }, YT_LIMITE_INICIO_MS);
  ouvinte = (e) => {
    if (s !== sessao || e.source !== f.contentWindow) return;
    let d; try { d = JSON.parse(e.data); } catch (x) { return; }
    if (d.event === "onError") { clearTimeout(limite); desistir(); return; }
    const estado = d.info && typeof d.info.playerState === "number" ? d.info.playerState : null;
    if (estado === 1 && !comecou) {
      comecou = true; clearTimeout(limite);
      comandoYT("unloadModule", ["captions"]);
      if (somLigado) comandoYT("unMute");
    }
    if (estado === 0) proximo();
  };
  window.addEventListener("message", ouvinte);
}

function tocar(ad) {
  atual = ad;
  const s = ++sessao;
  vistos[ad.id] = Date.now();
  gravarLS("vistos", vistos);
  $("aviso").style.display = "none";
  $("anunciante").textContent = ad.anunciante || "";
  $("novo").style.display = ehNovo(ad) ? "inline-block" : "none";
  $("titulo").textContent = ad.titulo || "";
  $("agencia").textContent = ad.agencia ? "Agência: " + ad.agencia : "";
  atualizarBotaoSalvar();
  if (ad.yt) tocarYouTube(ad, s); else tocarISpot(ad, s);
}

function proximo() {
  const ad = escolherProximo();
  if (!ad) {
    pararTudo(); atual = null;
    $("aviso").textContent = "Nenhum filme com esses filtros.";
    $("aviso").style.display = "flex";
    return;
  }
  if (atual) { historico.push(atual); if (historico.length > 50) historico.shift(); }
  tocar(ad);
}
function anterior() {
  const ad = historico.pop();
  if (ad) tocar(ad);
}

// ---------- som ----------
function marcarSom(ligado) {
  somLigado = ligado;
  $("som").textContent = ligado ? "🔊 Som" : "🔇 Som";
  gravarLS("somLigado", ligado);
}
$("som").addEventListener("click", () => {
  marcarSom(!somLigado);
  tv.muted = !somLigado;
  if (somLigado && tv.style.display === "block") tv.play().catch(() => {});
  comandoYT(somLigado ? "unMute" : "mute");
});

// ---------- filtros ----------
function contar(campo) {
  const n = {};
  for (const a of lista) if (a[campo] && (!soCriativos || !a.oferta)) n[a[campo]] = (n[a[campo]] || 0) + 1;
  return Object.entries(n).sort((a, b) => a[0].localeCompare(b[0]));
}
function montarFiltros() {
  $("criativo").classList.toggle("ativo", soCriativos);
  const cat = $("filtroCategoria");
  cat.innerHTML = `<option value="">Todas as categorias</option>` +
    contar("categoria").map(([c, n]) => `<option value="${esc(c)}">${esc(c)} (${n})</option>`).join("");
  cat.value = filtroCategoria;
  if (cat.value !== filtroCategoria) { filtroCategoria = ""; cat.value = ""; }
  const ag = $("filtroAgencia");
  ag.innerHTML = `<option value="">Todas as agências</option>` +
    contar("agencia").map(([c, n]) => `<option value="${esc(c)}">${esc(c)} (${n})</option>`).join("");
  ag.value = filtroAgencia;
  if (ag.value !== filtroAgencia) { filtroAgencia = ""; ag.value = ""; }
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

$("criativo").addEventListener("click", () => {
  soCriativos = !soCriativos; gravarLS("soCriativos", soCriativos);
  montarFiltros(); atualizarStatus();
  if (!atual || !passaNoFiltro(atual)) proximo();
});
$("filtroCategoria").addEventListener("change", (e) => {
  filtroCategoria = e.target.value; gravarLS("filtroCategoria", filtroCategoria); atualizarStatus(); proximo();
});
$("filtroAgencia").addEventListener("change", (e) => {
  filtroAgencia = e.target.value; gravarLS("filtroAgencia", filtroAgencia); atualizarStatus(); proximo();
});

// ---------- salvos ----------
const estaSalvo = (ad) => ad && salvos.some((s) => s.id === ad.id);
function atualizarBotaoSalvar() {
  $("salvar").textContent = estaSalvo(atual) ? "♥ Salvo" : "♡ Salvar";
  $("abrirSalvos").textContent = `♥ Salvos (${salvos.length})`;
}
$("salvar").addEventListener("click", () => {
  if (!atual) return;
  if (estaSalvo(atual)) salvos = salvos.filter((s) => s.id !== atual.id);
  else salvos.unshift({ id: atual.id, anunciante: atual.anunciante, titulo: atual.titulo, agencia: atual.agencia || "",
    categoria: atual.categoria || "", yt: atual.yt || "", ispot: atual.ispot || "", salvoEm: new Date().toISOString() });
  gravarLS("salvos", salvos);
  atualizarBotaoSalvar(); desenharSalvos();
});
function linkDe(s) { return s.yt ? `https://www.youtube.com/watch?v=${s.yt}` : (s.ispot || ""); }
function desenharSalvos() {
  const el = $("listaSalvos");
  if (!salvos.length) { el.innerHTML = `<div class="vazio-salvos">Nada salvo ainda. Use “♡ Salvar” na tarja do filme.</div>`; return; }
  el.innerHTML = salvos.map((s, i) => `
    <div class="salvo">
      <div class="a">${esc(s.anunciante)}${s.categoria ? " · " + esc(s.categoria) : ""}</div>
      <div class="t">${esc(s.titulo)}</div>
      ${s.agencia ? `<div class="g">Agência: ${esc(s.agencia)}</div>` : ""}
      <div class="acoes">
        ${s.yt ? `<a href="https://www.youtube.com/watch?v=${esc(s.yt)}" target="_blank" rel="noopener">YouTube</a>` : ""}
        ${s.ispot ? `<a href="${esc(s.ispot)}" target="_blank" rel="noopener">iSpot</a>` : ""}
        <button class="remover" data-i="${i}">remover</button>
      </div>
    </div>`).join("");
}
$("listaSalvos").addEventListener("click", (e) => {
  const b = e.target.closest(".remover");
  if (!b) return;
  salvos.splice(+b.dataset.i, 1); gravarLS("salvos", salvos);
  desenharSalvos(); atualizarBotaoSalvar();
});
$("abrirSalvos").addEventListener("click", () => { desenharSalvos(); $("painel").classList.add("aberto"); });
$("fecharSalvos").addEventListener("click", () => $("painel").classList.remove("aberto"));
$("copiarSalvos").addEventListener("click", async () => {
  const texto = salvos.map((s) => `${s.anunciante} — ${s.titulo}${s.agencia ? " (" + s.agencia + ")" : ""}\n${linkDe(s)}`).join("\n\n");
  try { await navigator.clipboard.writeText(texto); $("copiarSalvos").textContent = "Copiado ✓"; }
  catch (e) { $("copiarSalvos").textContent = "Não deu para copiar"; }
  setTimeout(() => ($("copiarSalvos").textContent = "Copiar lista"), 2000);
});

// ---------- navegação ----------
tv.addEventListener("ended", proximo);
tv.addEventListener("error", () => setTimeout(proximo, 300));
$("proximo").addEventListener("click", proximo);
$("anterior").addEventListener("click", anterior);
document.addEventListener("keydown", (e) => {
  if (e.target.tagName === "SELECT") return;
  if (e.key === "ArrowRight") proximo();
  if (e.key === "ArrowLeft") anterior();
});

function atualizarStatus() {
  const n = lista.filter(passaNoFiltro).length;
  const novos = lista.filter((a) => passaNoFiltro(a) && ehNovo(a)).length;
  $("status").textContent = `No ar nos EUA · ${n} filmes${novos ? ` · ${novos} novos` : ""} · atualizado ` +
    new Date(dadosAtualizado).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

// ---------- início ----------
let dadosAtualizado = null;
(async function iniciar() {
  marcarSom(somLigado);
  let dados = null;
  for (const url of FONTES_DADOS) {
    try { dados = await (await fetch(url, { cache: "no-store" })).json(); if (dados && dados.anuncios) break; }
    catch (e) {}
  }
  if (!dados || !dados.anuncios || !dados.anuncios.length) {
    $("aviso").textContent = "Não consegui carregar a lista de comerciais.";
    $("aviso").style.display = "flex";
    return;
  }
  lista = dados.anuncios;
  inicio = dados.inicio || null;
  dadosAtualizado = dados.atualizado;
  // limpa registros de "visto" antigos
  const corte = Date.now() - 14 * 864e5;
  for (const id in vistos) if (vistos[id] < corte) delete vistos[id];
  montarFiltros();
  atualizarStatus();
  atualizarBotaoSalvar();
  proximo();
})();
