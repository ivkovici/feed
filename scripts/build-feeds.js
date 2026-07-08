import fetch from "node-fetch";
import { XMLParser } from "fast-xml-parser";
import fs from "fs";

// TLS hibák kikapcsolása
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// --- LOGOLÓ ---
function logError(err) {
  fs.writeFileSync("feeds.log", String(err.stack || err));
}

// --- REGEXEK ---
const RE_NBSP = /\u00a0/g;
const RE_ENTITY = /&(#x?[0-9a-f]+|[a-z]+);/gi;
const RE_SPACES = /\s+/g;

// --- HTML STRIPPER ---
function stripHtml(input) {
  let out = "";
  let inside = false;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === "<") {
      inside = true;
      continue;
    }
    if (c === ">") {
      inside = false;
      continue;
    }
    if (!inside) out += c;
  }

  return out;
}

// --- ENTITY MAP ---
const ENTITY_MAP = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  ndash: "–",
  mdash: "—",
};

// --- ENTITY DEKÓDER ---
function entityDecoder(entity, code) {
  const normalized = code.toLowerCase();
  const mapped = ENTITY_MAP[normalized];
  if (mapped) return mapped;

  if (code.startsWith("#x")) {
    const n = parseInt(code.slice(2), 16);
    return Number.isNaN(n) ? entity : String.fromCodePoint(n);
  }

  if (code.startsWith("#")) {
    const n = parseInt(code.slice(1), 10);
    return Number.isNaN(n) ? entity : String.fromCodePoint(n);
  }

  return entity;
}

// --- NORMALIZÁLT SZÖVEG ---
function normalizeText(value) {
  if (value == null) return "";
  let v = String(value);

  v = v.replace(RE_NBSP, " ");
  v = v.replace(RE_ENTITY, entityDecoder);
  v = v.replace(RE_SPACES, " ");

  return v.trim();
}

// --- XML PARSER ---
const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: false,
  allowBooleanAttributes: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
});

// --- RSS FORRÁSOK ---
const SOURCES = [
  { name: "Telex", slug: "telex", feedUrl: "https://telex.hu/rss" },
  { name: "444.hu", slug: "444", feedUrl: "https://444.hu/feed" },
  { name: "HVG", slug: "hvg", feedUrl: "https://hvg.hu/rss" },
  { name: "Index", slug: "index", feedUrl: "https://index.hu/24ora/rss" },
  { name: "Népszava", slug: "nepszava", feedUrl: "https://nepszava.hu/feed" },
  { name: "Portfolio", slug: "portfolio", feedUrl: "https://www.portfolio.hu/rss/all.xml" },
  { name: "Origo", slug: "origo", feedUrl: "https://www.origo.hu/publicapi/hu/rss/origo/articles" },
  { name: "National Geographic", slug: "ng", feedUrl: "https://ng.24.hu/feed" },
  { name: "Múlt-kor", slug: "mult-kor", feedUrl: "https://mult-kor.hu/.scripts/rss.php" },
  { name: "24.hu", slug: "24hu", feedUrl: "https://24.hu/feed" },
  { name: "Blikk", slug: "blikk", feedUrl: "https://www.blikk.hu/feed" },
  { name: "Mandiner", slug: "mandiner", feedUrl: "https://mandiner.hu/rss" },
  { name: "Magyar Nemzet", slug: "magyarnemzet", feedUrl: "https://magyarnemzet.hu/feed" },
  { name: "Átlátszó", slug: "atlatszo", feedUrl: "https://atlatszo.hu/feed" },
  { name: "Magyar Jelen", slug: "magyarjelen", feedUrl: "https://magyarjelen.hu/rss" },
  { name: "Neokohn", slug: "neokohn", feedUrl: "https://neokohn.hu/feed" },
  { name: "Qubit", slug: "qubit", feedUrl: "https://qubit.hu/feed" },
  { name: "Lakmusz", slug: "lakmusz", feedUrl: "https://lakmusz.hu/feed" }
];

const MAX_STORED_ITEMS = 2500;

