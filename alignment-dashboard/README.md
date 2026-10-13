# The Alignment Dashboard

Faculty build a dashboard for their course on GitHub Pages. When they add an assessment, Claude reviews it and the dashboard shows:

- **Alignment** of each assessment with each learning objective, on a 1–5 scale informed by the Quality Matters Higher Education Rubric (7th ed., Standards 3.1, 2.1, 2.4, 3.3). If the instructions do not actually require what the objective states, the rating is **1, No alignment**.
- **AI vulnerability** of each assessment using the AI Risk Measure Scale (ARMS, De Vita and Brown, 2023), with a practical change to make it more resilient and a suggested AI Assessment Scale level.

Faculty can leave and come back: the dashboard saves online and gives them a private resume link, and it is always kept in their browser as well. They can also download a backup file.

Page: `https://anthonyids.github.io/IDEAS_Repository/alignment-dashboard/`

## How the pieces fit

```
GitHub Pages (this folder)  ──►  Render service (server/)  ──►  Claude API
  index.html, app.js              /api/review                     claude-opus-5-5
                                  /api/dashboards  ──►  private GitHub repo (saved dashboards)
```

The API key lives only in Render. Nothing secret is in this repository or in the page.

## Why the ratings can be trusted

1. **Evidence is checked.** For any rating above 1, Claude must copy the exact words from the instructions or rubric that show students doing the objective. The server confirms each quotation really is in the text. If none is, the rating becomes 1. Pasting the objective's own wording into the instructions does not count as evidence.
2. **Two independent reviews.** Each assessment is reviewed twice, separately. The dashboard keeps the lower alignment score and the higher AI risk, and marks any rating where the two reviews differed. The overview shows how often they agreed.
3. **Required work only.** Claude compares the objective's action (for example "evaluate") with what students must actually do (for example "describe"). Optional work and matching topics do not raise a score.
4. **Faculty have the last word.** Any rating can be adjusted; adjusted ratings are marked.

## Set up (one time)

### 1. Get an Anthropic API key
In the [Claude Console](https://platform.claude.com), add billing credit, then create an API key under **API keys**. Keep it private; you will paste it into Render only.

### 2. Create the Render service
1. In Render choose **New → Blueprint**, connect `AnthonyIDS/IDEAS_Repository`, and set the Blueprint path to `alignment-dashboard/render.yaml`.
2. When asked for `ANTHROPIC_API_KEY`, paste your key.
3. Deploy. When it finishes, open the service's address (`https://…onrender.com`). The page should load without the "not connected" notice.
4. In the service's **Environment** tab, copy `REVIEW_ACCESS_CODE`. Share it privately with faculty; it stops strangers from running reviews on your account.

### 3. Keep saved dashboards permanently (free)
A free Render service forgets files when it restarts, so saved dashboards need a home.
1. Create a new **private** GitHub repository, for example `AnthonyIDS/IDEAS_Dashboards`, with a README so it has a `main` branch.
2. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) limited to that one repository with **Contents: Read and write**.
3. In Render → Environment add `GITHUB_REPO` = `AnthonyIDS/IDEAS_Dashboards` and `GITHUB_TOKEN` = the token. Save; Render restarts the service.

Alternative: a paid Render instance with a persistent disk; set `DATA_DIR` to the disk's mount path instead.

### 4. Point the GitHub page at the service
Edit `alignment-dashboard/config.js` and set `apiBaseUrl` to the Render address, without a trailing slash. Commit. The GitHub page now runs reviews and saves dashboards.

## Settings (Render → Environment)

| Name | Needed | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key. |
| `REVIEW_ACCESS_CODE` | Recommended | Faculty enter it once to run reviews and save online. |
| `ALLOWED_ORIGINS` | Yes | Websites allowed to call the service. Default `https://anthonyids.github.io`. |
| `GITHUB_REPO`, `GITHUB_TOKEN` | Recommended | Saves dashboards to a private GitHub repository. |
| `DATA_DIR` | Optional | Saves dashboards to a disk instead. |
| `CLAUDE_MODEL` | Optional | Default `claude-opus-5-5`. |
| `CLAUDE_EFFORT` | Optional | Default `high`. `medium` is cheaper and faster. |
| `REVIEW_PASSES` | Optional | Independent reviews per assessment, default `2` (max 3). |
| `MAX_DAILY_REVIEWS`, `MAX_HOURLY_REVIEWS`, `MAX_CONCURRENT_REVIEWS` | Optional | Usage limits. Defaults 60, 15 per person, 3. |
| `CLAUDE_FALLBACKS` | Optional | Set `off` to disable the API's automatic fallback model when a request is declined. |

**Cost.** Each assessment uses two Claude calls. Expect very roughly $0.30–$0.70 per assessment at the defaults (an estimate, not measured; it depends on the length of the instructions and the number of objectives). Set a spending limit in the Claude Console.

## Privacy

Assignment instructions and objectives are sent to the Render service and to Anthropic's API. Do not paste student names, grades, or student work. Anyone with a resume link can open and edit that dashboard, so share links only with colleagues.

## Developing

Requires Node 22.

```sh
cd alignment-dashboard/server
npm install
npm test
ANTHROPIC_API_KEY=... ALLOWED_ORIGINS=http://127.0.0.1:8787 node index.mjs
```

Open `http://127.0.0.1:8787`. Tests use a stand-in for Claude and cost nothing.

## Sources

- [Quality Matters Higher Education Rubric, 7th edition: Specific Review Standards](https://www.qualitymatters.org/sites/default/files/PDFs/StandardsfromtheQMHigherEducationRubric.pdf)
- [University of Suffolk: AI resilience in assessment (ARMS table, De Vita and Brown, 2023)](https://libguides.uos.ac.uk/celt/course-design/Assessment_AI)
- [Perkins, Furze, Roe and MacVaugh (2024): The AI Assessment Scale](https://open-publishing.org/journals/index.php/jutlp/article/download/810/769/1205)
