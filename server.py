"""Memory Frame server: transcription, available voices and mood-based narration."""
from transcription import TranscriptionMixin
import json
import os
import re
import urllib.request
import urllib.error
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler

ROOT = Path(__file__).resolve().parent
API_KEY = os.environ.get('ELEVENLABS_API_KEY', '')
DEFAULT_VOICE_ID = 'pqHfZKP75CvOlQylNhV4'
VOICE_IDS = {'happy': DEFAULT_VOICE_ID, 'gentle': 'EXAVITQu4vr4xnSDxMaL', 'reflective': 'EXAVITQu4vr4xnSDxMaL', 'energetic': 'IKne3meq5aSn9XLyUdCD'}

MOOD_TERMS = {
    'happy': ('happy', 'laugh', 'birthday', 'celebrat', 'smil', 'joy', 'fun', 'wonderful', 'wedding'),
    'gentle': ('miss', 'sad', 'goodbye', 'loss', 'remember', 'tear', 'emotional', 'love'),
    'reflective': ('grandparent', 'grandfather', 'grandmother', 'childhood', 'years ago', 'old days', 'nostalg', 'history'),
    'energetic': ('adventure', 'exciting', 'travel', 'hike', 'explor', 'surpris', 'race', 'journey'),
}
VOICE_TERMS = {
    'happy': ('bella', 'bright', 'warm', 'cheerful', 'friendly'),
    'gentle': ('sarah', 'reassuring', 'soft', 'gentle', 'calm'),
    'reflective': ('joe', 'reflective', 'storytell', 'mature', 'thoughtful'),
    'energetic': ('charlie', 'energetic', 'enthusiastic', 'dynamic', 'excited'),
}


def detect_mood(story):
    lower = story.lower()
    scores = {mood: sum(lower.count(word) for word in words)
              for mood, words in MOOD_TERMS.items()}
    if not any(scores.values()):
        return 'happy'
    # Adventure terms take precedence over incidental emotional language.
    if scores['energetic'] and scores['energetic'] >= max(scores.values()):
        return 'energetic'
    return max(scores, key=scores.get)


