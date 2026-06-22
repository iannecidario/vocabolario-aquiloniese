import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");

await loadDotEnv();

const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const linkedBaseId = "appV4KvPG7wmYJ9ju";
const cacheTtlMs = Number(process.env.CACHE_TTL_MS || 10 * 60 * 1000);

let vocabularyCache = null;
let vocabularyCacheExpiresAt = 0;
let vocabularyCachePromise = null;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

async function loadDotEnv() {
  try {
    const envFile = await readFile(join(root, ".env"), "utf8");
    envFile.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const separator = trimmed.indexOf("=");
      if (separator === -1) return;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    });
  } catch {
    // The app can still run when env vars are provided by the host.
  }
}

function json(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, message) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(message);
}

function readEnv() {
  return {
    token: process.env.AIRTABLE_TOKEN,
    baseId: process.env.AIRTABLE_BASE_ID || linkedBaseId,
    tableName: process.env.AIRTABLE_TABLE_NAME,
    viewName: process.env.AIRTABLE_VIEW_NAME
  };
}

function readFieldOverrides() {
  return {
    word: process.env.AIRTABLE_WORD_FIELD,
    phonetic: process.env.AIRTABLE_PHONETIC_FIELD,
    definition: process.env.AIRTABLE_DEFINITION_FIELD,
    english: process.env.AIRTABLE_ENGLISH_FIELD,
    semantic: process.env.AIRTABLE_SEMANTIC_FIELD,
    grammar: process.env.AIRTABLE_GRAMMAR_FIELD,
    etymology: process.env.AIRTABLE_ETYMOLOGY_FIELD,
    image: process.env.AIRTABLE_IMAGE_FIELD,
    language: process.env.AIRTABLE_LANGUAGE_FIELD,
    category: process.env.AIRTABLE_CATEGORY_FIELD,
    audio: process.env.AIRTABLE_AUDIO_FIELD
  };
}

