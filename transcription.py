import io
import json
from faster_whisper import WhisperModel

_model = None

class TranscriptionMixin:
    def transcribe_recording(self):
        global _model

        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            self.error(403, "Open the app directly to transcribe.")
            return

        content_type = self.headers.get("Content-Type", "")
        if not content_type.startswith("audio/"):
            self.error(415, "An audio recording is required.")
            return

        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.error(400, "Invalid recording size.")
            return

        if not 0 < size <= 10 * 1024 * 1024:
            self.error(400, "Recording must be smaller than 10 MB.")
            return

        recording = self.rfile.read(size)

        try:
            if _model is None:
                print("Loading Whisper...", flush=True)
                _model = WhisperModel(
                    "tiny.en",
                    device="cpu",
                    compute_type="int8",
                    cpu_threads=2,
                )

            segments, _ = _model.transcribe(
                io.BytesIO(recording),
                language="en",
                beam_size=5,
                vad_filter=True,
                condition_on_previous_text=False,
            )

            text = " ".join(
                segment.text.strip() for segment in segments
            ).strip()

            self.send(
                200,
                json.dumps({"text": text}).encode(),
                "application/json",
            )
        except Exception as error:
            __import__("traceback").print_exc()
            self.error(
                500,
                "Whisper could not transcribe this recording. "
                "Try a shorter recording and check the terminal.",
            )
