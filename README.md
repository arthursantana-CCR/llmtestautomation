LLM Test AutomationPromptfoo + GitHub Actions + AirtableThis repository facilitates automated daily evaluations of multiple Large Language Models (LLMs) against a standardized prompt suite. It captures performance metrics longitudinally to track model drift and quality over time, providing a dashboard-like experience for non-technical stakeholders via Airtable.📌 OverviewContinuous Eval: Runs daily via GitHub Actions.Version Control: Stores full JSON results in Git for audit trails.Accessibility: Syncs summary data to Airtable for easy viewing by non-coders.Comparison: Tests the exact same prompts across OpenAI and Anthropic models simultaneously.🛠 Configuration (The Only File You Edit)eval_config.yamlLocated in the repository root, this file controls the behavior of the entire test suite.Example ConfigurationYAMLdescription: "Daily prompt suite (OpenAI + Claude)"

openai_model: "openai:chat:gpt-4.1-mini"
anthropic_model: "anthropic:messages:claude-sonnet-4-20250514"

temperature: 0
max_tokens: 256

cases:
  - id: "sky_blue"
    prompt: "What is the color of the sky?"
    assert_contains: "blue"
    assert_case_sensitive: false
Key Parameters ExplainedParameterPurposeWhy it matterstemperatureControls randomnessWe default to 0 to ensure stability. Changes observed are likely due to model updates, not sampling noise.max_tokensHard output limitPrevents overly long responses, runaway verbosity, and unnecessary API costs.casesTest instancesYou can add multiple items here. Each id should be a unique, short label.Adding Multiple PromptsTo scale your testing, simply add more items under the cases: block:YAMLcases:
  - id: "sky_blue"
    prompt: "What is the color of the sky?"
    assert_contains: "blue"
  - id: "grass_green"
    prompt: "What color is grass?"
    assert_contains: "green"
📊 Data & Results Storage1. In GitHub (Technical Logs)The pipeline automatically commits the following to the results/ directory:results/history/<timestamp>.json: Immutable history of every run.results/latest.json: A snapshot of the most recent evaluation.results/latest_timestamp.txt: Reference for the last successful run.2. In Airtable (Reporting)Each run generates a single row in Airtable containing:Metadata: Run ID, UTC Timestamp, and GitHub Run URL.Inputs: The Prompt(s) used.Outputs: Model IDs, raw text completions, and Pass/Fail status (checkboxes).🚀 Setup Checklist1. Repository FilesEnsure the following infrastructure files are present:scripts/build_promptfoo_config.mjs (Config generator)scripts/post_to_airtable.mjs (Airtable integration).github/workflows/daily-llm-eval.yml (The "engine")2. GitHub SecretsAdd these under Settings > Secrets and variables > Actions:OPENAI_API_KEYANTHROPIC_API_KEYAIRTABLE_PAT (Personal Access Token with data.records:write scopes)AIRTABLE_BASE_ID (Starts with app...)AIRTABLE_TABLE_NAME (e.g., DailyRuns)3. Airtable SchemaThe Airtable table columns must match these names exactly:RunID (Text)RunTimeUTC (Date/Time)Prompt (Long Text)OpenAI_Model / Claude_Model (Text)OpenAI_Output / Claude_Output (Long Text)OpenAI_Passed / Claude_Passed (Checkbox)GitHub_Run_URL (URL)🔄 How to RunAutomated: The workflow triggers automatically every day at 10:00 GMT-3 (13:00 UTC).
