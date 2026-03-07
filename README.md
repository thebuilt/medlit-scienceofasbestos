# Science of Asbestos PubMed Dashboard

This site tracks PubMed papers (from 2000 onward) that mention asbestos-related terms in title/abstract, then visualizes them as:

- Keyword bubble chart
- Hoverable paper stream (title + abstract preview)
- World map of first-author affiliation country counts
- Word co-occurrence map for topic trends

## What this gives you

- Automatic updates from PubMed (daily via GitHub Actions)
- Static site that works with GitHub Pages
- Easy embed into Google Sites using an iframe

## Project structure

- `/index.html` UI layout and styles
- `/app.js` dashboard logic and visualizations
- `/data/papers.json` generated PubMed dataset used by the page
- `/scripts/update_pubmed_data.mjs` PubMed fetch + parse + country extraction
- `/.github/workflows/update-pubmed-data.yml` daily updater

## 1) Put this on GitHub (GitHub Desktop)

1. Open GitHub Desktop.
2. Add this folder as a repository (or open existing repo).
3. Commit all files.
4. Publish/push to GitHub.

## 2) Enable GitHub Pages

1. Open your GitHub repo in browser.
2. Go to `Settings -> Pages`.
3. Set source to `Deploy from a branch`.
4. Select branch `main`, folder `/ (root)`.
5. Save.

Your site will appear at:

- `https://<your-github-username>.github.io/<repo-name>/`

## 3) Connect custom domain `medlit.scienceofasbestos.org`

1. Keep `CNAME` in repo root with your domain (`medlit.scienceofasbestos.org`).
2. In DNS provider, create a `CNAME` record:
   - Host: `medlit`
   - Value: `<your-github-username>.github.io`
3. In GitHub Pages settings, set the custom domain to `medlit.scienceofasbestos.org`.
4. Wait for DNS to propagate.

## 4) Automatic PubMed updates

The workflow `Update PubMed Data` runs daily and on manual trigger.

Optional but recommended:

1. In GitHub repo, open `Settings -> Secrets and variables -> Actions`.
2. Create secret `NCBI_EMAIL` with your email.

Then every run:

- Fetches papers from PubMed using NCBI E-utilities
- Rebuilds `/data/papers.json`
- Commits changes automatically if new papers were found

## 5) Manual local data refresh (optional)

```bash
npm install
npm run update:data
```

## API note (plain language)

An API is just a way for one program to ask another program for data.

Here, your script asks PubMed servers for papers, then saves the results to `data/papers.json`. Your website reads that file and renders charts.

## Multilingual keyword matching

The script includes your core terms and multilingual aliases. You can extend translations in:

- `/scripts/update_pubmed_data.mjs` -> `TERM_GROUPS`