// --- KATEGÓRIA KIVONAT ---
function extractCategories(rawItem) {
  let cats = [];
  if (rawItem.category) {
    cats = Array.isArray(rawItem.category) ? rawItem.category : [rawItem.category];
  }

  const out = new Set();
  for (const c of cats) {
    let v = "";
    if (typeof c === "string") v = c;
    else if (c?.["#text"]) v = c["#text"];
    else if (c?.term) v = c.term;

    if (v) out.add(v.toLowerCase());
  }

  return [...out];
}

// --- MAIN ---
async function main() {
  console.log("Starting RSS aggregation...");

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();

  const itemsObj = {};

  // --- korábbi cache betöltése ---
  try {
    if (fs.existsSync("public/feeds.json")) {
      const cached = JSON.parse(fs.readFileSync("public/feeds.json", "utf8"));
      if (Array.isArray(cached.items)) {
        for (const item of cached.items) {
          itemsObj[item.id] = item;
        }
      }
    }
  } catch (err) {
    console.warn("Could not read previous feeds.json:", err);
  }

  const newItemsFound = [];

  // --- RSS fetch ---
  await Promise.all(
    SOURCES.map(async (source) => {
      try {
        const response = await fetch(source.feedUrl, {
          headers: { "User-Agent": "Hunhir-Aggregator/1.0" },
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const xmlText = await response.text();
        const jsonObj = parser.parse(xmlText);

        let items = [];
        if (jsonObj?.rss?.channel?.item) {
          items = Array.isArray(jsonObj.rss.channel.item)
            ? jsonObj.rss.channel.item
            : [jsonObj.rss.channel.item];
        } else if (jsonObj?.feed?.entry) {
          items = Array.isArray(jsonObj.feed.entry)
            ? jsonObj.feed.entry
            : [jsonObj.feed.entry];
        }

        for (const rawItem of items) {
          try {
            let link = "";
            if (typeof rawItem.link === "string") link = rawItem.link;
            else if (rawItem.link?.href) link = rawItem.link.href;
            else if (rawItem.link?.["#text"]) link = rawItem.link["#text"];

            if (!link) continue;

            const id = link;
            if (itemsObj[id]) continue;

            const title = normalizeText(rawItem.title || "");
            if (!title) continue;

            let description =
              rawItem.description ||
              rawItem.content ||
              rawItem["content:encoded"] ||
              "";

            description = stripHtml(String(description));
            description = normalizeText(description);
            if (description.length > 300) description = description.slice(0, 300) + "...";

            const pubDateRaw = rawItem.pubDate || rawItem.published || rawItem.updated;
            const pubDateMs = pubDateRaw ? new Date(pubDateRaw).getTime() : nowMs;

            newItemsFound.push({
              id,
              title,
              description,
              pubDate: new Date(pubDateMs).toISOString(),
              pubDateMs,
              source: source.name,
              sourceSlug: source.slug,
              categories: extractCategories(rawItem),
              cities: [],
            });
          } catch {}
        }
      } catch (err) {
        console.error(`Error fetching ${source.name}:`, err);
      }
    })
  );

  // --- új itemek hozzáadása ---
  for (const item of newItemsFound) {
    itemsObj[item.id] = item;
  }

  // --- rendezés + limit ---
  const finalItems = Object.values(itemsObj)
    .sort((a, b) => (b.pubDateMs || 0) - (a.pubDateMs || 0))
    .slice(0, MAX_STORED_ITEMS);

  finalItems.forEach((item) => delete item.pubDateMs);

  const finalData = {
    lastUpdated: now,
    items: finalItems,
  };

  // --- mentés ---
  fs.mkdirSync("public", { recursive: true });
  fs.writeFileSync("public/feeds.json", JSON.stringify(finalData, null, 2));

  console.log(`Saved ${finalItems.length} items. New items: ${newItemsFound.length}`);
}

// --- FATAL ERROR HANDLER ---
main().catch(err => {
  console.error("FATAL ERROR:", err);
  logError(err);
  process.exit(1);
});
