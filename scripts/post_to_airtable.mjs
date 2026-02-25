import fs from "fs";

const pat = process.env.AIRTABLE_PAT;
const baseId = process.env.AIRTABLE_BASE_ID;
const tableName = process.env.AIRTABLE_TABLE_NAME || "DailyRuns";

if (!pat || !baseId) {
  throw new Error("Missing AIRTABLE_PAT or AIRTABLE_BASE_ID env vars.");
}

const latest = JSON.parse(fs.readFileSync("results/latest.json", "utf8"));

// ---- Extract timestamps ----
const exportedAt =
  latest?.metadata?.exportedAt ||
  latest?.results?.timestamp ||
  new Date().toISOString();

// ---- Extract prompt(s) correctly (works with "{{prompt}}" templating) ----
function extractPromptsForRun(obj) {
  const rows = Array.isArray(obj?.results?.results) ? obj.results.results : [];
  const prompts = rows
    .map(r => String(r?.prompt?.raw || "").trim())
    .filter(Boolean);

  // Deduplicate while preserving order
  const seen = new Set();
  const unique = [];
  for (const p of prompts) {
    if (!seen.has(p)) {
      seen.add(p);
      unique.push(p);
    }
  }
  return unique;
}

const runPrompts = extractPromptsForRun(latest);

// If only one prompt, store it as-is; if multiple, store as newline list
const prompt =
  runPrompts.length === 1
    ? runPrompts[0]
    : runPrompts.join("\n");

// ---- This is the array that contains per-provider eval results ----
const evalResults = Array.isArray(latest?.results?.results) ? latest.results.results : [];

// Helper to pick the entry for a provider by prefix
function findByProviderPrefix(prefix) {
  const p = prefix.toLowerCase();
  return evalResults.find(r => String(r?.provider?.id || "").toLowerCase().startsWith(p)) || null;
}

function getModelId(r) {
  return String(r?.provider?.id || "");
}

function getOutput(r) {
  return String(r?.response?.output || "");
}

function getPassed(r) {
  // Prefer gradingResult.pass when present; else fall back to success
  if (typeof r?.gradingResult?.pass === "boolean") return r.gradingResult.pass;
  if (typeof r?.success === "boolean") return r.success;
  return false;
}

const openaiR = findByProviderPrefix("openai:");
const claudeR = findByProviderPrefix("anthropic:");

// ---- GitHub run URL ----
const githubRunUrl =
  process.env.GITHUB_RUN_URL ||
  `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;

// ---- Airtable fields ----
const fields = {
  RunID: exportedAt,          // Primary key / unique identifier
  RunTimeUTC: exportedAt,     // Date-time field
  Prompt: prompt,

  OpenAI_Model: openaiR ? getModelId(openaiR) : "",
  OpenAI_Output: openaiR ? getOutput(openaiR) : "",
  OpenAI_Passed: openaiR ? getPassed(openaiR) : false,

  Claude_Model: claudeR ? getModelId(claudeR) : "",
  Claude_Output: claudeR ? getOutput(claudeR) : "",
  Claude_Passed: claudeR ? getPassed(claudeR) : false,

  GitHub_Run_URL: githubRunUrl,
};

// ---- POST to Airtable ----
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
