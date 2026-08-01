import sys
import json
import yt_dlp
from app.extractor.core import extract_emails_from_text
from app.validator.core import is_valid_email
import re

sys.path.append('.')

def run_ytdlp_scraper():
    print("Starting direct YouTube video search to find 30 creator emails...")
    
    queries = [
        "fitness vlog business inquiries email",
        "makeup tutorial business inquiries email",
        "tech review business email",
        "travel vlog collab email",
        "lifestyle vlog PR email",
        "gaming setup tour business email"
    ]
    
    found_emails = {}
    
    for query in queries:
        if len(found_emails) >= 30:
            break
            
        print(f"\nSearching YouTube for: {query}")
        
        ydl_opts = {
            'extract_flat': True,
            'quiet': True,
            'ignoreerrors': True,
            'no_warnings': True
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # ytsearch30: searches for 30 videos matching the query
            try:
                info = ydl.extract_info(f"ytsearch30:{query}", download=False)
            except Exception as e:
                print(f"Error extracting from YouTube: {e}")
                continue
                
            if not info or 'entries' not in info:
                continue
                
            for entry in info['entries']:
                if not entry:
                    continue
                    
                # We need to fetch the video page to get the description
                video_url = entry.get('url')
                if not video_url:
                    continue
                    
                print(f"  Checking video: {video_url}")
                try:
                    # Fetch single video info
                    v_info = ydl.extract_info(video_url, download=False)
                    desc = v_info.get('description', '')
                    title = v_info.get('title', 'Unknown')
                    uploader = v_info.get('uploader', 'Unknown')
                    uploader_url = v_info.get('uploader_url', video_url)
                    
                    if not desc:
                        continue
                        
                    emails = extract_emails_from_text(desc)
                    for email in emails:
                        # Ignore common false positives or domain mismatches
                        if "support@" in email or "info@" in email:
                            continue
                            
                        if email not in found_emails:
                            # Validate using our app's core validator
                            ok, reason = is_valid_email(email)
                            if ok:
                                print(f"    -> MATCH! Found valid email: {email} (Creator: {uploader})")
                                found_emails[email] = {
                                    "address": email,
                                    "is_valid": True,
                                    "validated": True,
                                    "creator_name": uploader,
                                    "creator_platform": "youtube",
                                    "creator_profile_url": uploader_url,
                                    "reason": reason
                                }
                                
                                # Write incrementally
                                out_file = "d:/Shivam/Outreach/app/data/mail_list.json"
                                with open(out_file, "w") as f:
                                    json.dump(list(found_emails.values()), f, indent=2)
                                    
                                if len(found_emails) >= 30:
                                    break
                except Exception as e:
                    pass
                    
                if len(found_emails) >= 30:
                    break
                    
    print(f"\nFinished! Found {len(found_emails)} emails.")

if __name__ == "__main__":
    run_ytdlp_scraper()
