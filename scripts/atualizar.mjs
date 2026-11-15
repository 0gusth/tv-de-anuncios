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
  "User-Agent": "tv-de-anuncios/1.0 (uso pessoal; github.com/0gusth/tv-de-anuncios)",
  "Accept-Language": "en-US,en;q=0.9",
};
const YT_API_KEY = process.env.YT_API_KEY || "";   // chave da YouTube Data API (segredo do repositório)

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

// duração ISO 8601 (PT1M2S) → segundos
const iso = (d) => { const m = (d || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/); return m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0) : 0; };

// busca pela YouTube Data API oficial: search (100 unidades) + videos para duração (1 unidade)
async function buscarYouTube(q) {
  const p = new URLSearchParams({ part: "snippet", q, type: "video", maxResults: "10", regionCode: "US",
    relevanceLanguage: "en", videoDuration: "short", key: YT_API_KEY });
  const busca = await (await fetch("https://www.googleapis.com/youtube/v3/search?" + p)).json();
  if (busca.error) throw new Error(busca.error.message);
  const itens = (busca.items || []).filter((i) => i.id && i.id.videoId);
  if (!itens.length) return [];
  const ids = itens.map((i) => i.id.videoId).join(",");
  const det = await (await fetch(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}&key=${YT_API_KEY}`)).json();
  const dur = Object.fromEntries((det.items || []).map((v) => [v.id, iso(v.contentDetails && v.contentDetails.duration)]));
  return itens.map((i) => ({
    id: i.id.videoId,
    titulo: entidades(i.snippet.title),
    canal: entidades(i.snippet.channelTitle),
    duracao: dur[i.id.videoId] || 0,
  }));
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
    const minimo = tw.length <= 2 ? 1 : (canalDaMarca ? 0.5 : 0.67);
    if (cobertura < minimo) continue;
    const nota = cobertura * 3 + (canalDaMarca ? 2 : 0) + (c.duracao >= 25 && c.duracao <= 65 ? 0.5 : 0);
    if (nota > melhorNota) { melhor = c; melhorNota = nota; }
  }
  return melhor;
}

async function procurarNoYouTube(ad) {
  const nome = ad.titulo.split(":").pop().trim();
  for (const q of [`${ad.anunciante} ${ad.titulo} commercial`, `${ad.anunciante} "${nome}"`]) {
    const c = escolher(ad, await buscarYouTube(q));
    await espera(300);
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
if (!YT_API_KEY) console.log("Sem YT_API_KEY: pulando a busca no YouTube.");
for (const ad of anuncios) {
  if (!YT_API_KEY) { if (ad.yt) doYouTube++; continue; }
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
