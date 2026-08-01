import sys
sys.path.append('.')
from app.services.creator_search import search_ddg

try:
    results = search_ddg('site:instagram.com "yoga" "NY" "@gmail.com"', 2)
    print("SUCCESS")
    print(results)
except Exception as e:
    print("FAILED")
    print(e)
