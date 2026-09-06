---
name: identify-job-board-platform
description: "Identify which ATS or job-listing platform powers a careers or job URL, then add the verified board to an existing scraper adapter or create and register a new adapter. Use when given an employer careers link, job posting link, ATS link, or job board to integrate."
argument-hint: "url=... [company=...]"
---

# Identify Job Board Platform

Determine the platform behind a job or careers URL and integrate its board into this
repository. Treat platform identification and adapter support as separate claims, and
verify both with live evidence.

## Inputs

* `url`: A job detail or careers page URL
* `company`: Optional display name; infer it from the page when omitted

## Procedure

### 1. Inspect the link

1. Open the supplied URL and follow redirects.
2. Record the final URL, page title, canonical URL, outbound application links, form
   actions, loaded scripts, and relevant network requests.
3. Look for platform evidence in this order:
   * Recognizable host names or URL shapes, such as `myworkdayjobs.com`,
     `greenhouse.io`, `lever.co`, `ashbyhq.com`, or `dayforcehcm.com`
   * Public JSON, GraphQL, RSS, or HTML search endpoints used by the page
   * Script names, HTML attributes, cookies, response headers, or platform branding
   * A custom employer-owned listing page with no external ATS evidence
4. Do not identify a platform from visual similarity or a company name alone. Report
   the evidence that establishes the result.

### 2. Find existing support

1. Search `src/adapters/` for the platform host, API path, parser, board type, and
   adapter name.
2. Check the adapter registration in `src/scrape.ts` and focused coverage in
   `src/adapters/adapters.test.ts`.
3. If the platform adapter exists, add the smallest verified board configuration to
   it. Preserve the exact tenant, site, locale, token, or board identifier from the
   working URL instead of guessing one from the company name.
4. If the site is an employer-owned custom page, add it to `custom.ts` when one of its
   declarative strategies fits. Add a narrow parser strategy there only when the
   markup is unique and stable.

### 3. Create a platform adapter when needed

Create a dedicated adapter only when the platform is reusable across employers and no
existing adapter supports it. Use `src/adapters/workday.ts` as the structural model:

1. Define a board interface containing a real careers URL and display name.
2. Export a verified board list and a URL parser for platform-specific identifiers.
3. Use the public structured endpoint consumed by the careers page when available.
4. Map responses to `RawJob`, including canonical URL, source, location, posted date,
   remote status, type, salary, sponsorship, and description when provided.
5. Isolate failures by board and bound pagination, concurrency, retries, and detail
   lookups.
6. Export an `Adapter` factory and register it in the appropriate group in
   `src/scrape.ts`. Put inexpensive sources in `fastAdapters()` and costly sources in
   `slowAdapters()`.
7. Keep platform-specific parsing in the new adapter. Do not duplicate normalization,
   role matching, country filtering, storage, or deduplication logic.

### 4. Verify the integration

1. Add focused tests for URL parsing and response or HTML mapping. Include the supplied
   URL shape and one representative posting fixture.
2. Run the narrow adapter test first, then `npm run typecheck`.
3. Run a live probe against the board with caching disabled when practical. Confirm
   that at least one posting has the expected title, company, location, canonical URL,
   and source.
4. If the board is live but currently empty, prove the endpoint and response shape and
   state that no posting-level verification was possible.
5. Summarize the detected platform, evidence, files changed, board added, and
   validation results.

## Constraints

* Prefer official public APIs, feeds, or page-owned endpoints over HTML scraping.
* Never scrape behind authentication, a paywall, or an access-control challenge.
* Respect the repository cache, request timeouts, pagination limits, and failure
  isolation conventions.
* Do not add a guessed board configuration or claim support based only on an HTTP 200
  response.