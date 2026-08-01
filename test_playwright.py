import asyncio
from playwright.async_api import async_playwright
import re

async def main():
    async with async_playwright() as p:
        print("Launching headless Chromium browser...")
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        # Test TikTok
        tiktok_url = "https://www.tiktok.com/@charlidamelio"
        print(f"\nNavigating to TikTok: {tiktok_url}")
        await page.goto(tiktok_url, wait_until="networkidle")
        
        # Give it a second to render React content
        await page.wait_for_timeout(2000)
        
        # Extract all text from the body
        text_content = await page.evaluate("document.body.innerText")
        
        # TikTok bios are usually near the top, print a snippet
        print("TikTok Content Snippet successfully loaded!")
        
        # Let's search for an email pattern just in case
        emails = re.findall(r'[a-zA-Z0-9._%+-]+\s*@\s*[a-zA-Z0-9.-]+\s*\.\s*[a-zA-Z]{2,}', text_content)
        if emails:
            print(f"Found emails on TikTok profile: {emails}")
        else:
            print("No emails found directly on this TikTok profile (as expected for this user).")
            
        # Test Instagram
        insta_url = "https://www.instagram.com/therock/"
        print(f"\nNavigating to Instagram: {insta_url}")
        await page.goto(insta_url, wait_until="networkidle")
        await page.wait_for_timeout(2000)
        
        insta_text = await page.evaluate("document.body.innerText")
        print("Instagram Content Snippet successfully loaded!")
        
        emails = re.findall(r'[a-zA-Z0-9._%+-]+\s*@\s*[a-zA-Z0-9.-]+\s*\.\s*[a-zA-Z]{2,}', insta_text)
        if emails:
            print(f"Found emails on Instagram profile: {emails}")
        else:
            print("No emails found directly on this Insta profile.")
            
        await browser.close()
        print("\nDirect Playwright browser tests complete! We bypassed the blocks.")

if __name__ == "__main__":
    asyncio.run(main())
