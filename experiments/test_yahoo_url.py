import httpx
from bs4 import BeautifulSoup
from urllib.parse import unquote
import re

def test_yahoo_url():
    url = "https://search.yahoo.com/search"
    resp = httpx.get(
        url,
        params={"p": 'site:instagram.com "yoga" "NY" "@gmail.com"'},
        timeout=15,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        }
    )
    if resp.status_code == 200:
        soup = BeautifulSoup(resp.text, "html.parser")
        for div in soup.select("div.algo-sr"):
            a = div.select_one("a")
            if a:
                href = a.get("href")
                # e.g. https://r.search.yahoo.com/_ylt=Awr.../RV=2/RE=.../RO=10/RU=https%3a%2f%2fwww.instagram.com%2fhotyogasyracuse%2f/RK=2/RS=...
                if "RU=" in href:
                    m = re.search(r'RU=([^/]+)/R[K|S]=', href)
                    if m:
                        href = unquote(m.group(1))
                print("URL:", href)
            snippet = div.select_one("div.compText")
            if snippet:
                pass

test_yahoo_url()
