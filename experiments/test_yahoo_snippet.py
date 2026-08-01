import httpx
from bs4 import BeautifulSoup
import re
import urllib.parse
from app.extractor.core import extract_emails_from_text

url = "https://search.yahoo.com/search"
query = 'site:instagram.com "fitness" "NY" "@gmail.com"'

resp = httpx.get(
    url, 
    params={"p": query}, 
    timeout=10, 
    headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
)

soup = BeautifulSoup(resp.text, "html.parser")
for div in soup.select("div.algo-sr"):
    snippet_el = div.select_one("div.compText")
    if snippet_el:
        text = snippet_el.get_text(" ", strip=True)
        print("SNIPPET:", text)
        print("EMAILS:", extract_emails_from_text(text))
