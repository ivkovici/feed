import fetch from "node-fetch";
import { XMLParser } from "fast-xml-parser";
import fs from "fs";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// --- LOGOLÓ ---
function log(msg) {
  fs.appendFileSync("feeds.log", msg + "\n");
  console.log(msg);
}

function logError(err) {
  const msg = "ERROR: " + (err.stack || err);
  fs.appendFileSync("feeds.log", msg + "\n");
  console.error(msg);
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

async function main() {
  log("=== DIAGNOSTIC RUN STARTED ===");
  log("Total sources: " + SOURCES.length);

  const results = [];

  for (const source of SOURCES) {
    log(`\n--- Fetching: ${source.name} (${source.feedUrl}) ---`);

    try {
      const response = await fetch(source.feedUrl, {
        headers: { "User-Agent": "Hunhir-Diagnostic/1.0" },
      });

      log(`HTTP status: ${response.status}`);

      if (!response.ok) {
        log(`Fetch failed for ${source.name}: HTTP ${response.status}`);
        results.push({ source: source.name, ok: false, reason: "HTTP " + response.status });
        continue;
      }

      const xmlText = await response.text();
      log(`Downloaded ${xmlText.length} bytes`);

      let jsonObj;
      try {
        jsonObj = parser.parse(xmlText);
        log("XML parsed successfully");
      } catch (err) {
        logError("XML parse error for " + source.name + ": " + err);
        results.push({ source: source.name, ok: false, reason: "XML parse error" });
        continue;
      }

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

      log(`Items found: ${items.length}`);

      results.push({ source: source.name, ok: true, items: items.length });

    } catch (err) {
      logError("Fetch error for " + source.name + ": " + err);
      results.push({ source: source.name, ok: false, reason: "Fetch error" });
    }
  }

  log("\n=== SUMMARY ===");
  for (const r of results) {
    if (r.ok) {
      log(`✔ ${r.source}: OK, items = ${r.items}`);
    } else {
      log(`✖ ${r.source}: FAILED (${r.reason})`);
    }
  }

  log("\n=== DIAGNOSTIC COMPLETE ===");

  // Always write a minimal feeds.json so Pages deploy works
  fs.mkdirSync("public", { recursive: true });
  fs.writeFileSync("public/feeds.json", JSON.stringify({ diagnostic: results }, null, 2));
}

main().catch(err => {
  logError("FATAL ERROR: " + err);
});
