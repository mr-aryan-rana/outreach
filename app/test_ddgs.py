import logging
from app.services.creator_search import search_ddg, _get_new_proxy

logging.basicConfig(level=logging.INFO)

print('Testing _get_new_proxy...')
proxy = _get_new_proxy()
print(f'Got proxy: {proxy}')

print('\nTesting search_ddg...')
res = search_ddg('site:youtube.com "fitness"', max_results=5)
print(f'Found {len(res)} results.')
for r in res:
    print(r['url'])
