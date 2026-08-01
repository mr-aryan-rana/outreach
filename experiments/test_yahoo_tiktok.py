import httpx
from bs4 import BeautifulSoup
import urllib.parse
from app.extractor.core import extract_emails_from_text

url = 'https://search.yahoo.com/search'
query = 'site:tiktok.com "fitness" "@gmail.com"'
r = httpx.get(url, params={'p': query}, headers={'User-Agent': 'Mozilla/5.0'}, timeout=10)
soup = BeautifulSoup(r.text, 'html.parser')
for d in soup.select('div.algo-sr'):
    comp = d.select_one('div.compText')
    if comp:
        text = comp.get_text(' ', strip=True)
        print("TEXT:", text)
        print("EMAILS:", extract_emails_from_text(text))
