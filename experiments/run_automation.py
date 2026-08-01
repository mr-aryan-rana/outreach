import sys
import time
import datetime
from app.mailer.core import send_mass_emails
from run_social_scraper import run_scraper
from app.database.core import SessionLocal
from app.models.models import Email, EmailLog, Campaign

sys.path.append('.')

def get_already_emailed(db):
    # Returns set of email addresses that have an EmailLog indicating they were sent
    emailed_logs = db.query(Email.address).join(EmailLog).filter(EmailLog.status == "sent").all()
    return set([item[0] for item in emailed_logs])

def mark_as_emailed(db, addresses):
    # Find or create a default campaign
    campaign = db.query(Campaign).filter(Campaign.name == "Default Outreach").first()
    if not campaign:
        campaign = Campaign(name="Default Outreach", subject_template="[PLACEHOLDER]", body_template="[PLACEHOLDER]")
        db.add(campaign)
        db.flush()

    # Get email objects for these addresses
    emails = db.query(Email).filter(Email.address.in_(addresses)).all()
    
    for email in emails:
        log = EmailLog(
            email_id=email.id,
            campaign_id=campaign.id,
            status="sent",
            sent_at=datetime.datetime.now(datetime.timezone.utc)
        )
        db.add(log)
    db.commit()

def run_automation_cycle():
    print(f"\n--- Starting Automation Cycle at {datetime.datetime.now()} ---")
    
    db = SessionLocal()
    
    # Needs exactly 10 per platform
    quotas = {"youtube": 10, "tiktok": 10, "instagram": 10}
    collected = {"youtube": [], "tiktok": [], "instagram": []}
    
    already_emailed = get_already_emailed(db)
    
    queries = [
        ("family friendly gift ideas", "youtube"),
        ("family vlog creator business email", "youtube"),
        ("family friendly tiktok collab email", "tiktok"),
        ("gifts review tiktok business inquiries", "tiktok"),
        ("family vlog instagram business email", "instagram"),
        ("gift ideas instagram creator email", "instagram")
    ]
    
    # Run the scraper until quotas are filled or max attempts reached
    print("Gathering leads...")
    results = run_scraper(queries, min_followers=10000, max_followers=100000, max_results=30)
    
    # Allocate to buckets
    for r in results:
        addr = r['address']
        if addr in already_emailed:
            continue
            
        plat = r['creator_platform']
        if plat in quotas and len(collected[plat]) < quotas[plat]:
            collected[plat].append(addr)
            already_emailed.add(addr) # Prevent duplicates in same run
            
    all_addresses = collected["youtube"] + collected["tiktok"] + collected["instagram"]
    
    print(f"Collected total {len(all_addresses)} valid emails for this cycle.")
    print(f"Breakdown: {len(collected['youtube'])} YT | {len(collected['tiktok'])} TT | {len(collected['instagram'])} IG")
    
    if len(all_addresses) == 30:
        print("Quota reached! Sending mass emails...")
        subject = "[PLACEHOLDER] Collaboration Opportunity"
        body = "Hi there,\n\n[PLACEHOLDER] We love your content and would love to collaborate on a gift campaign!\n\nBest,\nMakeAble Team"
        
        success, msg = send_mass_emails(all_addresses, subject, body)
        if success:
            print("Successfully sent emails.")
            mark_as_emailed(db, all_addresses)
        else:
            print(f"Failed to send emails: {msg}")
    else:
        print(f"Did not reach strict 30 quota (Got {len(all_addresses)}). Skipping email send to avoid partial batches.")
        
    db.close()
    print(f"--- Cycle Complete ---\n")

def main():
    print("Starting 24-hour Automation Loop (10 runs / 24h)")
    # 24 hours / 10 = 2.4 hours = 8640 seconds
    SLEEP_SECONDS = 8640
    
    # Run first cycle immediately
    run_automation_cycle()
    
    while True:
        print(f"Sleeping for {SLEEP_SECONDS} seconds until next run...")
        time.sleep(SLEEP_SECONDS)
        run_automation_cycle()

if __name__ == "__main__":
    main()
