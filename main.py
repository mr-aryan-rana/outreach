import re
import json
from ddgs import DDGS
import time
import string

def clean_email(email_str):
    email = email_str.lower()
    # Remove any trailing non-alphabetical characters (like in .com.watch)
    while email and not email[-1].isalpha():
        email = email[:-1]
    
    # Simple check to drop blatantly invalid emails
    if len(email.split('@')) != 2 or len(email.split('.')) < 2:
        return None
    
    return email

def find_emails(target_count=50):
    ddgs = DDGS()
    emails_found = set()
    
    # Strict regex for email with boundaries
    email_pattern = r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b'
    
    print(f"Starting email search across platforms (Target: {target_count} unique emails)...")

    sites = ['site:instagram.com', 'site:youtube.com', 'site:tiktok.com']
    keywords = [
        '"collab" "USA"', '"sponsored" "USA"', '"paid promotion" "United States"',
        '"business inquiries"', '"brand deal" "USA"', '"collaboration" "United States"',
        '"collab" "NY"', '"sponsored" "CA"', '"paid promotion" "Texas"',
        '"couple vlog" "USA"', '"creator" "paid promotion" "USA"'
    ]
    
    # Generate infinite loop of variations if needed, but for now huge query list
    queries = []
    for site in sites:
        for kw in keywords:
            for letter in string.ascii_lowercase: 
                queries.append(f'{site} {kw} "@gmail.com" "{letter}"')
                queries.append(f'{site} {kw} "@yahoo.com" "{letter}"')

    for query in queries:
        if len(emails_found) >= target_count:
            break
            
        print(f"Searching: {query} (Current count: {len(emails_found)})")
        try:
            results = ddgs.text(query, max_results=30)
            
            for result in results:
                snippet = result.get('body', '')
                title = result.get('title', '')
                
                # Check for emails
                raw_emails = re.findall(email_pattern, snippet + " " + title)
                
                for raw_email in raw_emails:
                    email = clean_email(raw_email)
                    if email and email not in emails_found:
                        emails_found.add(email)
                        
                        if len(emails_found) >= target_count:
                            break
                            
                if len(emails_found) >= target_count:
                    break
                    
            time.sleep(2) 
            
        except Exception as e:
            print(f"Error on query {query}: {e}")

    return list(emails_found)

# Run the function to get 50 emails
emails_list = find_emails(50)

# Save to a JSON file
if emails_list:
    with open("emails.json", "w") as f:
        json.dump(emails_list, f, indent=4)
    print(f"Success! Saved {len(emails_list)} clean unique emails to emails.json")
else:
    print("No emails found. Try adjusting the search queries.")