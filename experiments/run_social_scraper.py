import sys
import yt_dlp
from app.extractor.core import extract_emails_from_text
from app.validator.core import is_valid_email
from app.database.core import SessionLocal
from app.models.models import Creator, Email
from app.database.redis_core import get_redis

sys.path.append('.')

def run_scraper(queries_input, min_followers=10000, max_followers=100000, max_results=15):
    """
    Called by Streamlit or automation script. 
    queries_input: list of tuples like [("query string", "platform")]
    """
    print(f"Starting targeted search for micro-influencers ({min_followers}-{max_followers})...")
    
    found_emails = []
    
    # Avoid businesses, agencies, startups
    business_keywords = ["startup", "agency", "media", "store", "shop", "official", "inc", "llc", "company", "brand", "network"]
    
    ydl_opts = {
        'extract_flat': False,
        'quiet': True,
        'no_warnings': True,
        'ignoreerrors': True,
    }
    
    db = SessionLocal()
    redis_client = get_redis()
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        for query, platform in queries_input:
            print(f"\nSearching YouTube for {platform.upper()} creators via query: {query}")
            try:
                results = ydl.extract_info(f"ytsearch{max_results}:{query}", download=False)
                if not results or 'entries' not in results:
                    continue
                    
                for entry in results['entries']:
                    if not entry:
                        continue
                        
                    video_url = entry.get('webpage_url')
                    creator_name = entry.get('uploader', 'Unknown')
                    desc = entry.get('description', '')
                    profile_url = entry.get('channel_url', video_url)
                    
                    # 1. Filter out businesses and startups
                    if any(bad_word in creator_name.lower() for bad_word in business_keywords):
                        continue
                        
                    # 2. Filter by follower count
                    subs = entry.get('channel_follower_count', 0)
                    if not subs:
                        subs = 0
                        
                    if not (min_followers <= subs <= max_followers):
                        continue
                        
                    emails = extract_emails_from_text(desc)
                    for email in emails:
                        if "support@" in email or "info@" in email:
                            continue
                            
                        # Quick Redis check before DB check
                        if redis_client.sismember("scraped_emails", email):
                            continue
                            
                        # Avoid duplicates in current run
                        if not any(e.get("address") == email for e in found_emails):
                            ok, reason = is_valid_email(email)
                            if ok:
                                # Insert into DB
                                existing_email = db.query(Email).filter(Email.address == email).first()
                                if existing_email:
                                    redis_client.sadd("scraped_emails", email)
                                    continue
                                    
                                creator = db.query(Creator).filter(Creator.profile_url == profile_url).first()
                                if not creator:
                                    creator = Creator(
                                        name=creator_name,
                                        platform=platform,
                                        profile_url=profile_url
                                    )
                                    db.add(creator)
                                    db.flush()
                                    
                                new_email = Email(
                                    address=email,
                                    creator_id=creator.id,
                                    is_valid=True
                                )
                                db.add(new_email)
                                db.commit()
                                
                                redis_client.sadd("scraped_emails", email)
                                
                                payload = {
                                    "address": email,
                                    "is_valid": True,
                                    "validated": True,
                                    "creator_name": creator_name,
                                    "creator_platform": platform,
                                    "creator_profile_url": profile_url,
                                    "reason": reason
                                }
                                found_emails.append(payload)
                                print(f"    -> DB Saved! Found valid email: {email} (Creator: {creator_name})")

            except Exception as e:
                print(f"Error during search: {e}")
    
    db.close()
    return found_emails

if __name__ == "__main__":
    queries = [
        ("family vlog instagram business email", "instagram"),
        ("gift ideas instagram creator email", "instagram")
    ]
    run_scraper(queries)
