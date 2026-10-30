from transcription import TranscriptionMixin
import json
import os
import urllib.request
import urllib.error
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler

ROOT = Path(__file__).resolve().parent
API_KEY = os.environ.get("ELEVENLABS_API_KEY", "")
VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"

class Handler(TranscriptionMixin, BaseHTTPRequestHandler):
    def send(self, status, data, content_type):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def error(self, status, message):
        self.send(
            status,
            json.dumps({"error": message}).encode(),
            "application/json",
        )


    def list_voices(self):
        request = urllib.request.Request(
            "https://api.elevenlabs.io/v2/voices?page_size=100",
            headers={"xi-api-key": API_KEY},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                result = json.load(response)
            voices = [{
                "id": voice["voice_id"],
                "name": voice.get("name", "Unnamed voice"),
                "description": voice.get("description") or "",
                "labels": voice.get("labels") or {},
                "preview": voice.get("preview_url") or "",
            } for voice in result.get("voices", [])]
            self.send(200, json.dumps({
                "voices": voices,
                "has_more": result.get("has_more", False),
            }).encode(), "application/json")
        except urllib.error.HTTPError:
            self.error(502, "Cannot load voices. Check API key and Voices Read permission.")
        except (urllib.error.URLError, TimeoutError, ValueError):
            self.error(502, "Could not load voices. Check your connection and refresh.")

    def do_GET(self):
        if self.path == "/voices":
            self.list_voices()
            return
        files = {
            "/": ("index.html", "text/html; charset=utf-8"),
            "/style.css": ("style.css", "text/css"),
            "/app.js": ("app.js", "text/javascript"),
        }
        route = self.path.split("?")[0]
        if route not in files:
            self.error(404, "Not found")
            return
        name, content_type = files[route]
        self.send(200, (ROOT / name).read_bytes(), content_type)

    def do_POST(self):
        if self.path == "/transcribe":
            self.transcribe_recording()
            return
        if self.path != "/generate":
            self.error(404, "Not found")
            return

        # Only accept requests from our own page.
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            self.error(403, "Open the app directly to generate audio.")
            return
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            self.error(415, "JSON required")
            return
        if not API_KEY:
            self.error(500, "Load your API key in this terminal first.")
            return

        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 20000:
                self.error(400, "Request is too large or empty.")
                return
            payload = json.loads(self.rfile.read(size))
            text = payload.get("text", "") if isinstance(payload, dict) else ""
            if not isinstance(text, str) or not 1 <= len(text.strip()) <= 3000:
                self.error(400, "Enter between 1 and 3000 characters.")
                return
        except (ValueError, UnicodeDecodeError):
            self.error(400, "Could not read the story.")
            return

        voice_id = payload.get("voice_id", VOICE_ID)
        if (not isinstance(voice_id, str)
                or not voice_id.isalnum()
                or len(voice_id) > 100):
            self.error(400, "Choose a valid voice.")
            return

        body = json.dumps({
            "text": text.strip(),
            "model_id": "eleven_multilingual_v2",
        }).encode()

        request = urllib.request.Request(
            f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
            "?output_format=mp3_44100_128",
            data=body,
            headers={
                "xi-api-key": API_KEY,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            },
        )

        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                audio = response.read()
            self.send(200, audio, "audio/mpeg")
        except urllib.error.HTTPError as error:
            try:
                result = json.loads(error.read())
                detail = result.get("detail", {})
                message = detail.get("message") if isinstance(detail, dict) else None
                if isinstance(message, str) and message:
                    self.error(502, message)
                    return
            except (ValueError, AttributeError):
                pass
            messages = {
                401: "ElevenLabs rejected the API key. Reload it and restart.",
                403: "Check your key's Text to Speech permission and voice access.",
                429: "ElevenLabs is limiting requests. Check credits and retry later.",
            }
            self.error(502, messages.get(
                error.code,
                f"ElevenLabs returned error {error.code}. Check your account and credits.",
            ))
        except (urllib.error.URLError, TimeoutError):
            self.error(502, "Could not reach ElevenLabs. Try again shortly.")

if __name__ == "__main__":
    print("Memory Frame running on port 8000")
    HTTPServer(("0.0.0.0", 8000), Handler).serve_forever()