def voice_catalog():
    request = urllib.request.Request(
        'https://api.elevenlabs.io/v2/voices?page_size=100',
        headers={'xi-api-key': API_KEY},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
    return result.get('voices', []), result.get('has_more', False)


def ranked_voices(voices, mood, requested_id=None):
    """Rank voices by mood, prioritising default voices for free API access."""
    terms = VOICE_TERMS[mood]

    def score(voice):
        labels = voice.get('labels') or {}
        description = ' '.join((voice.get('name') or '',
                                voice.get('description') or '',
                                ' '.join(str(v) for v in labels.values()))).lower()
        return sum(3 if term in (voice.get('name') or '').lower() else 1
                   for term in terms if term in description)

    # Library voices may be visible in My Voices but blocked by the free API.
    # Attempt premade/default voices before library voices, preserving mood ranking.
    premade = []
    other = []
    for voice in voices:
        vid = voice.get('voice_id')
        if not isinstance(vid, str) or not re.fullmatch(r'[A-Za-z0-9]{1,100}', vid):
            continue
        category = (voice.get('category') or '').lower()
        (premade if category in ('premade', 'default') else other).append(voice)

    ids = []
    # A frontend-selected voice may be a library voice; don't let it displace
    # every default voice from the limited fallback attempts.
    if requested_id:
        ids.append(requested_id)
    for group in (sorted(premade, key=score, reverse=True),
                  sorted(other, key=score, reverse=True)):
        for voice in group:
            vid = voice['voice_id']
            if vid not in ids:
                ids.append(vid)
    if DEFAULT_VOICE_ID not in ids:
        ids.append(DEFAULT_VOICE_ID)
    return ids


def synthesise(text, voice_id):
    body = json.dumps({'text': text, 'model_id': 'eleven_multilingual_v2'}).encode()
    request = urllib.request.Request(
        f'https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128',
        data=body,
        headers={'xi-api-key': API_KEY, 'Content-Type': 'application/json',
                 'Accept': 'audio/mpeg'},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read()


def eleven_error(error):
    try:
        data = json.loads(error.read())
        detail = data.get('detail', {})
        if isinstance(detail, dict):
            return str(detail.get('message') or detail.get('status') or error.code)
    except (ValueError, UnicodeDecodeError, AttributeError):
        pass
    return f'ElevenLabs error {error.code}'


class Handler(TranscriptionMixin, BaseHTTPRequestHandler):
    def send(self, status, data, content_type):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(data)

    def error(self, status, message):
        self.send(status, json.dumps({'error': message}).encode(), 'application/json')

    def list_voices(self):
        verified = [
            {'id': DEFAULT_VOICE_ID, 'name': 'Bill', 'description': 'Happy and general narration', 'labels': {}, 'preview': ''},
            {'id': VOICE_IDS['gentle'], 'name': 'Sarah', 'description': 'Emotional and nostalgic narration', 'labels': {}, 'preview': ''},
            {'id': VOICE_IDS['energetic'], 'name': 'Charlie', 'description': 'Adventure and energetic narration', 'labels': {}, 'preview': ''},
        ]
        self.send(200, json.dumps({'voices': verified, 'has_more': False}).encode(), 'application/json')

    def do_GET(self):
        route = self.path.split('?')[0]
        if route == '/voices':
            self.list_voices()
            return
        files = {'/': ('index.html', 'text/html; charset=utf-8'),
                 '/style.css': ('style.css', 'text/css'),
                 '/app.js': ('app.js', 'text/javascript')}
        if route not in files:
            self.error(404, 'Not found')
            return
        name, content_type = files[route]
        try:
            self.send(200, (ROOT / name).read_bytes(), content_type)
        except FileNotFoundError:
            self.error(404, f'Missing project file: {name}')

    def do_POST(self):
        if self.path == '/transcribe':
            self.transcribe_recording()
            return
        if self.path != '/generate':
            self.error(404, 'Not found')
            return
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':
            self.error(403, 'Open the app directly to generate audio.')
            return
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            self.error(415, 'JSON required')
            return
        if not API_KEY:
            self.error(500, 'Load your ElevenLabs API key in this terminal first.')
            return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 20000:
                self.error(400, 'Request is too large or empty.')
                return
            payload = json.loads(self.rfile.read(size))
            text = payload.get('text', '') if isinstance(payload, dict) else ''
            if not isinstance(text, str) or not 1 <= len(text.strip()) <= 3000:
                self.error(400, 'Enter between 1 and 3000 characters.')
                return
            requested_id = payload.get('voice_id')
            if requested_id is not None and (
                not isinstance(requested_id, str) or not re.fullmatch(r'[A-Za-z0-9]{1,100}', requested_id)
            ):
                self.error(400, 'Choose a valid voice.')
                return
        except (ValueError, UnicodeDecodeError):
            self.error(400, 'Could not read the story.')
            return

        mood = detect_mood(text)
        # Use only voices confirmed to work on this account.
        # The mood is authoritative even if the frontend sends its default dropdown voice.
        primary = VOICE_IDS[mood]
        candidates = [primary]
        if primary != DEFAULT_VOICE_ID:
            candidates.append(DEFAULT_VOICE_ID)
        last_error = 'No compatible voice found.'
        for voice_id in candidates:
            try:
                audio = synthesise(text.strip(), voice_id)
                self.send(200, audio, 'audio/mpeg')
                return
            except urllib.error.HTTPError as exc:
                last_error = eleven_error(exc)
                if exc.code in (401, 429) or exc.code >= 500:
                    break  # Key/credits/provider problems will not be fixed by switching voice.
                if exc.code not in (400, 403, 404, 422):
                    break
            except (urllib.error.URLError, TimeoutError):
                last_error = 'Could not reach ElevenLabs. Try again shortly.'
                break
        self.error(502, 'Narration failed: ' + last_error +
                   '. Check whether your account has API-compatible voices and credits.')


if __name__ == '__main__':
    print('Memory Frame running on port 8000')
    HTTPServer(('0.0.0.0', 8000), Handler).serve_forever()
