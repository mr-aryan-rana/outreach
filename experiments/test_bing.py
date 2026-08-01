import httpx
from bs4 import BeautifulSoup
import re

url = "https://www.bing.com/search"
query = 'site:instagram.com "fitness" "NY" "@gmail.com"'
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}
resp = httpx.get(url, params={"q": query}, headers=headers, timeout=10)
soup = BeautifulSoup(resp.text, "html.parser")

for li in soup.select("li.b_algo"):
    p = li.select_one("p")
    if p:
        text = p.get_text(" ", strip=True)
        print("SNIPPET:", text)
