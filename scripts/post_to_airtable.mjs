import fs from "fs";

const pat = process.env.AIRTABLE_PAT;
const baseId = process.env.AIRTABLE_BASE_ID;
const tableName = process.env.AIRTABLE_TABLE_NAME || "DailyRuns";

if (!pat || !baseId) {
  throw new Error("Missing AIRTABLE_PAT or AIRTABLE_BASE_ID env vars.");
}

const latest = JSON.parse(fs.readFileSync("results/latest.json", "utf8"));

// ---- Minimal “best effort” extraction ----
// You will likely tweak these once you confirm your exact latest.json shape.
const nowUtc = new Date().toISOString();

const prompt =
  latest?.prompt ||
  latest?.test?.prompt ||
  latest?.tests?.[0]?.prompt ||
  latest?.config?.prompts?.[0] ||
  "";

// Try to locate provider results in common places
const resultsArray =
  latest?.results || latest?.evals || latest?.outputs || latest?.testResults || [];

function findResult(hint) {
  const h = hint.toLowerCase();
  for (const r of resultsArray) {
    const provider = String(r?.provider || r?.providerId || r?.model || "").toLowerCase();
    if (provider.includes(h)) return r;
  }
  return null;
}

const openaiR = findResult("openai") || {};
const claudeR = findResult("anthropic") || findResult("claude") || {};

const openaiModel = openaiR.provider || openaiR.model || "gpt-4.1-mini";
const claudeModel = claudeR.provider || claudeR.model || "claude";

const openaiOutput = openaiR.output || openaiR.response || openaiR.text || "";
const claudeOutput = claudeR.output || claudeR.response || claudeR.text || "";

// “Passed” might exist directly or via assertions; default false if missing
const openaiPassed =
  openaiR.passed ??
  openaiR.success ??
  (Array.isArray(openaiR.assertions) ? openaiR.assertions.every(a => a.pass || a.passed) : false);

const claudePassed =
  claudeR.passed ??
  claudeR.success ??
  (Array.isArray(claudeR.assertions) ? claudeR.assertions.every(a => a.pass || a.passed) : false);

const githubRunUrl =
  process.env.GITHUB_RUN_URL ||
  `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;

const fields = {
  RunID: nowUtc,
  RunTimeUTC: nowUtc,
  Prompt: prompt,
  OpenAI_Model: String(openaiModel),
  OpenAI_Output: String(openaiOutput),
  OpenAI_Passed: Boolean(openaiPassed),
  Claude_Model: String(claudeModel),
  Claude_Output: String(claudeOutput),
  Claude_Passed: Boolean(claudePassed),
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
