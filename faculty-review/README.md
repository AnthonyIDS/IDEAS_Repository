# Faculty Assessment Review

A working faculty workspace plus a server for AI-assisted review. Faculty supply official objectives and assignment instructions, confirm extracted text, request suggestions, revise judgments, and download an HTML report or editable JSON file. No API key belongs in GitHub, the web form, or chat.

## Start on Render

1. In Render, choose **New → Blueprint** and connect `AnthonyIDS/IDEAS_Repository`.
2. Use branch `main` and Blueprint path **`faculty-review/render.yaml`**. The blueprint selects a free Node web service. Review Render's displayed plan before deploying.
3. Enter `OPENAI_API_KEY` privately in Render. Create the key in an OpenAI API project with billing enabled. ChatGPT subscriptions do not include API usage.
4. Set `OPENAI_MODEL` to `gpt-5-mini` for an initial pilot, provided it is available to your API project. Evaluate its suggestions against faculty judgments before broader use; this is a starting configuration, not a calibrated scoring model.
5. Deploy. Render generates a `REVIEW_ACCESS_CODE`; retrieve it under the service's Environment settings and share it privately with pilot faculty. It is a staff access code, not the OpenAI key.
6. Open the service's `https://…onrender.com` address. It hosts both the form and the review service. The page should say **Automated reviews are connected**. This checks configuration; generating a review is the final check of the API account and model.
7. Load the ESC1000C example, confirm the objective wording, enter the staff access code, authorize sending the text, and generate one review. Check the returned evidence and try editing and exporting.
8. To enable the same service from GitHub Pages, change only `apiBaseUrl` in `faculty-review/public/config.json` to the service's HTTPS address, without a trailing slash. Never add any secret to this file. The Render version can also use that same address.

If you already created a Render **Web Service**, use these settings instead of creating a second service:

| Setting | Value |
|---|---|
| Repository | `AnthonyIDS/IDEAS_Repository` |
| Branch | `main` |
| Runtime | Node |
| Root directory | `faculty-review` |
| Build command | `npm test` |
| Start command | `node server/index.mjs` |
| Instance | Free for a pilot |
| Health check | `/api/health` |
| Auto-deploy | Off initially |

Add `HOST=0.0.0.0`, `NODE_VERSION=22`, `ALLOWED_ORIGINS=https://anthonyids.github.io`, the two OpenAI variables above, and a randomly generated `REVIEW_ACCESS_CODE` of at least 16 characters. Render's own service URL is automatically permitted through `RENDER_EXTERNAL_URL`. The default usage limits are 50 reviews/day for the service, 10/hour per network address, and 2 simultaneous reviews. One assignment is one review request.

## What is and is not measured

- Alignment uses a custom 1–5 scale. Missing evidence stays unreviewed. This is not a formal Quality Matters review and does not implement its proprietary rubric.
- AI vulnerability is a provisional ARMS-informed estimate. Five risk labels are used, but the official five-level descriptions have not been verified; do not present these as official calibrated ARMS scores or probabilities.
- AIAS permissions use the original 2024 labels and are selected only by faculty. No policy means “Not yet reviewed — instructor policy needed.”
- The server checks objective IDs, score bounds, and whether supporting quotations occur in the submitted material. Matching quotations do not prove a judgment is correct. Faculty must review it.
- A strong alignment rating does not demonstrate that a student achieved an objective.
- The example condenses the supplied Module 1 assignment. It contains no fabricated AI results.

## Privacy and pilot operation

Files are extracted in the browser. Only confirmed text and delivery information are submitted when the user selects Generate review. There is no database, account history, server-side file upload, or app logging of assignment text. OpenAI requests use `store:false`; this is not a promise of zero provider retention. Apply institutional and provider data policies. Do not submit student names, grades, or student work.

The staff code is kept in the tab and is never included in saved files or reports. Workspace contents are also kept in the tab; a saved JSON file contains course text and revision history and should be stored privately. Currently saving requires a course name, objectives, assignment title, and at least 40 characters of instructions for each assignment. Closing an unsaved tab can lose work.

This pilot uses a shared staff code and in-memory request limits. Limits reset after service restarts and do not provide a durable billing ceiling. Behind a hosting proxy, multiple users may share the same network quota. Use a dedicated API project, monitor spending, and set provider budget alerts. For campus-wide use, add institutional sign-in, durable per-user quotas, and administrator access management before expanding access. Failed upstream calls consume a request allowance, and cancellation may not avoid provider charges already incurred.

Render's free service sleeps after inactivity; allow time to wake and retry Check connection again. Auto-deploy is off to avoid changing an active pilot unexpectedly. Deploy later commits manually from Render.

## Extraction limits

PDF, DOCX, TXT, MD; 6 MB/file; 60 PDF pages; 30 objectives; 20 assignments; 40,000 instruction characters and 20,000 rubric characters per assignment. Scanned PDFs need pasted text; image content and links are not analyzed. PDF.js 6.3.289 loads from jsDelivr only when needed. DOCX extraction reads the main document paragraphs and may lose layout and numbering. Always review extracted text.

## Local development and tests

Requires Node 22 or later. There are no npm package dependencies.

```sh
cd faculty-review
npm test
node server/index.mjs
```

Open `http://127.0.0.1:8787`. Without configured environment variables, manual review works and automated review is disabled. For AI testing, copy `.env.example` to `.env`, fill it privately, set `ALLOWED_ORIGINS=http://127.0.0.1:8787`, and run `node --env-file=.env server/index.mjs`. The server does not automatically read `.env`.

Tests cover validation, missing/duplicate objectives, fabricated evidence, missing-score summaries, provider refusals, safe report output, access control, quotas, and Render origin handling. They use a simulated provider and incur no API charges. A live API review must be tested after activation.

## References

- [Render Blueprint settings](https://render.com/docs/blueprint-spec)
- [Render free-service limits](https://render.com/docs/free)
- [OpenAI GPT-5 mini](https://developers.openai.com/api/docs/models/gpt-5-mini)
- [OpenAI API billing is separate from ChatGPT](https://help.openai.com/en/articles/9039756-managing-billing-settings-on-the-chatgpt-web-and-api-platform)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [ARMS authors' overview](https://www.aacsb.edu/insights/articles/2024/10/can-that-assignment-be-completed-with-genai)
- [Original AI Assessment Scale, 2024](https://open-publishing.org/journals/index.php/jutlp/article/download/810/769/1205)
