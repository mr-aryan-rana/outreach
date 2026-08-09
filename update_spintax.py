import os
from sqlalchemy import update
from app.database.core import SessionLocal
from app.models.models import Campaign

subject_spintax = "{Partnership Opportunity with MakeAble|Collab Inquiry: MakeAble|Quick question about your content|Let's collaborate - MakeAble 3D|MakeAble 3D AI Platform - Partnership}"

body_spintax = """{{Hi|Hello|Dear}, hope you're doing well! I'm reaching out from MakeAble, an AI platform that transforms photos into high-quality 3D models in just a few clicks.|{Hi|Hello|Dear}, I love your content! We're MakeAble, an AI tool that turns standard photos into incredible 3D models instantly.|{Hello|Hi|Dear}, reaching out from MakeAble.nyc. We've built an AI platform that generates 3D models from regular photos, and we think your audience would love it.|{Hi|Hello|Dear}! We are MakeAble, a new AI platform that lets anyone create high-quality 3D models from simple 2D photos. We are looking for creators like you...|{Hi|Hello|Dear}, hope you're having a great week. I'm with MakeAble, an AI that transforms photos into 3D models in just a few clicks.}

You can explore it here: https://makeable.nyc

We are looking for creators to join our affiliate program. Please reply with your mobile number, contact details, and all your social account profile links.

Best,
MakeAble Team"""

db = SessionLocal()
campaign = db.query(Campaign).filter(Campaign.name == "MakeAble Affiliate Program").first()
if campaign:
    campaign.subject_template = subject_spintax
    campaign.body_template = body_spintax
    db.commit()
    print("Updated MakeAble campaign to use {Hi|Hello|Dear} greetings without names and added contact request.")
else:
    print("Campaign not found.")
db.close()
