# LLM Test Automation
### Promptfoo + GitHub Actions + Airtable

This repository runs automated daily evaluations of multiple LLMs on the **same prompt suite**, stores JSON results in Git, and logs a summary row per run in Airtable. The goal is to track model performance **longitudinally** (over time) in a way that is usable by non-coders.

---

## The only file you need to edit

### `eval_config.yaml`

This is the only file you should edit to change what gets tested.

**Minimal example (single prompt):**
```yaml
description: "Daily prompt suite (OpenAI + Claude)"
openai_model: "openai:chat:gpt-4.1-mini"
anthropic_model: "anthropic:messages:claude-sonnet-4-20250514"
temperature: 0
max_tokens: 256

cases:
  - id: "sky_blue"
    prompt: "What is the color of the sky?"
    assert_contains: "blue"
    assert_case_sensitive: false
```

### Why `temperature` and `max_tokens` exist

**`temperature`** controls randomness in generation. We default to `0` to keep outputs as stable as possible, so changes you observe over time are more likely due to model updates rather than sampling noise.

**`max_tokens`** caps the maximum length of the model's output. This is a hard limit passed in the API call — not a "please be short" instruction. We set it to avoid overly long responses that could distort comparisons, runaway verbosity affecting pass/fail, and unnecessary cost.

### Testing multiple prompts

Add more items under `cases:`:
```yaml
cases:
  - id: "sky_blue"
    prompt: "What is the color of the sky?"
    assert_contains: "blue"

  - id: "grass_green"
    prompt: "What color is grass?"
    assert_contains: "green"

  - id: "banana_yellow"
    prompt: "What color is a ripe banana?"
    assert_contains: "yellow"
```

Each case has its own `assert_contains`. The `id` is just a short, descriptive label. The pipeline runs all cases against all configured models.

---

## Where results are stored

**In Git (this repository)**, each run produces:
- `results/history/<timestamp>.json` — immutable run history
- `results/latest.json` — most recent run
- `results/latest_timestamp.txt`

These are committed back to the repo automatically by GitHub Actions.

**In Airtable**, each run creates one row containing: run timestamp, prompt(s), OpenAI/Claude model IDs, outputs, pass/fail status, and the GitHub run URL.

---

## How the pipeline works

1. GitHub Actions triggers on a schedule (daily).
2. The workflow reads `eval_config.yaml` and auto-generates `promptfooconfig.yaml`.
3. Promptfoo runs the eval against OpenAI and Anthropic.
4. Raw JSON results are written to `results/`.
5. A summary row is POSTed to Airtable.
6. Result files are committed back to Git.

---

## One-time setup checklist

### ✅ 1. Confirm these files exist in the repo

| File | Purpose |
|---|---|
| `eval_config.yaml` | The file you edit |
| `.github/workflows/daily-llm-eval.yml` | Scheduled workflow |
| `scripts/build_promptfoo_config.mjs` | Generates Promptfoo config |
| `scripts/post_to_airtable.mjs` | Posts results to Airtable |
| `package.json` + `package-lock.json` | Node dependencies |

Your `.gitignore` should include:
```
node_modules/
promptfooconfig.yaml
```

`promptfooconfig.yaml` is auto-generated and should not be tracked in Git.

---

### ✅ 2. Add OpenAI + Anthropic API keys as GitHub Secrets

Go to: **Repository → Settings → Secrets and variables → Actions → New repository secret**

| Secret name | Where to get it |
|---|---|
| `OPENAI_API_KEY` | OpenAI dashboard → API keys |
| `ANTHROPIC_API_KEY` | Anthropic console → API keys |

These secrets are never stored in code — they are injected at runtime by the workflow.

---

### ✅ 3. Create Airtable credentials and add them as GitHub Secrets

**Create a Personal Access Token (PAT) in Airtable:**

1. Go to the Airtable Developer Hub.
2. Create a Personal Access Token.
3. Required scope: `data.records:write` (also recommended: `data.records:read`).
4. Grant access to the specific base you will write to.
5. Copy the PAT — you will only see it once.

**Find your Base ID and Table name:**
- Base ID looks like: `appXXXXXXXXXXXXXX`
- Table name is typically: `DailyRuns`

**Add these secrets to GitHub:**

| Secret name | Value |
|---|---|
| `AIRTABLE_PAT` | Your PAT (starts with `pat...`) |
| `AIRTABLE_BASE_ID` | Your base ID (starts with `app...`) |
| `AIRTABLE_TABLE_NAME` | Your table name (e.g. `DailyRuns`) |

---

### ✅ 4. Confirm your Airtable table has the expected fields

The following fields must exist with **exactly** these names:

| Field name | Type |
|---|---|
| `RunID` | Text (can be primary) |
| `RunTimeUTC` | Date + time |
| `Prompt` | Long text |
| `OpenAI_Model` | Text |
| `OpenAI_Output` | Long text |
| `OpenAI_Passed` | Checkbox |
| `Claude_Model` | Text |
| `Claude_Output` | Long text |
| `Claude_Passed` | Checkbox |
| `GitHub_Run_URL` | URL |

---

## Running a test manually

Recommended after any change to `eval_config.yaml`.

1. Go to **Actions** in GitHub.
2. Select the workflow: **Daily LLM Eval (OpenAI + Claude)**.
3. Click **Run workflow**.

Then verify:
- A new JSON file appears in `results/history/`
- `results/latest.json` has updated
- A new row appears in Airtable

---

## Scheduling

The workflow runs on a cron schedule defined in `.github/workflows/daily-llm-eval.yml`.

Default: **10:00 GMT-3 (13:00 UTC)**

To change the schedule, edit the `cron` expression in that file.

---

## What to change most often

Most users only ever touch `eval_config.yaml`:

- `cases` — prompts and expected outputs
- `openai_model` / `anthropic_model` — model versions
- `temperature` / `max_tokens` — generation parameters

Everything else is infrastructure.
