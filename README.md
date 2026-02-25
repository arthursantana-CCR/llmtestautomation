# LLM Test Automation (Promptfoo + GitHub Actions + Airtable)

This repository runs automated daily evaluations of multiple LLMs on the **same prompt suite**, stores JSON results in Git, and logs a summary row per run in Airtable.

The goal is to track model performance **longitudinally** (over time) in a way that is usable by non-coders.

---

## What you edit (the only file)

### ✅ `eval_config.yaml` (in repo root)

This is the only file you should edit to change what gets tested.

Example (single prompt case):

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
