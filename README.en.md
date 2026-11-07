# CommentPulse

CommentPulse analyzes the sentiment of YouTube comments. You can analyze a single video or compare several videos and export an HTML report.

1. From the GitHub repository, choose **Code → Download ZIP**, extract it, and open a terminal in the extracted folder. If the repository is private, accept the owner's GitHub invitation first.
2. Install Python 3.11 and the project dependencies using the commands below.
3. Edit the `.env` file in the project folder. Enable **YouTube Data API v3** in your Google Cloud project, create an API key, and enter it as `YOUTUBE_API_KEY`. Leave `DEEPSEEK_API_KEY` blank for basic analysis. Add your own DeepSeek key if you want AI topic summaries, review, sponsorship screening, or translations. [YouTube API setup guide](https://developers.google.com/youtube/v3/guides/authentication)
4. Start the server with the last command below and open [CommentPulse in English](http://127.0.0.1:8000/?lang=en). Keep the terminal open while you use it.

## macOS or Linux

```bash
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp -n .env.example .env
# Fill in .env before starting the server.
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

## Windows PowerShell

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (!(Test-Path .env)) { Copy-Item .env.example .env }
# Fill in .env before starting the server.
.\.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Paste a public YouTube video link with comments enabled and click **Analyze**. The first analysis downloads the sentiment model from Hugging Face (about 500 MB). For multiple videos, choose **Batch analysis** at the top of the page.
