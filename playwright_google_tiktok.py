import asyncio
import json
import re
from playwright.async_api import async_playwright
from app.extractor.core import extract_emails_from_text
from app.validator.core import is_valid_email
import sys
sys.path.append('.')

async def main():
    print("Starting Playwright TikTok Scraper via Google...")
    found_emails = {}
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        )
        page = await context.new_page()
        
        tiktok_urls = [
            "https://www.tiktok.com/@demibagby",
            "https://www.tiktok.com/@jessejameswest",
            "https://www.tiktok.com/@blogilates",
            "https://www.tiktok.com/@ulissesworld",
            "https://www.tiktok.com/@antonielokhorst",
            "https://www.tiktok.com/@bradley.martyn",
            "https://www.tiktok.com/@fitwsally",
            "https://www.tiktok.com/@charlidamelio",
            "https://www.tiktok.com/@therock",
            "https://www.tiktok.com/@willsmith"
        ]
        print(f"Loaded {len(tiktok_urls)} TikTok profiles! Scanning them for emails...")
        
        # 2. Visit TikTok profiles
        for url in tiktok_urls:
                if len(found_emails) >= 10:
                    break
                    
                print(f"  Scanning: {url}")
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=15000)
                    await page.wait_for_timeout(2500) # Let React render
                    
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
                                    "creator_name": url.split("@")[-1],
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
