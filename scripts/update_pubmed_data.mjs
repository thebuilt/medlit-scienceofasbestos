import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const OUT_PATH = path.join(ROOT, "data", "papers.json");

const BATCH_SIZE = 100;
const START_YEAR = 2000;
const FETCH_TIMEOUT_MS = 60_000;
const FETCH_RETRIES = 5;
const RETRY_BASE_MS = 1500;

const TERM_GROUPS = [
  {
    label: "asbestos",
    aliases: [
      "asbestos", "amiante", "amianto", "асбест", "石棉", "석면", "الأسبستوس", "एस्बेस्टस", "azbest"
    ]
  },
  {
    label: "mesothelioma",
    aliases: [
      "mesothelioma", "mésothéliome", "mesotelioma", "мезотелиома", "间皮瘤", "중피종", "ورم المتوسطة", "मेसोथелियोमा"
    ]
  },
  {
    label: "chrysotile",
    aliases: [
      "chrysotile", "crisotilo", "chrysotile", "хризотил", "温石棉", "온석면", "الكريسوتيل", "क्राइसोटाइल"
    ]
  },
  {
    label: "asbestosis",
    aliases: [
      "asbestosis", "asbestose", "asbestosi", "асбестоз", "石棉肺", "석면폐증", "داء الأسبست", "एस्बेस्टोसिस"
    ]
  },
  {
    label: "tremolite",
    aliases: ["tremolite", "trémolite", "tremolita", "тремолит", "透闪石", "트레몰라이트", "تريمولايت", "ट्रेमोलाइट"]
  },
  {
    label: "amosite",
    aliases: ["amosite", "amosita", "амозит", "铁石棉", "아모사이트", "أموسايت", "अमोसाइट"]
  },
  {
    label: "anthophyllite",
    aliases: ["anthophyllite", "antofillita", "антофиллит", "直闪石", "안소필라이트", "أنثوفيليت", "एंथोफिलाइट"]
  },
  {
    label: "actinolite",
    aliases: ["actinolite", "actinolita", "актинолит", "阳起石", "악티놀라이트", "أكتينोलيت", "ऐक्टिनोलाइट"]
  }
];

const COUNTRY_ALIASES = {
  "united states": "United States",
  "u.s.a": "United States",
  "usa": "United States",
  "u.s.": "United States",
  "us": "United States",
  "united kingdom": "United Kingdom",
  "uk": "United Kingdom",
  "england": "United Kingdom",
  "scotland": "United Kingdom",
  "wales": "United Kingdom",
  "northern ireland": "United Kingdom",
  "korea republic": "South Korea",
  "republic of korea": "South Korea",
  "south korea": "South Korea",
  "korea": "South Korea",
  "north korea": "North Korea",
  "russian federation": "Russia",
  "russia": "Russia",
  "iran islamic republic": "Iran",
  "czechia": "Czech Republic",
  "viet nam": "Vietnam",
  "uae": "United Arab Emirates",
  "u.a.e": "United Arab Emirates",
  "people's republic of china": "China",
  "pr china": "China",
  "p.r. china": "China",
  "holland": "Netherlands",
  "brasil": "Brazil",
  "méxico": "Mexico",
  "españa": "Spain",
  "deutschland": "Germany",
  "suisse": "Switzerland",
  "suomi": "Finland",
  "norge": "Norway",
  "sverige": "Sweden",
  "danmark": "Denmark",
  "polska": "Poland",
  "magyarország": "Hungary",
  "österreich": "Austria"
};

