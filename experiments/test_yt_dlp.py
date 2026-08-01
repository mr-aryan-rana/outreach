import yt_dlp
import json

def get_channel_about(channel_url):
    ydl_opts = {
        'extract_flat': True,
        'quiet': True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        try:
            info = ydl.extract_info(channel_url, download=False)
            return info.get('description', '')
        except:
            return ""

print("Fetching channel info...")
desc = get_channel_about("https://www.youtube.com/@mkbhd")
print("Description Length:", len(desc))
print("Description snippet:", desc[:200])
