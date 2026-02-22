import fs from "fs";

const pat = process.env.AIRTABLE_PAT;
const baseId = process.env.AIRTABLE_BASE_ID;
const tableName = process.env.AIRTABLE_TABLE_NAME || "DailyRuns";

if (!pat || !baseId) {
  throw new Error("Missing AIRTABLE_PAT or AIRTABLE_BASE_ID env vars.");
}

const latestPath = "results/latest.json";
const raw = fs.readFileSync(latestPath, "utf8");
const latest = JSON.parse(raw);

const nowUtc = new Date().toISOString();

function asArray(x) {
  if (Array.isArray(x)) return x;
  return [];
}

function pickFirstString(...vals) {
  for (const v of vals) {
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return "";
}

function pickFirstBool(...vals) {
  for (const v of vals) {
    if (typeof v === "boolean") return v;
  }
  return false;
}

function flattenPossibleResults(obj) {
  // Promptfoo JSON shapes vary; try common keys and normalize to a flat array of result-like objects
  const candidates = [
    obj?.results,
    obj?.evals,
    obj?.outputs,
    obj?.testResults,
    obj?.runs,
    obj?.data?.results,
    obj?.result?.results,
  ];

  // If any candidate is an array, return it
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }

  // Sometimes results are stored as an object map; convert values to array
  for (const c of candidates) {
    if (c && typeof c === "object") {
      const vals = Object.values(c);
      if (vals.some(Array.isArray)) {
        // e.g., { openai: [...], anthropic: [...] }
        return vals.flatMap(v => asArray(v));
      }
      // e.g., { openai: {..}, anthropic: {..} }
      return vals;
    }
  }

  return [];
}

const resultsArray = flattenPossibleResults(latest);

function findResult(hint) {
  const h = hint.toLowerCase();

  for (const r of resultsArray) {
    const provider = String(r?.provider || r?.providerId || r?.model || r?.id || "").toLowerCase();
    const output = String(r?.output || r?.response || r?.completion || r?.text || "").toLowerCase();

    if (provider.includes(h) || output.includes(h)) return r;
  }

  return null;
}

// Prompt extraction (best-effort)
const prompt = pickFirstString(
  latest?.prompt,
  latest?.test?.prompt,
  latest?.tests?.?.[0]?.prompt,
  latest?.config?.prompt,
  latest?.config?.prompts?.?.[0],
  latest?.cases?.?.[0]?.prompt
);

// Provider results
const openaiR = findResult("openai") || {};
const claudeR = findResult("anthropic") || findResult("claude") || {};

// Model names
const openaiModel = pickFirstString(
  openaiR?.provider,
  openaiR?.model,
  openaiR?.id,
  latest?.config?.providers?.[0]?.model,
  latest?.config?.providers?.[0]?.id,
  "openai"
);

const claudeModel = pickFirstString(
  claudeR?.provider,
  claudeR?.model,
  claudeR?.id,
  latest?.config?.providers?.[1]?.model,
  latest?.config?.providers?.[1]?.id,
  "anthropic"
);

// Outputs
const openaiOutput = pickFirstString(openaiR?.output, openaiR?.response, openaiR?.completion, openaiR?.text);
const claudeOutput = pickFirstString(claudeR?.output, claudeR?.response, claudeR?.completion, claudeR?.text);

// Pass/fail (best-effort)
function inferPassed(r) {
  if (!r || typeof r !== "object") return false;

  const direct = pickFirstBool(r?.passed, r?.success, r?.ok);
  if (direct !== false) return direct;

  const assertions = asArray(r?.assertions);
  if (assertions.length > 0) {
    return assertions.every(a => a?.pass === true || a?.passed === true);
  }

  return false;
}

const openaiPassed = inferPassed(openaiR);
const claudePassed = inferPassed(claudeR);

const githubRunUrl =
  process.env.GITHUB_RUN_URL ||
  `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;

const fields = {
  RunID: nowUtc,
  RunTimeUTC: nowUtc,
  Prompt: prompt,
  OpenAI_Model: openaiModel,
  OpenAI_Output: openaiOutput,
  OpenAI_Passed: openaiPassed,
  Claude_Model: claudeModel,
  Claude_Output: claudeOutput,
  Claude_Passed: claudePassed,
  GitHub_Run_URL: githubRunUrl,
};

const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`;

const res = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${pat}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ records: [{ fields }] }),
});

const text = await res.text();
if (!res.ok) {
  throw new Error(`Airtable POST failed: ${res.status} ${res.statusText}\n${text}`);
}

console.log("✅ Posted to Airtable:", text);
