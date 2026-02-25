# LLM Test Automation
### Promptfoo + GitHub Actions + Airtable

This repository runs automated daily evaluations of multiple LLMs on the **same prompt suite**, stores JSON results in Git, and logs a summary row per run in Airtable. The goal is to track model performance **longitudinally** (over time) in a way that is usable by non-coders.

---

## Important: Required Setup for New Users

After cloning or copying this repository, the automation pipeline will not run until you complete a few one-time configuration steps. This is expected behavior — scheduled workflows are disabled by default in new repositories, and API credentials are never transferred via Git.

Follow the steps below before expecting any evaluations to run.

---

## Step 1 — Add Required API Keys as Repository Secrets

The pipeline calls external APIs (OpenAI, Anthropic, and Airtable) on your behalf. To do this securely, it needs credentials stored as GitHub Secrets — encrypted values that live in your repository settings and are injected into the workflow at runtime. They are never written into code or committed to Git.

Go to:
```
Repository → Settings → Secrets and variables → Actions → New repository secret
```

Add the following secrets:

| Secret Name | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `AIRTABLE_PAT` | Airtable Personal Access Token |
| `AIRTABLE_BASE_ID` | Airtable Base ID |
| `AIRTABLE_TABLE_NAME` | Airtable table name (e.g. `DailyRuns`) |

**Where to obtain these values:**

**OpenAI API Key** — OpenAI Dashboard → API Keys page

**Anthropic API Key** — Anthropic Console → API Keys

**Airtable Personal Access Token (PAT):**
1. Go to the Airtable Developer Hub.
2. Create a Personal Access Token.
3. Required scope: `data.records:write` (also recommended: `data.records:read`).
4. Grant access to the specific base you will write to.
5. Copy the PAT — you will only see it once.

**Airtable Base ID** — found in the Airtable URL, looks like: `appXXXXXXXXXXXXXX`

---

## Step 2 — Confirm Your Airtable Table Has the Expected Fields

The following fields must exist in your Airtable table with **exactly** these names:

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

## Step 3 — Confirm These Files Exist in the Repo

| File | Purpose |
|---|---|
| `eval_config.yaml` | The file you edit to configure prompts and models |
| `.github/workflows/daily-llm-eval.yml` | The scheduled workflow |
| `scripts/build_promptfoo_config.mjs` | Generates Promptfoo config automatically |
| `scripts/post_to_airtable.mjs` | Posts results to Airtable |
| `package.json` + `package-lock.json` | Node dependencies |

Your `.gitignore` should include:
```
node_modules/
promptfooconfig.yaml
```

`promptfooconfig.yaml` is auto-generated at runtime and should not be tracked in Git.

---

## Step 4 — Enable GitHub Actions and Run the Workflow Manually

### What GitHub Actions is

GitHub Actions is GitHub's built-in automation system. It allows you to define workflows — sequences of steps that run automatically in response to triggers like a schedule (e.g. daily at a set time) or a manual button click. In this repository, GitHub Actions is what runs the daily LLM evaluations, posts results to Airtable, and commits result files back to Git — all without any manual intervention once set up.

### Why you need to enable it

Scheduled workflows are disabled by default in newly created or copied repositories. This means that even if everything else is configured correctly, the daily evaluations will not run until Actions is explicitly enabled.

### How to enable it

Go to:
```
Repository → Actions tab
```

GitHub may display a message such as:

> "Workflows aren't being run on this repository"

Click **Enable workflows**.

### Run the workflow once manually

After enabling Actions, trigger a manual run to verify everything is working. Scheduled workflows may also not activate until they have been run at least once manually.

Go to:
```
Actions → Daily LLM Eval (OpenAI + Claude)
```

Click **Run workflow**, then verify:
- A new JSON file appears in `results/history/`
- `results/latest.json` has updated
- A new row appears in Airtable

After this first successful run, the daily schedule will activate automatically.

---

## The Only File You Need to Edit

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

## Where Results Are Stored

**In Git (this repository)**, each run produces:
- `results/history/<timestamp>.json` — immutable run history
- `results/latest.json` — most recent run
- `results/latest_timestamp.txt`

These are committed back to the repo automatically by GitHub Actions.

**In Airtable**, each run creates one row containing: run timestamp, prompt(s), OpenAI/Claude model IDs, outputs, pass/fail status, and the GitHub run URL.

---

## How the Pipeline Works

1. GitHub Actions triggers on a schedule (daily).
2. The workflow reads `eval_config.yaml` and auto-generates `promptfooconfig.yaml`.
3. Promptfoo runs the eval against OpenAI and Anthropic.
4. Raw JSON results are written to `results/`.
5. A summary row is POSTed to Airtable.
6. Result files are committed back to Git.

---

## Scheduling

The workflow runs on a cron schedule defined in `.github/workflows/daily-llm-eval.yml`.

Default: **10:00 GMT-3 (13:00 UTC)**

To change the schedule, edit the `cron` expression in that file.

---

## What to Change Most Often

Most users only ever touch `eval_config.yaml`:

- `cases` — prompts and expected outputs
- `openai_model` / `anthropic_model` — model versions
- `temperature` / `max_tokens` — generation parameters

Everything else is infrastructure.