const CANONICAL_COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Argentina", "Armenia", "Australia", "Austria", "Azerbaijan", "Bahrain", "Bangladesh", "Belarus", "Belgium", "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Bulgaria", "Cambodia", "Cameroon", "Canada", "Chile", "China", "Colombia", "Croatia", "Cuba", "Cyprus", "Czech Republic", "Denmark", "Dominican Republic", "Ecuador", "Egypt", "Estonia", "Ethiopia", "Finland", "France", "Georgia", "Germany", "Ghana", "Greece", "Guatemala", "Hong Kong", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel", "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kuwait", "Latvia", "Lebanon", "Lithuania", "Luxembourg", "Malaysia", "Malta", "Mexico", "Moldova", "Mongolia", "Morocco", "Myanmar", "Nepal", "Netherlands", "New Zealand", "Nigeria", "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan", "Panama", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania", "Russia", "Saudi Arabia", "Serbia", "Singapore", "Slovakia", "Slovenia", "South Africa", "South Korea", "Spain", "Sri Lanka", "Sweden", "Switzerland", "Syria", "Taiwan", "Thailand", "Tunisia", "Turkey", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay", "Venezuela", "Vietnam"
];

const COUNTRY_MATCHERS = Object.keys(COUNTRY_ALIASES)
  .concat(CANONICAL_COUNTRIES.map((c) => normalize(c)))
  .map((k) => ({ alias: k, canonical: COUNTRY_ALIASES[k] || titleCase(k) }))
  .sort((a, b) => b.alias.length - a.alias.length);

function titleCase(text) {
  return String(text || "").split(" ").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniq(list) {
  return [...new Set(list.filter(Boolean))];
}

function escapeRegex(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstArray(item) {
  if (!item) return null;
  return Array.isArray(item) ? item[0] : item;
}

function flattenText(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(flattenText).join(" ").trim();
  if (typeof value === "object") {
    if ("#text" in value) return flattenText(value["#text"]);
    return Object.values(value).map(flattenText).join(" ").trim();
  }
  return "";
}

function extractPubDate(article) {
  const articleDate = firstArray(article?.ArticleDate);
  if (articleDate?.Year) {
    const mm = String(articleDate.Month || "01").padStart(2, "0");
    const dd = String(articleDate.Day || "01").padStart(2, "0");
    return `${articleDate.Year}-${mm}-${dd}`;
  }

  const pubDate = article?.Journal?.JournalIssue?.PubDate;
  if (!pubDate) return "";

  const year = flattenText(pubDate.Year || "").trim();
  if (year) {
    const monthRaw = flattenText(pubDate.Month || "01").trim();
    const dayRaw = flattenText(pubDate.Day || "01").trim();
    const monthMap = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
    };
    const m = /^[0-9]+$/.test(monthRaw)
      ? String(Number(monthRaw)).padStart(2, "0")
      : (monthMap[monthRaw.slice(0, 3).toLowerCase()] || "01");
    const d = /^[0-9]+$/.test(dayRaw) ? String(Number(dayRaw)).padStart(2, "0") : "01";
    return `${year}-${m}-${d}`;
  }

  const medlineDate = flattenText(pubDate.MedlineDate || "");
  const y = medlineDate.match(/(19|20)\d{2}/)?.[0] || "";
  return y ? `${y}-01-01` : "";
}

function extractDoi(article) {
  const locations = article?.ELocationID;
  const arr = Array.isArray(locations) ? locations : (locations ? [locations] : []);
  for (const item of arr) {
    if (typeof item === "string") continue;
    if (item?.["@_EIdType"] === "doi") return flattenText(item).trim();
  }
  return "";
}

function extractFirstAuthor(article) {
  const authorList = article?.AuthorList?.Author;
  const first = firstArray(authorList);
  if (!first) return { name: "", affiliation: "" };

  let name = "";
  if (first.CollectiveName) {
    name = flattenText(first.CollectiveName);
  } else {
    const fore = flattenText(first.ForeName || first.Initials || "").trim();
    const last = flattenText(first.LastName || "").trim();
    name = `${fore} ${last}`.trim();
  }

  const affInfo = firstArray(first.AffiliationInfo);
  const affiliation = flattenText(affInfo?.Affiliation || "").trim();
  return { name, affiliation };
}

function extractCountry(affiliation) {
  const norm = normalize(affiliation);
  if (!norm) return "";

  for (const { alias, canonical } of COUNTRY_MATCHERS) {
    const rgx = new RegExp(`(^|\\s)${escapeRegex(alias)}(\\s|$)`);
    if (rgx.test(norm)) return canonical;
  }

  const commaChunk = affiliation.split(",").map((x) => x.trim()).filter(Boolean);
  if (commaChunk.length) {
    const last = titleCase(normalize(commaChunk[commaChunk.length - 1]));
    if (CANONICAL_COUNTRIES.includes(last)) return last;
  }

  return "";
}

function buildTermQueryAndMatchers() {
  const aliasToLabel = new Map();
  TERM_GROUPS.forEach((group) => {
    group.aliases.forEach((alias) => aliasToLabel.set(normalize(alias), group.label));
    aliasToLabel.set(normalize(group.label), group.label);
  });

  const allAliases = uniq(
    TERM_GROUPS.flatMap((g) => [g.label, ...g.aliases]).map((t) => t.trim()).filter(Boolean)
  );

  const query = allAliases
    .map((term) => `"${term.replace(/"/g, "")}"[Title/Abstract]`)
    .join(" OR ");

  return { aliasToLabel, query };
}

async function fetchJson(url, init = undefined) {
  const res = await fetchWithRetry(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}${text ? ` | ${text.slice(0, 400)}` : ""}`);
  }
  return JSON.parse(text);
}

async function fetchText(url) {
  const res = await fetchWithRetry(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url}${body ? ` | ${body.slice(0, 400)}` : ""}`);
  }
  return res.text();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err) {
  const msg = String(err?.message || "").toLowerCase();
  const code = String(err?.code || err?.cause?.code || "").toUpperCase();
  if (msg.includes("terminated")) return true;
  if (msg.includes("fetch failed")) return true;
  if (msg.includes("socket")) return true;
  if (msg.includes("timed out")) return true;
  if (code.includes("UND_ERR_SOCKET")) return true;
  if (code.includes("ECONNRESET")) return true;
  if (code.includes("ETIMEDOUT")) return true;
  if (code.includes("EAI_AGAIN")) return true;
  return false;
}

