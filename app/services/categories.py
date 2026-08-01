# Creator outreach niches with representative bio keywords used to build
# DuckDuckGo dork queries. Keep keywords as phrases creators actually put in
# their own bio text (not generic labels) -- that's what a snippet match needs.
CATEGORIES: dict[str, list[str]] = {
    "couple_relationship": ["couple", "husband and wife", "boyfriend and girlfriend", "couple vlog"],
    "fitness_gym": ["fitness coach", "personal trainer", "gym", "workout"],
    "beauty_makeup": ["makeup artist", "beauty influencer", "skincare"],
    "fashion_style": ["fashion blogger", "style influencer", "outfit"],
    "food_cooking": ["food blogger", "home cook", "recipe creator"],
    "travel": ["travel blogger", "digital nomad", "travel vlog"],
    "gaming": ["gamer", "streamer", "gaming content"],
    "comedy_entertainment": ["comedian", "sketch comedy", "entertainer"],
    "family_parenting": ["mom blogger", "dad blogger", "parenting", "family vlog"],
    "pets_animals": ["dog mom", "pet influencer", "animal lover"],
    "tech_gadgets": ["tech reviewer", "gadget review", "tech creator"],
    "finance_business": ["entrepreneur", "small business owner", "finance creator"],
    "education_study": ["study creator", "educator", "student vlog"],
    "music": ["musician", "singer songwriter", "music creator"],
    "art_design": ["artist", "illustrator", "designer"],
    "diy_crafts": ["diy creator", "crafts", "handmade"],
    "health_wellness": ["wellness coach", "mental health advocate", "yoga instructor"],
    "motivation_lifestyle": ["lifestyle creator", "motivational speaker", "self improvement"],
    "sports": ["athlete", "sports content", "coach"],
    "photography": ["photographer", "photo creator"],
}

EMAIL_DOMAIN_HINTS = ["@gmail.com", "@yahoo.com", "@outlook.com", "@hotmail.com"]

# Explicit, unambiguous region qualifiers -- bare "us" collides with the
# pronoun and matches far too broadly; always quote the full phrase.
REGION_TERMS = ["United States", "US"]

# All 50 US states, used to widen/diversify the dork query pool beyond the
# two generic REGION_TERMS above (more unique queries = more distinct
# DuckDuckGo result pages instead of repeatedly re-hitting the same ones).
US_STATES = [
    "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado",
    "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho",
    "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana",
    "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
    "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada",
    "New Hampshire", "New Jersey", "New Mexico", "New York",
    "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
    "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
    "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington",
    "West Virginia", "Wisconsin", "Wyoming",
]

BUSINESS_QUALIFIERS = ["business", "collab", "contact", "management"]

# Applied to every result snippet regardless of category -- a result
# mentioning any of these is skipped outright so "run across every
# category" can't accidentally pull in adult/NSFW accounts.
UNSAFE_KEYWORDS = [
    "onlyfans", "nsfw", "18+", "xxx", "adult content", "escort",
    "nude", "porn", "fetish", "cam girl", "camgirl",
]


def is_family_friendly(text: str) -> bool:
    lowered = text.lower()
    return not any(term in lowered for term in UNSAFE_KEYWORDS)