function defaultFieldMap() {
  const overrides = readFieldOverrides();
  return {
    word: overrides.word || "Word",
    phonetic: overrides.phonetic || "Phonetic",
    definition: overrides.definition || "Definition",
    english: overrides.english || "Inglese",
    semantic: overrides.semantic || "Campi semantici",
    grammar: overrides.grammar || "Grammatica",
    etymology: overrides.etymology || "Etimologia",
    image: overrides.image || "Immagine",
    language: overrides.language || "Language",
    category: overrides.category || "Category",
    audio: overrides.audio || "Audio"
  };
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findField(fields, candidates, types = []) {
  const allowed = new Set(types);
  const usable = fields.filter((field) => !allowed.size || allowed.has(field.type));
  const normalizedCandidates = candidates.map(normalizeName);

  return (
    usable.find((field) => normalizedCandidates.includes(normalizeName(field.name))) ||
    usable.find((field) => normalizedCandidates.some((candidate) => normalizeName(field.name).includes(candidate))) ||
    null
  );
}

async function fetchSchema(env) {
  const response = await fetch(`https://api.airtable.com/v0/meta/bases/${env.baseId}/tables`, {
    headers: {
      authorization: `Bearer ${env.token}`
    }
  });

  if (!response.ok) {
    const details = await response.text();
    const tokenHint = env.token && env.token.length < 40
      ? " Sembra che tu abbia inserito il Token ID, non il token segreto completo: Airtable mostra il token segreto solo una volta quando lo crei."
      : "";
    const error = new Error(`Non riesco a leggere lo schema Airtable (${response.status}).${tokenHint} Se non vuoi usare l'auto-rilevamento, compila AIRTABLE_TABLE_NAME e i campi nel file .env. Dettaglio: ${details}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function inferFieldMap(table) {
  const overrides = readFieldOverrides();
  const fields = table.fields || [];
  const textTypes = ["singleLineText", "multilineText", "richText", "email", "url", "phoneNumber", "formula"];
  const optionTypes = ["singleSelect", "multipleSelects", "singleLineText", "formula"];
  const audioField =
    overrides.audio ||
    findField(fields, ["audio", "mp3", "suono", "sound", "pronuncia audio", "file audio"], ["multipleAttachments"])?.name ||
    findField(fields, ["attachment", "allegato", "file"], ["multipleAttachments"])?.name ||
    fields.find((field) => field.type === "multipleAttachments")?.name ||
    "Audio";

  return {
    word: overrides.word || findField(fields, ["word", "parola", "lemma", "termine", "term", "vocabolo"], textTypes)?.name || fields[0]?.name || "Word",
    phonetic: overrides.phonetic || findField(fields, ["phonetic", "fonetica", "ipa", "pronuncia", "pronunciation", "trascrizione"], textTypes)?.name || "Phonetic",
    definition: overrides.definition || findField(fields, ["definition", "definizione", "meaning", "significato", "descrizione", "note"], textTypes)?.name || "Definition",
    english: overrides.english || findField(fields, ["english", "inglese", "traduzione inglese"], textTypes)?.name || "Inglese",
    semantic: overrides.semantic || findField(fields, ["campi semantici", "campo semantico", "semantic fields", "semantic field", "semantica"], optionTypes)?.name || "Campi semantici",
    grammar: overrides.grammar || findField(fields, ["grammar", "grammatica", "categoria grammaticale"], textTypes)?.name || "Grammatica",
    etymology: overrides.etymology || findField(fields, ["etymology", "etimologia", "origine"], textTypes)?.name || "Etimologia",
    image: overrides.image || findField(fields, ["image", "immagine", "foto", "picture"], ["multipleAttachments"])?.name || "Immagine",
    language: overrides.language || findField(fields, ["language", "lingua", "lang"], optionTypes)?.name || "Language",
    category: overrides.category || findField(fields, ["category", "categoria", "type", "tipo", "classe", "gruppo"], optionTypes)?.name || "Category",
    audio: audioField
  };
}

function pickVocabularyTable(tables, tableName) {
  if (tableName) {
    return tables.find((table) => table.name === tableName || table.id === tableName);
  }

  return (
    tables.find((table) => (table.fields || []).some((field) => field.type === "multipleAttachments" && /audio|mp3|suono|sound|pronuncia/i.test(field.name))) ||
    tables.find((table) => (table.fields || []).some((field) => field.type === "multipleAttachments")) ||
    tables[0]
  );
}

async function resolveAirtableConfig(env) {
  const hasManualConfig = env.tableName && process.env.AIRTABLE_AUDIO_FIELD;
  if (hasManualConfig) {
    try {
      const schema = await fetchSchema(env);
      const table = pickVocabularyTable(schema.tables || [], env.tableName);
      if (table) {
        const fieldMap = defaultFieldMap();
        return {
          tableName: env.tableName,
          tableLabel: table.name,
          fieldMap,
          linkedTables: findLinkedTables(table, fieldMap),
          schema,
          source: "manuale"
        };
      }
    } catch {
      // Manual configuration can still work without schema access.
    }

    return {
      tableName: env.tableName,
      fieldMap: defaultFieldMap(),
      source: "manuale"
    };
  }

  const schema = await fetchSchema(env);
  const table = pickVocabularyTable(schema.tables || [], env.tableName);
  if (!table) {
    const error = new Error("Non ho trovato tabelle nella base Airtable.");
    error.status = 404;
    throw error;
  }

  return {
    tableName: table.id,
    tableLabel: table.name,
    fieldMap: inferFieldMap(table),
    linkedTables: findLinkedTables(table, inferFieldMap(table)),
    schema,
    source: "auto"
  };
}

function findLinkedTables(table, fieldMap) {
  const fields = table.fields || [];
  const semanticField = fields.find((field) => field.name === fieldMap.semantic);
  return {
    semantic: semanticField?.options?.linkedTableId || null
  };
}

function attachmentToAudio(file) {
  if (!file || !file.url) return null;
  return {
    id: file.id,
    filename: file.filename || "audio.mp3",
    url: file.url,
    type: file.type || "audio/mpeg",
    size: file.size || null
  };
}

function attachmentToImage(file) {
  if (!file || !file.url) return null;
  return {
    id: file.id,
    filename: file.filename || "immagine",
    url: file.url,
    type: file.type || "image/jpeg",
    size: file.size || null,
    width: file.width || null,
    height: file.height || null
  };
}

function fieldValueToText(value, lookup = {}) {
  if (Array.isArray(value)) return value.map((item) => lookup[item] || item).join(", ");
  return value || "";
}

function normalizeRecord(record, fieldMap, linkedLookups = {}) {
  const fields = record.fields || {};
  const attachments = Array.isArray(fields[fieldMap.audio]) ? fields[fieldMap.audio] : [];
  const audio = attachments.map(attachmentToAudio).filter(Boolean);
  const imageAttachments = Array.isArray(fields[fieldMap.image]) ? fields[fieldMap.image] : [];
  const images = imageAttachments.map(attachmentToImage).filter(Boolean);

  return {
    id: record.id,
    word: fieldValueToText(fields[fieldMap.word]),
    phonetic: fieldValueToText(fields[fieldMap.phonetic]),
    definition: fieldValueToText(fields[fieldMap.definition]),
    english: fieldValueToText(fields[fieldMap.english]),
    semantic: fieldValueToText(fields[fieldMap.semantic], linkedLookups.semantic),
    grammar: fieldValueToText(fields[fieldMap.grammar]),
    etymology: fieldValueToText(fields[fieldMap.etymology]),
    images,
    language: fieldValueToText(fields[fieldMap.language]),
    category: fieldValueToText(fields[fieldMap.category]),
    audio,
    updatedAt: record.createdTime || null
  };
}

async function fetchRecords(env, tableNameOrId, viewName = "") {
  const encodedTable = encodeURIComponent(tableNameOrId);
  const url = new URL(`https://api.airtable.com/v0/${env.baseId}/${encodedTable}`);
  url.searchParams.set("pageSize", "100");
  if (viewName) url.searchParams.set("view", viewName);

  const records = [];
  let offset = "";

  do {
    if (offset) url.searchParams.set("offset", offset);
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${env.token}`
      }
    });

    if (!response.ok) {
      const details = await response.text();
      const error = new Error(`Airtable ha risposto con ${response.status}: ${details}`);
      error.status = response.status;
      throw error;
    }

    const page = await response.json();
    records.push(...(page.records || []));
    offset = page.offset || "";
  } while (offset);

  return records;
}

async function buildLinkedLookups(env, config) {
  const semanticTableId = config.linkedTables?.semantic;
  const semanticTable = config.schema?.tables?.find((table) => table.id === semanticTableId);
  if (!semanticTableId || !semanticTable) return {};

  const primaryField = semanticTable.fields?.[0]?.name;
  if (!primaryField) return {};

  const records = await fetchRecords(env, semanticTableId);
  return {
    semantic: Object.fromEntries(records.map((record) => [record.id, fieldValueToText(record.fields?.[primaryField])]))
  };
}

async function fetchVocabulary() {
  const now = Date.now();
  if (vocabularyCache && now < vocabularyCacheExpiresAt) {
    return {
      ...vocabularyCache,
      cached: true
    };
  }

  if (vocabularyCachePromise) return vocabularyCachePromise;

  vocabularyCachePromise = fetchVocabularyFromAirtable()
    .then((payload) => {
      vocabularyCache = payload;
      vocabularyCacheExpiresAt = Date.now() + cacheTtlMs;
      return {
        ...payload,
        cached: false
      };
    })
    .finally(() => {
      vocabularyCachePromise = null;
    });

  return vocabularyCachePromise;
}

async function fetchVocabularyFromAirtable() {
  const env = readEnv();
  const missing = Object.entries(env)
    .filter(([key, value]) => !["viewName", "tableName"].includes(key) && !value)
    .map(([key]) => key);

  if (missing.length) {
    const message = `Configurazione Airtable incompleta: ${missing.join(", ")}.`;
    const error = new Error(message);
    error.status = 500;
    throw error;
  }

  const config = await resolveAirtableConfig(env);
  const records = await fetchRecords(env, config.tableName, env.viewName);
  const linkedLookups = await buildLinkedLookups(env, config);

  return {
    items: records.map((record) => normalizeRecord(record, config.fieldMap, linkedLookups)).filter((item) => item.word || item.audio.length),
    config
  };
}

async function proxyAudio(req, res, recordId, attachmentId) {
  const { items } = await fetchVocabulary();
  const item = items.find((entry) => entry.id === recordId);
  const audio = item?.audio?.find((entry) => entry.id === attachmentId);

  if (!audio?.url) {
    sendText(res, 404, "Audio non trovato.");
    return;
  }

  const headers = {};
  if (req.headers.range) headers.range = req.headers.range;

  const response = await fetch(audio.url, { headers });
  if (!response.ok && response.status !== 206) {
    sendText(res, response.status, "Audio non disponibile.");
    return;
  }

  const responseHeaders = {
    "content-type": response.headers.get("content-type") || audio.type || "audio/mpeg",
    "cache-control": "private, max-age=300",
    "accept-ranges": response.headers.get("accept-ranges") || "bytes"
  };

  for (const header of ["content-length", "content-range"]) {
    const value = response.headers.get(header);
    if (value) responseHeaders[header] = value;
  }

  res.writeHead(response.status, responseHeaders);
  if (req.method === "HEAD") {
    res.end();
    return;
  }

  if (!response.body) {
    res.end();
    return;
  }

  Readable.fromWeb(response.body).pipe(res);
}

async function serveStatic(req, res) {
  const path = new URL(req.url, `http://${req.headers.host}`).pathname;
  const requested = path === "/" ? "/index.html" : path;
  const cleanPath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, cleanPath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream"
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  const audioMatch = pathname.match(/^\/api\/audio\/([^/]+)\/([^/]+)$/);
  if (audioMatch) {
    try {
      await proxyAudio(req, res, decodeURIComponent(audioMatch[1]), decodeURIComponent(audioMatch[2]));
    } catch (error) {
      sendText(res, error.status || 500, error.message || "Errore audio.");
    }
    return;
  }

  if (pathname === "/api/vocabulary") {
    try {
      const { items, config, cached } = await fetchVocabulary();
      json(res, 200, { items, fieldMap: config.fieldMap, tableName: config.tableLabel || config.tableName, configSource: config.source, cached });
    } catch (error) {
      json(res, error.status || 500, {
        error: error.message || "Errore inatteso durante il caricamento del vocabolario."
      });
    }
    return;
  }

  await serveStatic(req, res);
});

server.listen(port, host, () => {
  console.log(`Vocabolario fonico disponibile su http://${host}:${port}`);
});
