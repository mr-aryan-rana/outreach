import httpx
from fp.fp import FreeProxy
import time

def test_ddg_proxy(num_tests=1):
    query = 'site:instagram.com "yoga" "NY" "@gmail.com"'
    url = "https://html.duckduckgo.com/html/"
    
    for i in range(num_tests):
        print(f"\n--- Test {i+1} ---")
        proxy = None
        try:
            print("Fetching proxy...")
            # Use small timeout for faster fail
            proxy = FreeProxy(rand=True, timeout=0.5).get()
            print(f"Using proxy: {proxy}")
        except Exception as e:
            print(f"Failed to get proxy: {e}")
            continue
            
        try:
            resp = httpx.get(
                url, params={"q": query}, timeout=10,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"},
                follow_redirects=True,
                proxy=proxy,
            )
            print(f"Status: {resp.status_code}")
            
            if resp.status_code == 200:
                print("Success! Proxy worked for DDG.")
            else:
                print("Rate limited or blocked by DDG!")
                
        except Exception as e:
            print(f"Request failed: {e}")
            
test_ddg_proxy()