async function fetchWithRetry(url, init = undefined) {
  let lastError = null;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
    try {
      const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
      return await fetch(url, { ...init, signal });
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err) || attempt === FETCH_RETRIES) break;
      const backoff = RETRY_BASE_MS * attempt;
      await sleep(backoff);
    }
  }
  throw lastError;
}

function detectTerms(title, abstract, aliasToLabel) {
  const blob = normalize(`${title} ${abstract}`);
  const labels = [];

  for (const [alias, label] of aliasToLabel.entries()) {
    if (!alias) continue;
    if (blob.includes(alias)) labels.push(label);
  }

  return uniq(labels);
}

function parseArticles(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
    parseTagValue: false
  });

  const parsed = parser.parse(xml);
  const articles = parsed?.PubmedArticleSet?.PubmedArticle;
  if (!articles) return [];
  return Array.isArray(articles) ? articles : [articles];
}

async function pullPubMedData() {
  const email = process.env.NCBI_EMAIL || "scienceofasbestos@example.org";
  const apiKey = process.env.NCBI_API_KEY || "";
  const tool = "scienceofasbestos-dashboard";

  const { aliasToLabel, query } = buildTermQueryAndMatchers();
  const fullQuery = `(${query})`;

  const esearchUrl = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
  const papers = [];
  const now = new Date();
  const endYear = now.getUTCFullYear();
  const endMonth = now.getUTCMonth() + 1;

  for (let year = START_YEAR; year <= endYear; year++) {
    const lastMonth = year === endYear ? endMonth : 12;
    for (let month = 1; month <= lastMonth; month++) {
      const startDate = `${year}/${String(month).padStart(2, "0")}/01`;
      const monthEnd = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const endDate = `${year}/${String(month).padStart(2, "0")}/${String(monthEnd).padStart(2, "0")}`;
      const sliceQuery = `(${fullQuery}) AND ("${startDate}"[Date - Publication] : "${endDate}"[Date - Publication])`;

      const esearchBody = new URLSearchParams({
        db: "pubmed",
        term: sliceQuery,
        retmode: "json",
        retmax: "0",
        usehistory: "y",
        sort: "pub+date",
        tool,
        email
      });
      if (apiKey) esearchBody.set("api_key", apiKey);

      const search = await fetchJson(esearchUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: esearchBody.toString()
      });

      const count = Number(search?.esearchresult?.count || 0);
      const webenv = search?.esearchresult?.webenv;
      const queryKey = search?.esearchresult?.querykey;
      if (!count) continue;
      if (!webenv || !queryKey) {
        throw new Error(`PubMed search did not return WebEnv/query key for ${year}-${String(month).padStart(2, "0")}.`);
      }

      for (let start = 0; start < count; start += BATCH_SIZE) {
        const efetchUrl = new URL("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi");
        efetchUrl.searchParams.set("db", "pubmed");
        efetchUrl.searchParams.set("query_key", String(queryKey));
        efetchUrl.searchParams.set("WebEnv", String(webenv));
        efetchUrl.searchParams.set("retstart", String(start));
        efetchUrl.searchParams.set("retmax", String(BATCH_SIZE));
        efetchUrl.searchParams.set("retmode", "xml");
        efetchUrl.searchParams.set("tool", tool);
        efetchUrl.searchParams.set("email", email);
        if (apiKey) efetchUrl.searchParams.set("api_key", apiKey);

        const xml = await fetchText(efetchUrl.toString());
        const articles = parseArticles(xml);

        for (const rec of articles) {
          const pmid = flattenText(rec?.MedlineCitation?.PMID).trim();
          const article = rec?.MedlineCitation?.Article;
          if (!pmid || !article) continue;

          const title = flattenText(article.ArticleTitle).trim();
          const abstract = flattenText(article?.Abstract?.AbstractText).trim();
          const pubDate = extractPubDate(article);
          const pubYear = Number((pubDate || "").slice(0, 4));
          if (!Number.isInteger(pubYear) || pubYear < START_YEAR) continue;

          const journal = flattenText(article?.Journal?.Title || "").trim();
          const language = flattenText(firstArray(article?.Language) || "").trim();
          const doi = extractDoi(article);
          const firstAuthor = extractFirstAuthor(article);
          const termsMatched = detectTerms(title, abstract, aliasToLabel);
          if (!termsMatched.length) continue;

          papers.push({
            pmid,
            title,
            abstract,
            journal,
            pubDate,
            year: pubYear,
            doi,
            url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
            firstAuthor: firstAuthor.name,
            firstAffiliation: firstAuthor.affiliation,
            country: extractCountry(firstAuthor.affiliation),
            language,
            termsMatched
          });
        }
      }
    }
  }

  const dedup = new Map();
  for (const p of papers) dedup.set(p.pmid, p);
  const rows = [...dedup.values()].sort((a, b) => {
    const ad = new Date(a.pubDate || `${a.year}-01-01`).getTime();
    const bd = new Date(b.pubDate || `${b.year}-01-01`).getTime();
    return bd - ad;
  });

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      source: "NCBI E-utilities (PubMed)",
      terms: TERM_GROUPS.map((g) => g.label),
      query: fullQuery,
      startYear: START_YEAR,
      notes: "Keyword matching includes multilingual aliases. Expand TERM_GROUPS in scripts/update_pubmed_data.mjs to add more translations."
    },
    papers: rows
  };
}

async function main() {
  const data = await pullPubMedData();
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  console.log(`Saved ${data.papers.length} papers to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
