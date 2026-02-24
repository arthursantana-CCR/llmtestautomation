import fs from "fs";
import yaml from "js-yaml";

function mustString(v, name) {
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`eval_config.yaml: missing or invalid "${name}"`);
  }
  return v;
}

function mustNumber(v, name) {
  if (typeof v !== "number" || Number.isNaN(v)) {
    throw new Error(`eval_config.yaml: missing or invalid "${name}" (must be a number)`);
  }
  return v;
}

const cfg = yaml.load(fs.readFileSync("eval_config.yaml", "utf8"));

const description = (typeof cfg?.description === "string" && cfg.description.trim() !== "")
  ? cfg.description
  : "LLM evaluation suite";

const openai_model = mustString(cfg?.openai_model, "openai_model");
const anthropic_model = mustString(cfg?.anthropic_model, "anthropic_model");

const temperature = (typeof cfg?.temperature === "number") ? cfg.temperature : 0;
const max_tokens = (typeof cfg?.max_tokens === "number") ? cfg.max_tokens : 256;

const cases = Array.isArray(cfg?.cases) ? cfg.cases : [];
if (cases.length === 0) {
  throw new Error(`eval_config.yaml: "cases" must be a non-empty list`);
}

// Validate cases and normalize
const normalizedCases = cases.map((c, idx) => {
  const id = (typeof c?.id === "string" && c.id.trim() !== "") ? c.id.trim() : `case_${idx + 1}`;
  const prompt = mustString(c?.prompt, `cases[${idx}].prompt`);
  const expected = mustString(c?.assert_contains, `cases[${idx}].assert_contains`);
  const caseSensitive = (typeof c?.assert_case_sensitive === "boolean") ? c.assert_case_sensitive : false;

  return { id, prompt, expected, caseSensitive };
});

// ---- Generate Promptfoo config (per-case expectations) ----
// Trick: use a single templated prompt "{{prompt}}" and create one test per case,
// each test injects vars {prompt, expected, case_id}.
const promptfoo = {
  description,
  prompts: ["{{prompt}}"],
  providers: [
    { id: openai_model, config: { temperature, max_tokens } },
    { id: anthropic_model, config: { temperature, max_tokens } },
  ],
  tests: normalizedCases.map(c => ({
    vars: {
      prompt: c.prompt,
      expected: c.expected,
      case_id: c.id,
    },
    assert: [
      {
        type: "contains",
        value: "{{expected}}",
        // If your promptfoo version doesn’t support this, it will just ignore it.
        caseSensitive: c.caseSensitive,
      },
    ],
    metadata: {
      case_id: c.id,
    },
  })),
};

fs.writeFileSync(
  "promptfooconfig.yaml",
  yaml.dump(promptfoo, { lineWidth: 140 }),
  "utf8"
);

console.log(`✅ Generated promptfooconfig.yaml with ${normalizedCases.length} cases`);
