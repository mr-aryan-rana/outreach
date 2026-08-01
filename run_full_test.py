import sys
import json
import time
sys.path.append('.')

from app.database.core import get_db, init_db
from app.services.creator_search import search_until_target
from app.models.models import Email, Creator

def run_full_test():
    init_db()
    db = next(get_db())
    
    print("Starting full overflow test...")
    print("Target: 30 valid emails")
    
    # We use instagram and "all" categories for a wide net
    stats = search_until_target(
        db=db,
        platform="instagram",
        category="all",
        target_valid=30,
        delay_sec=1.5  # slight delay to prevent instant ban from Yahoo
    )
    
    print("\nSearch complete. Stats:")
    for k, v in stats.items():
        print(f"  {k}: {v}")
        
    print("\nExporting up to 30 valid emails to mail_list.json...")
    valid_emails = db.query(Email, Creator).join(Creator).filter(Email.is_valid == True).limit(30).all()
    
    export_data = []
    for email, creator in valid_emails:
        export_data.append({
            "address": email.address,
            "is_valid": email.is_valid,
            "validated": True,
            "creator_name": creator.name,
            "creator_platform": creator.platform,
            "creator_profile_url": creator.profile_url,
            "phone": creator.phone,
            "send_status": email.send_status.value if email.send_status else None,
            "created_at": email.created_at.isoformat() if email.created_at else None
        })
        
    out_file = "d:/Shivam/Outreach/app/data/mail_list.json"
    with open(out_file, "w") as f:
        json.dump(export_data, f, indent=2)
        
    print(f"Exported {len(export_data)} emails to {out_file}")

if __name__ == "__main__":
    run_full_test()
