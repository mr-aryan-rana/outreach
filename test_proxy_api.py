import sys
sys.path.append('.')

import httpx
import json
import random
from bs4 import BeautifulSoup
from urllib.parse import urlparse, unquote
import re
from app.extractor.core import extract_emails_from_text
from app.validator.core import is_valid_email

def get_free_proxies():
    # Fetch free proxies from proxyscrape
    url = "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=US&ssl=all&anonymity=all"
    try:
        r = httpx.get(url, timeout=10)
        proxies = r.text.strip().split("\r\n")
        proxies = [p for p in proxies if p]
        return proxies
    except Exception as e:
        print(f"Failed to fetch proxy list: {e}")
        return []

def test_extract_and_validate():
    proxies = get_free_proxies()
    if not proxies:
        print("No proxies found.")
        return
        
    random.shuffle(proxies)
    
    query = 'site:instagram.com "yoga" "NY" "@gmail.com"'
    url = "https://search.yahoo.com/search"
    
    found_emails = []
    
    for proxy_addr in proxies[:10]: # Try up to 10 proxies
        proxy_url = f"http://{proxy_addr}"
        print(f"Trying proxy: {proxy_url}")
        
        try:
            resp = httpx.get(
                url, params={"p": query}, timeout=10,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"},
                follow_redirects=True,
                proxy=proxy_url,
            )
            
            if resp.status_code == 200:
                print("Successfully fetched Yahoo with proxy!")
                soup = BeautifulSoup(resp.text, "html.parser")
                
                for div in soup.select("div.algo-sr"):
                    snippet_el = div.select_one("div.compText")
                    if snippet_el:
                        text = snippet_el.get_text(" ", strip=True)
                        emails = extract_emails_from_text(text)
                        for email in emails:
                            valid, reason = is_valid_email(email)
                            if valid:
                                found_emails.append({
                                    "address": email,
                                    "proxy_used": proxy_url,
                                    "reason": reason
                                })
                
                # We got a successful response, no need to try more proxies
                break
            else:
                print(f"Status code {resp.status_code}, rate limited.")
                
        except Exception as e:
            print(f"Proxy {proxy_url} failed: {type(e).__name__}")
            
    print(f"\nFound {len(found_emails)} valid emails.")
    if found_emails:
        with open("d:/Shivam/Outreach/app/data/mail_list.json", "w") as f:
            json.dump(found_emails, f, indent=2)
        print("Saved to d:/Shivam/Outreach/app/data/mail_list.json")

if __name__ == "__main__":
    test_extract_and_validate()
