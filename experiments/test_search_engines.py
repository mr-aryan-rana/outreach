import httpx

print("Testing Ecosia...")
try:
    r = httpx.get('https://www.ecosia.org/search?q=site%3Ainstagram.com+%22fitness%22+%22%40gmail.com%22', headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}, timeout=10)
    print("Ecosia @gmail.com in text?", "@gmail.com" in r.text)
except Exception as e:
    print(e)

print("Testing Qwant...")
try:
    r = httpx.get('https://api.qwant.com/v3/search/web?q=site%3Ainstagram.com+%22fitness%22+%22%40gmail.com%22&count=10&locale=en_US&offset=0&device=desktop', headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}, timeout=10)
    print("Qwant status:", r.status_code)
    print("Qwant @gmail.com in text?", "@gmail.com" in r.text)
except Exception as e:
    print(e)

