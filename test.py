from ddgs import DDGS
import json

def test():
    ddgs = DDGS()
    results = list(ddgs.text('site:tiktok.com couple vlog gmail', max_results=5))
    print(json.dumps(results, indent=2))

if __name__ == "__main__":
    test()
