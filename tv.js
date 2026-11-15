// TV de Anúncios — toca em sequência os comerciais no ar nos EUA.
// Os dados (lista do iSpot + vídeo encontrado no YouTube) vêm de dados.json, atualizado todo dia pelo robô do GitHub.
const FONTES_DADOS = [
  "https://raw.githubusercontent.com/0gusth/tv-de-anuncios/main/dados.json", // sempre a versão mais nova
  "dados.json",
];
const YT_LIMITE_INICIO_MS = 10000;   // se o YouTube não começar nesse tempo, toca a versão do iSpot

const $ = (id) => document.getElementById(id);
const tv = $("tv"), ytBox = $("yt");
let lista = [], fila = [], pos = 0, sessao = 0, ytFrame = null, ouvinte = null;
let somLigado = false;
try { somLigado = localStorage.getItem("somLigado") === "1"; } catch (e) {}

function embaralhar(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

function pararTudo() {
  tv.pause(); tv.removeAttribute("src"); tv.load(); tv.style.display = "none";
  if (ytFrame) { ytFrame.remove(); ytFrame = null; }
  if (ouvinte) { window.removeEventListener("message", ouvinte); ouvinte = null; }
  ytBox.style.display = "none";
}

function comandoYT(func) {
  if (ytFrame && ytFrame.contentWindow)
    ytFrame.contentWindow.postMessage(JSON.stringify({ event: "command", func, args: [] }), "*");
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
    `&iv_load_policy=3&disablekb=1&playsinline=1&origin=${encodeURIComponent(location.origin)}`;
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
    if (estado === 1 && !comecou) { comecou = true; clearTimeout(limite); if (somLigado) comandoYT("unMute"); }
    if (estado === 0) proximo();
  };
  window.addEventListener("message", ouvinte);
}

function proximo() {
  if (!lista.length) return;
  if (pos >= fila.length) { fila = embaralhar(lista); pos = 0; }
  const ad = fila[pos++];
  const s = ++sessao;
  $("anunciante").textContent = ad.anunciante || "";
  $("titulo").textContent = ad.titulo || "";
  $("agencia").textContent = ad.agencia ? "Agência: " + ad.agencia : "";
  if (ad.yt) tocarYouTube(ad, s); else tocarISpot(ad, s);
}

tv.addEventListener("ended", proximo);
tv.addEventListener("error", () => setTimeout(proximo, 300));
$("proximo").addEventListener("click", proximo);
document.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") proximo(); });

function marcarSom(ligado) {
  somLigado = ligado;
  $("som").textContent = ligado ? "🔊 Som ligado" : "🔇 Ativar som";
  try { localStorage.setItem("somLigado", ligado ? "1" : "0"); } catch (e) {}
}
$("som").addEventListener("click", () => {
  marcarSom(!somLigado);
  tv.muted = !somLigado;
  if (somLigado && tv.style.display === "block") tv.play().catch(() => {});
  comandoYT(somLigado ? "unMute" : "mute");
});

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
  const yt = lista.filter((a) => a.yt).length;
  $("status").textContent = `No ar nos EUA · ${lista.length} filmes (${yt} do YouTube) · atualizado ` +
    new Date(dados.atualizado).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  proximo();
})();
