import sys
import json
from app.database.core import SessionLocal
from app.models.models import Creator, Email
from app.database.redis_core import get_redis

sys.path.append('.')

DATA_FILE = "d:/Shivam/Outreach/app/data/mail_list.json"

def migrate():
    print("Migrating JSON data to PostgreSQL...")
    try:
        with open(DATA_FILE, "r") as f:
            data = json.load(f)
    except Exception as e:
        print(f"Error reading JSON: {e}")
        return

    db = SessionLocal()
    redis_client = get_redis()
    
    success_count = 0
    for item in data:
        addr = item.get("address")
        creator_name = item.get("creator_name", "Unknown")
        platform = item.get("creator_platform", "Unknown")
        profile_url = item.get("creator_profile_url", "")
        is_valid = item.get("is_valid", False)
        
        # Check if email exists in DB
        existing_email = db.query(Email).filter(Email.address == addr).first()
        if existing_email:
            continue
            
        # Check if creator exists by profile_url (it has a unique constraint)
        creator = None
        if profile_url:
            creator = db.query(Creator).filter(Creator.profile_url == profile_url).first()
            
        if not creator:
            creator = Creator(
                name=creator_name,
                platform=platform,
                profile_url=profile_url
            )
            db.add(creator)
            db.flush() # Get creator.id
            
        new_email = Email(
            address=addr,
            creator_id=creator.id,
            is_valid=is_valid
        )
        db.add(new_email)
        db.commit()
        
        # Cache in Redis
        redis_client.sadd("scraped_emails", addr)
        
        success_count += 1
        print(f"Migrated: {addr}")

    db.close()
    print(f"Migration complete! {success_count} records inserted.")

if __name__ == "__main__":
    migrate()
