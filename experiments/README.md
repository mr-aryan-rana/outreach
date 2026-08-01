# Experiments

One-off scraper/search-engine probes and alternate pipeline spikes from
evaluating options for the creator-search logic that now lives in
`app/services/creator_search.py` (DuckDuckGo dork search). None of these
are imported by or wired into the actual app (`app/`), none are covered by
`app/requirements.txt` (several need extra packages -- `playwright`,
`yt-dlp`, `googlesearch-python` -- not installed by default), and none are
run automatically.

Kept for reference rather than deleted, in case any of the approaches
(ScraperAPI, yt-dlp-based YouTube search, Playwright-driven profile
scraping) are worth revisiting later.
