import httpx
import json
from bs4 import BeautifulSoup
import random
import time
from app.extractor.core import extract_emails_from_text
from app.validator.core import is_valid_email

def get_free_proxies():
    print("Fetching proxy list...")
    url = "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=5000&country=US&ssl=all&anonymity=all"
    try:
        r = httpx.get(url, timeout=10)
        proxies = [p for p in r.text.strip().split("\r\n") if p]
        print(f"Loaded {len(proxies)} proxies.")
        return proxies
    except:
        return []

def run_scraper():
    proxies = get_free_proxies()
    random.shuffle(proxies)
    proxy_iter = iter(proxies) if proxies else None
    
    # Handcrafted queries known to yield results on Yahoo
    keywords = ["yoga", "coach", "fitness", "photographer", "artist", "designer", "realtor", "agent", "founder", "CEO", "creator", "vlogger", "streamer", "influencer", "model"]
    states = ["NY", "CA", "TX", "FL", "IL", "PA", "OH", "GA", "NC", "MI"]
    
    queries = []
    for k in keywords:
        for s in states:
            queries.append(f'site:instagram.com "{k}" "{s}" "@gmail.com"')
            
    random.shuffle(queries)
    
    url = "https://search.yahoo.com/search"
    found_emails = {}
    current_proxy = None
    
    print("Starting direct Yahoo scraping to get 30 real emails...")
    
    for query in queries:
        if len(found_emails) >= 30:
            break
            
        success = False
        for attempt in range(3):
            try:
                kwargs = {
                    "url": url,
                    "params": {"p": query},
                    "timeout": 15,
                    "headers": {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
                    "follow_redirects": True
                }
                if current_proxy:
                    kwargs["proxies"] = {"http://": f"http://{current_proxy}", "https://": f"http://{current_proxy}"}
                    
                resp = httpx.get(**kwargs)
                if resp.status_code == 200:
                    soup = BeautifulSoup(resp.text, "html.parser")
                    for div in soup.select("div.algo-sr"):
                        snippet_el = div.select_one("div.compText")
                        a_tag = div.select_one("a.ac-algo")
                        
                        if snippet_el and a_tag:
                            text = snippet_el.get_text(" ", strip=True)
                            href = a_tag.get("href", "")
                            
                            emails = extract_emails_from_text(text)
                            for email in emails:
                                if email not in found_emails:
                                    valid, reason = is_valid_email(email)
                                    if valid:
                                        print(f"  -> Found valid email: {email} from {query}")
                                        found_emails[email] = {
                                            "address": email,
                                            "is_valid": True,
                                            "validated": True,
                                            "creator_name": "Unknown",
                                            "creator_platform": "instagram",
                                            "creator_profile_url": href,
                                            "reason": reason
                                        }
                                        # Save incrementally
                                        with open("d:/Shivam/Outreach/app/data/mail_list.json", "w") as f:
                                            json.dump(list(found_emails.values()), f, indent=2)
                                            
                                        if len(found_emails) >= 30:
                                            break
                    success = True
                    break
                else:
                    if proxy_iter:
                        current_proxy = next(proxy_iter)
            except Exception as e:
                if proxy_iter:
                    try:
                        current_proxy = next(proxy_iter)
                    except StopIteration:
                        break
                        
        if not success:
            # If all 3 proxy attempts failed, switch to direct connection for one try
            try:
                 resp = httpx.get(url, params={"p": query}, timeout=10, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
                 if resp.status_code == 200:
                    soup = BeautifulSoup(resp.text, "html.parser")
                    for div in soup.select("div.algo-sr"):
                        snippet_el = div.select_one("div.compText")
                        a_tag = div.select_one("a.ac-algo")
                        if snippet_el and a_tag:
                            text = snippet_el.get_text(" ", strip=True)
                            href = a_tag.get("href", "")
                            emails = extract_emails_from_text(text)
                            for email in emails:
                                if email not in found_emails:
                                    valid, reason = is_valid_email(email)
                                    if valid:
                                        print(f"  -> Found valid email: {email}")
                                        found_emails[email] = {
                                            "address": email,
                                            "is_valid": True,
                                            "validated": True,
                                            "creator_name": "Unknown",
                                            "creator_platform": "instagram",
                                            "creator_profile_url": href,
                                            "reason": reason
                                        }
                                        with open("d:/Shivam/Outreach/app/data/mail_list.json", "w") as f:
                                            json.dump(list(found_emails.values()), f, indent=2)
            except:
                 pass
            time.sleep(2)
            
    print(f"\nDone! Found {len(found_emails)} emails.")

if __name__ == "__main__":
    run_scraper()
