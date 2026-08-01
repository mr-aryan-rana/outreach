
import httpx
from bs4 import BeautifulSoup

url = "https://lite.duckduckgo.com/lite/"
data = {"q": 'site:instagram.com "fitness" "NY" "@gmail.com"'}
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Content-Type": "application/x-www-form-urlencoded"
}

resp = httpx.post(url, data=data, headers=headers, timeout=10)
print(resp.status_code)
soup = BeautifulSoup(resp.text, "html.parser")
for tr in soup.select("tr"):
    snippet = tr.select_one("td.snippet")
    if snippet:
        print("SNIPPET:", snippet.get_text(" ", strip=True))
