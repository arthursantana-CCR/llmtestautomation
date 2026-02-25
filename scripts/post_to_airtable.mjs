import fs from "fs";

const pat = process.env.AIRTABLE_PAT;
const baseId = process.env.AIRTABLE_BASE_ID;
const tableName = process.env.AIRTABLE_TABLE_NAME || "DailyRuns";

if (!pat || !baseId) {
  throw new Error("Missing AIRTABLE_PAT or AIRTABLE_BASE_ID env vars.");
}

const latest = JSON.parse(fs.readFileSync("results/latest.json", "utf8"));

// ---- Timestamp ----
const exportedAt =
  latest?.metadata?.exportedAt ||
  latest?.results?.timestamp ||
  new Date().toISOString();

// ---- Get result rows (Promptfoo export v3) ----
const rows = Array.isArray(latest?.results?.results) ? latest.results.results : [];

// ---- Extract prompt(s) (works with "{{prompt}}" templating) ----
function extractPromptsForRun(obj) {
  const rs = Array.isArray(obj?.results?.results) ? obj.results.results : [];
  const prompts = rs.map(r => String(r?.prompt?.raw || "").trim()).filter(Boolean);

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
const prompt =
  runPrompts.length === 1 ? runPrompts[0] : runPrompts.join("\n");

// ---- Helpers ----
function providerId(r) {
  return String(r?.provider?.id || "");
}

function caseId(r) {
  // We set metadata.case_id in the generated promptfoo config.
  // Depending on promptfoo version, it may land in different places.
  return (
    r?.metadata?.case_id ||
    r?.testCase?.metadata?.case_id ||
    r?.vars?.case_id ||
    "no_case_id"
  );
}

function modelOutput(r) {
  // Prefer the actual model output
  const out = r?.response?.output;
  if (typeof out === "string" && out.trim() !== "") return out.trim();

  // Fallbacks (rare, but protects against version differences)
  const alt =
    r?.response?.text ||
    r?.response?.content ||
    r?.response?.message ||
    r?.output ||
    "";
  return String(alt || "").trim();
}

function passed(r) {
  if (typeof r?.gradingResult?.pass === "boolean") return r.gradingResult.pass;
  if (typeof r?.success === "boolean") return r.success;
  return false;
}

function groupByProviderPrefix(prefix) {
  const p = prefix.toLowerCase();
  return rows.filter(r => providerId(r).toLowerCase().startsWith(p));
}

function summarizeProvider(prefix) {
  const providerRows = groupByProviderPrefix(prefix);

  if (providerRows.length === 0) {
    return {
      model: "",
      output: "",
      allPassed: false,
    };
  }

  const model = providerId(providerRows[0]);

  // Build a readable multi-case output:
  // [case_id] <model output>
  const outputs = providerRows.map(r => {
    const cid = caseId(r);
    const out = modelOutput(r);

    // If output is missing for some reason, still show something useful.
    const safeOut = out !== "" ? out : "(no model output captured)";
    return `[${cid}] ${safeOut}`;
  });

  const allPassed = providerRows.every(r => passed(r));

  return {
    model,
    output: outputs.join("\n\n"),
    allPassed,
  };
}

const openai = summarizeProvider("openai:");
const claude = summarizeProvider("anthropic:");

const githubRunUrl =
  process.env.GITHUB_RUN_URL ||
  `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;

// ---- Airtable fields ----
const fields = {
  RunID: exportedAt,
  RunTimeUTC: exportedAt,
  Prompt: prompt,

  OpenAI_Model: openai.model,
  OpenAI_Output: openai.output,     // ✅ always show the model outputs
  OpenAI_Passed: openai.allPassed,  // ✅ unchecked if any case fails

  Claude_Model: claude.model,
  Claude_Output: claude.output,
  Claude_Passed: claude.allPassed,

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
