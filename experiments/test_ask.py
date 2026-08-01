import httpx
from bs4 import BeautifulSoup
from app.extractor.core import extract_emails_from_text

url = "https://www.ask.com/web"
query = 'site:instagram.com "fitness" "@gmail.com"'
headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

resp = httpx.get(url, params={"q": query}, headers=headers, timeout=10)
soup = BeautifulSoup(resp.text, "html.parser")

for div in soup.select("div.PartialSearchResults-item"):
    p = div.select_one("p.PartialSearchResults-item-abstract")
    if p:
        text = p.get_text(" ", strip=True)
        print("SNIPPET:", text)
        print("EMAILS:", extract_emails_from_text(text))
