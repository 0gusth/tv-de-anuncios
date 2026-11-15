// Robô diário da TV de Anúncios.
// 1) lê no iSpot a lista de comerciais no ar nos EUA (título, anunciante, agência criativa, vídeo de reserva)
// 2) procura cada filme no YouTube (canal oficial sempre que possível)
// 3) grava dados.json, que a página lê.
import { readFile, writeFile } from "node:fs/promises";

const ISPOT = "https://www.ispot.tv";
const ARQUIVO = new URL("../dados.json", import.meta.url);
const MAX_ANUNCIOS = 40;
const TENTAR_YT_DE_NOVO_DIAS = 3;
const NAVEGADOR = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function baixar(url, extra = {}) {
  const r = await fetch(url, { headers: { ...NAVEGADOR, ...extra } });
  if (!r.ok) throw new Error(`${r.status} em ${url}`);
  return r.text();
}
const entidades = (s) => (s || "").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&nbsp;/g, " ");
const semTags = (s) => entidades((s || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

// ---------- iSpot ----------
function lerAnuncio(html, id, url) {
  const video = (html.match(/https:\/\/videos-cdn\.ispot\.tv\/ad\/[^"'\s]+?-video-sm\.mp4/) || [])[0];
  if (!video) return null;
  const og = entidades((html.match(/property="og:title" content="([^"]*)"/) || html.match(/content="([^"]*)" property="og:title"/) || [])[1] || "");

  let anunciante = "", titulo = og;
  const corte = og.match(/^(.*?)\s+TV (?:Spot|Commercial),\s*(.*)$/i);
  if (corte) {
    anunciante = corte[1].trim();
    titulo = corte[2].replace(/['"’”]\s+(Featuring|Ft\.|Song by).*$/i, "").replace(/^['"‘“]|['"’”]$/g, "").trim();
  }
  const dd = html.match(/<dt[^>]*>\s*Advertiser\s*<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/);
  if (dd && semTags(dd[1]) && semTags(dd[1]).length < 50) anunciante = semTags(dd[1]);

  const ag = html.match(/<dd[^>]*>((?:(?!<dd)[\s\S])*?)<small[^>]*>[^<]*Creative Agency/);
  const agencia = ag ? semTags(ag[1]).replace(/\s*\.\.\.$/, "") : "";

  return { id, anunciante, titulo, agencia, video, ispot: url };
}

async function listaDoISpot(conhecidos) {
  const html = await baixar(ISPOT + "/browse");
  const vistos = new Set();
  const ids = [];
  for (const m of html.matchAll(/href="(?:https:\/\/www\.ispot\.tv)?\/ad\/([A-Za-z0-9]{4})\/([a-z0-9-]+)"/g)) {
    if (vistos.has(m[1]) || ids.length >= MAX_ANUNCIOS) continue;
    vistos.add(m[1]);
    ids.push({ id: m[1], url: `${ISPOT}/ad/${m[1]}/${m[2]}` });
  }
  const saida = [];
  for (const { id, url } of ids) {
    const antigo = conhecidos[id];
    if (antigo && antigo.video) { saida.push({ ...antigo }); continue; }
    try {
      const ad = lerAnuncio(await baixar(url), id, url);
      if (ad) saida.push(ad);
      else console.log("sem vídeo:", url);
    } catch (e) { console.log("falhou:", url, e.message); }
    await espera(1200);
  }
  return saida;
}

// ---------- YouTube ----------
const PARADAS = new Set(["the", "and", "for", "with", "featuring", "feat", "song", "spot", "commercial", "you", "your", "our"]);
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9$]+/g, " ").trim();
const palavras = (s) => norm(s).split(" ").filter((w) => w.length >= 3 && !PARADAS.has(w));
const segundos = (t) => (t ? t.split(":").reduce((a, b) => a * 60 + Number(b), 0) : 0);
const junto = (s) => s.replace(/ /g, "");
function bate(w, t) {
  const raiz = w.slice(0, 5);
  return t.split(" ").some((x) => x === w || (w.length >= 5 && x.length >= 5 && x.startsWith(raiz)));
}
const NAO_E_O_FILME = /\b(review|reaction|react|parody|breakdown|behind the scenes|making of|tv spot)\b/;

function resultados(html) {
  const m = html.match(/var ytInitialData = (\{.*?\});<\/script>/s);
  if (!m) return [];
  const saida = [];
  (function andar(o) {
    if (!o || typeof o !== "object" || saida.length >= 12) return;
    if (o.videoRenderer) {
      const v = o.videoRenderer;
      saida.push({
        id: v.videoId,
        titulo: v.title?.runs?.[0]?.text || "",
        canal: v.ownerText?.runs?.[0]?.text || "",
        duracao: segundos(v.lengthText?.simpleText),
        verificado: JSON.stringify(v.ownerBadges || "").includes("VERIFIED"),
      });
      return;
    }
    for (const k in o) andar(o[k]);
  })(JSON.parse(m[1]));
  return saida;
}

function escolher(ad, candidatos) {
  const tw = palavras(ad.titulo);
  const nomeDoFilme = palavras(ad.titulo.split(":").pop());
  const marca = junto(norm(ad.anunciante));
  const chave = junto(norm(ad.anunciante).split(" ").slice(0, 2).join(" "));
  let melhor = null, melhorNota = 0;
  for (const c of candidatos) {
    if (!c.id || !c.duracao || c.duracao > 130) continue;
    const ct = norm(c.titulo), cc = junto(norm(c.canal));
    if (NAO_E_O_FILME.test(ct)) continue;
    const canalDaMarca = cc.includes(chave) || (cc.length >= 3 && marca.includes(cc));
    const tituloComMarca = junto(ct).includes(chave);
    if (!canalDaMarca && !tituloComMarca) continue;
    if (!canalDaMarca && !/\b(commercial|ad|advert|super bowl)\b/.test(ct)) continue;
    if (nomeDoFilme.length && !nomeDoFilme.some((w) => bate(w, ct))) continue;
    const acertos = tw.filter((w) => bate(w, ct)).length;
    const cobertura = tw.length ? acertos / tw.length : 0;
    const minimo = tw.length <= 2 ? 1 : (canalDaMarca && c.verificado ? 0.5 : 0.67);
    if (cobertura < minimo) continue;
    const nota = cobertura * 3 + (canalDaMarca ? 2 : 0) + (c.verificado ? 1 : 0) + (c.duracao >= 25 && c.duracao <= 65 ? 0.5 : 0);
    if (nota > melhorNota) { melhor = c; melhorNota = nota; }
  }
  return melhor;
}

async function procurarNoYouTube(ad) {
  const nome = ad.titulo.split(":").pop().trim();
  for (const q of [`${ad.anunciante} ${ad.titulo} commercial`, `${ad.anunciante} "${nome}"`]) {
    const url = "https://www.youtube.com/results?hl=en&gl=US&persist_hl=0&search_query=" + encodeURIComponent(q);
    const html = await baixar(url, { Cookie: "SOCS=CAI; CONSENT=YES+1" });
    const lista = resultados(html);
    if (!lista.length) console.log("YouTube sem resultados legíveis para:", q);
    const c = escolher(ad, lista);
    await espera(800);
    if (c) return { id: c.id, titulo: c.titulo, canal: c.canal };
  }
  return null;
}

// ---------- principal ----------
let anterior = { anuncios: [] };
try { anterior = JSON.parse(await readFile(ARQUIVO, "utf8")); } catch (e) {}
const conhecidos = Object.fromEntries((anterior.anuncios || []).map((a) => [a.id, a]));

let anuncios;
try { anuncios = await listaDoISpot(conhecidos); }
catch (e) { console.log("iSpot fora do ar ou bloqueou:", e.message); anuncios = []; }
if (anuncios.length < 5) {
  console.log(`Só ${anuncios.length} comerciais lidos — mantendo a lista anterior.`);
  anuncios = (anterior.anuncios || []).map((a) => ({ ...a }));
}

const agora = Date.now();
let doYouTube = 0;
for (const ad of anuncios) {
  const recente = ad.ytChecado && agora - ad.ytChecado < TENTAR_YT_DE_NOVO_DIAS * 864e5;
  if (ad.yt || recente) { if (ad.yt) doYouTube++; continue; }
  try {
    const achado = await procurarNoYouTube(ad);
    ad.ytChecado = agora;
    if (achado) { ad.yt = achado.id; ad.ytTitulo = achado.titulo; ad.ytCanal = achado.canal; doYouTube++; }
  } catch (e) { console.log("YouTube falhou para", ad.anunciante, ad.titulo, e.message); }
}

await writeFile(ARQUIVO, JSON.stringify({ atualizado: new Date().toISOString(), anuncios }, null, 2) + "\n");
console.log(`${anuncios.length} comerciais · ${doYouTube} com vídeo do YouTube · ${anuncios.length - doYouTube} pelo iSpot`);
