import sys
import json
import time
import re
from googlesearch import search
from bs4 import BeautifulSoup
import httpx
from app.extractor.core import extract_emails_from_text
from app.validator.core import is_valid_email

sys.path.append('.')

def run_google_scraper():
    print("Starting Google Scraper approach...")
    queries = [
        'site:youtube.com "fitness" "@gmail.com"',
        'site:youtube.com "vlog" "@yahoo.com"',
        'site:youtube.com "gaming" "@gmail.com"',
        'site:instagram.com "coach" "@gmail.com"',
        'site:youtube.com "beauty" "@gmail.com"'
    ]
    
    found_emails = {}
    
    for query in queries:
        if len(found_emails) >= 30:
            break
            
        print(f"Searching Google: {query}")
        try:
            # We use advanced=True to get the snippet description
            results = search(query, num_results=20, advanced=True)
            for res in results:
                snippet = res.description
                if not snippet:
                    continue
                    
                emails = extract_emails_from_text(snippet)
                for email in emails:
                    if email not in found_emails:
                        ok, reason = is_valid_email(email)
                        if ok:
                            print(f"  -> Found valid email: {email}")
                            found_emails[email] = {
                                "address": email,
                                "is_valid": True,
                                "validated": True,
                                "creator_name": res.title.split("-")[0].strip() if res.title else "Unknown",
                                "creator_platform": "youtube" if "youtube" in res.url else "instagram",
                                "creator_profile_url": res.url,
                                "reason": reason
                            }
                            
                            # Save incrementally
                            out_file = "d:/Shivam/Outreach/app/data/mail_list.json"
                            with open(out_file, "w") as f:
                                json.dump(list(found_emails.values()), f, indent=2)
                                
                            if len(found_emails) >= 30:
                                break
                                
        except Exception as e:
            print(f"Google search error on '{query}': {e}")
            print("Taking a short break to avoid further rate limits...")
            time.sleep(10)
            
    print(f"\nFinished! Found {len(found_emails)} emails.")

if __name__ == "__main__":
    run_google_scraper()
