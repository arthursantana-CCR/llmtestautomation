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
  // Promptfoo exports can vary by version; try a few common paths
  const rows =
    Array.isArray(obj?.results?.results) ? obj.results.results :
    Array.isArray(obj?.results) ? obj.results :
    [];

  const prompts = rows
    .map(r => String(r?.prompt?.raw || r?.prompt || "").trim())
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

// ---- Per (case × provider) results ----
const evalResults =
  Array.isArray(latest?.results?.results) ? latest.results.results :
  Array.isArray(latest?.results) ? latest.results :
  [];

// ------------------------------
// Helpers: normalize fields
// ------------------------------
function providerId(r) {
  return String(r?.provider?.id || "");
}

function caseId(r) {
  return String(r?.case?.id || r?.case_id || r?.testCase?.id || r?.test_case_id || "");
}

function outputText(r) {
  // Promptfoo sometimes uses response.output; in some versions response may be a string
  if (typeof r?.response?.output === "string") return r.response.output;
  if (typeof r?.response === "string") return r.response;
  // Some errors show up in r.error / r.response.error / r.response.errors
  return "";
}

function extractErrorMessage(r) {
  // Try multiple shapes used across promptfoo/provider adapters
  const direct =
    r?.error?.message ||
    r?.error ||
    r?.response?.error?.message ||
    r?.response?.error ||
    r?.response?.errors?.[0]?.message ||
    r?.response?.errors?.[0];

  if (direct) return String(direct);

  // Sometimes provider adapters stash raw error in response.output with tags, so detect common patterns
  const out = outputText(r);
  if (out && /overloaded|429|529|rate|timeout|network|api call error/i.test(out)) {
    return out;
  }

  return "";
}

function isError(r) {
  // If we can extract a non-empty error message, treat as ERROR
  return Boolean(extractErrorMessage(r));
}

function isPass(r) {
  // Prefer gradingResult.pass when present; else fall back to success
  if (typeof r?.gradingResult?.pass === "boolean") return r.gradingResult.pass;
  if (typeof r?.success === "boolean") return r.success;
  return false;
}

function formatCaseLine(r) {
  const cid = caseId(r) || "(no_case_id)";
  const err = extractErrorMessage(r);
  if (err) {
    return `- ${cid}: [ERROR] ${err}`;
  }
  const passed = isPass(r);
  const out = outputText(r);
  const outCompact = out ? out.replace(/\s+/g, " ").trim() : "";
  const snippet = outCompact ? outCompact.slice(0, 280) : "";
  return `- ${cid}: ${passed ? "[PASS]" : "[FAIL]"} ${snippet}`;
}

// ------------------------------
// Aggregate results per provider
// ------------------------------
function summarizeProvider(prefix) {
  const p = prefix.toLowerCase();
  const rows = evalResults.filter(r =>
    providerId(r).toLowerCase().startsWith(p)
  );

  if (rows.length === 0) {
    return {
      model: "",
      passed: false,
      output: "[ERROR] No results found for provider in results/latest.json",
      status: "ERROR",
    };
  }

  const model = providerId(rows[0]);

  // Determine run status for this provider
  const anyError = rows.some(isError);
  const anyFail = rows.some(r => !isError(r) && !isPass(r));
  const allPass = rows.every(r => !isError(r) && isPass(r));

  // Status precedence: ERROR > FAIL > PASS
  const status = anyError ? "ERROR" : (anyFail ? "FAIL" : "PASS");

  // Checkbox meaning:
  // - true only if PASS across all cases
  // - false if FAIL or ERROR
  const passed = allPass;

  // Output: per-case summary lines (readable in Airtable)
  const lines = rows.map(formatCaseLine);
  const header = `${model} — ${status} (${rows.length} case${rows.length === 1 ? "" : "s"})`;
  const output = [header, ...lines].join("\n");

  return { model, passed, output, status };
}

const openaiSummary = summarizeProvider("openai:");
const claudeSummary = summarizeProvider("anthropic:");

// ---- GitHub run URL ----
const githubRunUrl =
  process.env.GITHUB_RUN_URL ||
  `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;

// ---- Airtable fields (must match table field names exactly) ----
const fields = {
  RunID: exportedAt,          // Primary key / unique identifier
  RunTimeUTC: exportedAt,     // Date-time field
  Prompt: prompt,

  OpenAI_Model: openaiSummary.model,
  OpenAI_Output: openaiSummary.output,
  OpenAI_Passed: openaiSummary.passed,

  Claude_Model: claudeSummary.model,
  Claude_Output: claudeSummary.output,
  Claude_Passed: claudeSummary.passed,

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
