import asyncio
import json
import re
from playwright.async_api import async_playwright
from app.extractor.core import extract_emails_from_text
from app.validator.core import is_valid_email
import sys
sys.path.append('.')

async def main():
    print("Starting Playwright TikTok Scraper...")
    found_emails = {}
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36"
        )
        page = await context.new_page()
        
        import httpx
        from bs4 import BeautifulSoup
        
        queries = ["site:tiktok.com fitness", "site:tiktok.com vlog", "site:tiktok.com makeup"]
        tiktok_urls = []
        
        for q in queries:
            print(f"Searching DDG Lite for: {q}")
            try:
                resp = httpx.post("https://lite.duckduckgo.com/lite/", data={"q": q}, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}, timeout=10)
                if resp.status_code == 200:
                    soup = BeautifulSoup(resp.text, "html.parser")
                    for a in soup.select('a.result-url'):
                        url = a.get('href', '')
                        if "tiktok.com/@" in url and "/video/" not in url:
                            if url not in tiktok_urls:
                                tiktok_urls.append(url)
            except Exception as e:
                print(f"DDG search error: {e}")
            await asyncio.sleep(2)
                        
        print(f"Found {len(tiktok_urls)} TikTok profiles. Scanning them for emails...")
        
        for url in tiktok_urls:
            if len(found_emails) >= 10: # Stop after finding 10 for this demo
                break
                
            print(f"  Scanning: {url}")
            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=15000)
                await page.wait_for_timeout(2000) # Let React render
                
                text_content = await page.evaluate("document.body.innerText")
                emails = extract_emails_from_text(text_content)
                
                for email in emails:
                    if "support@" in email or "info@" in email:
                        continue
                        
                    if email not in found_emails:
                        ok, reason = is_valid_email(email)
                        if ok:
                            print(f"    -> MATCH! Found valid email: {email}")
                            found_emails[email] = {
                                "address": email,
                                "is_valid": True,
                                "validated": True,
                                "creator_name": url.split("@")[-1].split("?")[0],
                                "creator_platform": "tiktok",
                                "creator_profile_url": url,
                                "reason": reason
                            }
                            
                            # Append to mail_list.json
                            out_file = "d:/Shivam/Outreach/app/data/mail_list.json"
                            try:
                                with open(out_file, "r") as f:
                                    existing = json.load(f)
                            except:
                                existing = []
                            existing.append(found_emails[email])
                            with open(out_file, "w") as f:
                                json.dump(existing, f, indent=2)
            except Exception as e:
                print(f"    Error scanning {url}: {e}")
                
        await browser.close()
        print(f"\nFinished! Found {len(found_emails)} TikTok emails.")

if __name__ == "__main__":
    asyncio.run(main())
