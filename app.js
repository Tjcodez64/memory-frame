const story = document.getElementById("story");
const save = document.getElementById("save");
const play = document.getElementById("play");
const stop = document.getElementById("stop");
const status = document.getElementById("status");

let audio = null;
let audioUrl = null;

save.textContent = "Generate ElevenLabs narration";
play.disabled = true;

const download = document.createElement("a");
download.textContent = "Download narration MP3 ↓";
download.download = "memory.mp3";
download.style.cssText =
  "display:none;margin:20px 0;text-align:center;color:#285344;font-weight:bold";
stop.after(download);

document.querySelector("small").textContent =
  "Generate sends your text to ElevenLabs and uses account credits. " +
  "Replay uses the same audio without generating again. " +
  "Download the MP3 to keep it: this page does not retain audio after refreshing.";

try {
  story.value = localStorage.getItem("memory-frame-story") || "";
} catch {}

story.addEventListener("input", () => {
  status.textContent =
    "Story edited. Generate again to update the narration.";
});

save.addEventListener("click", async () => {
  const text = story.value.trim();
  if (!text) {
    status.textContent = "Write your memory first.";
    return;
  }

  save.disabled = true;
  story.disabled = true;
  play.disabled = true;
  if (audio) audio.pause();
  status.textContent = "Creating your narration with ElevenLabs…";

  try {
    const response = await fetch("/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice_id: voiceSelect.value }),
    });

    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || "Generation failed.");
    }

    const blob = await response.blob();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(blob);
    audio = new Audio(audioUrl);

    audio.onended = () => {
      status.textContent = "Touch again to hear your memory.";
    };
    audio.onerror = () => {
      status.textContent = "Audio could not play. Try downloading the MP3.";
    };

    download.href = audioUrl;
    download.style.display = "block";

    try {
      localStorage.setItem("memory-frame-story", text);
    } catch {}

    status.textContent =
      "Narration ready! Touch to hear, then download your MP3.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    save.disabled = false;
    story.disabled = false;
    play.disabled = !audio;
  }
});

play.addEventListener("click", async () => {
  if (!audio) return;
  audio.currentTime = 0;
  try {
    await audio.play();
    status.textContent = "Telling your memory…";
  } catch {
    status.textContent = "Playback failed. Check media volume and try again.";
  }
});

stop.addEventListener("click", () => {
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
  status.textContent = "Playback stopped.";
});


// Mood suggestions and voice selection.
const styles = {
  warm: {
    name: "Warm & nostalgic",
    words: ["warm", "gentle", "soft", "friendly", "comforting"],
  },
  bright: {
    name: "Bright & cheerful",
    words: ["bright", "cheerful", "upbeat", "happy", "energetic"],
  },
  lively: {
    name: "Lively & adventurous",
    words: ["lively", "expressive", "dynamic", "energetic", "exciting"],
  },
  reflective: {
    name: "Soft & reflective",
    words: ["soft", "calm", "gentle", "soothing", "reflective"],
  },
};

const panel = document.createElement("section");
panel.className = "voice-panel";
panel.innerHTML = `
  <h2>Give your memory a voice</h2>

  <label for="mood">Story mood</label>
  <select id="mood"></select>

  <button type="button" id="suggest" class="secondary">
    Suggest from my words
  </button>

  <p id="mood-note" aria-live="polite"></p>

  <label for="voice-select">Narrator</label>
  <select id="voice-select">
    <option value="JBFqnCBsd6RMkjVDRZzb">George — default</option>
  </select>

  <p id="voice-note" aria-live="polite">Loading voice choices…</p>

  <button type="button" id="preview-voice" class="secondary" disabled>
    Preview voice sample
  </button>
  <audio id="voice-sample" controls hidden></audio>

  <small>
    Preview is an existing sample, not your story.
    Changing the narrator applies to your next generation.
  </small>
`;
save.before(panel);

const moodSelect = document.getElementById("mood");
const voiceSelect = document.getElementById("voice-select");
const moodNote = document.getElementById("mood-note");
const voiceNote = document.getElementById("voice-note");
const preview = document.getElementById("preview-voice");
const sample = document.getElementById("voice-sample");

let voiceChoices = [];
let automaticMood = true;
let automaticVoice = true;

for (const [id, style] of Object.entries(styles)) {
  moodSelect.add(new Option(style.name, id));
}

function guessMood(text) {
  const words = text.toLowerCase();

  // Reflective phrases take priority over celebration words.
  if (/\b(miss|missing|passed away|goodbye|grief|in memory|last time)\b/.test(words)) {
    return ["reflective", "Some words suggest remembrance or missing someone."];
  }
  if (/\b(sweet sixteen|sweet 16|childhood|nostalgic|mum|dad|grandma|grandad)\b/.test(words)) {
    return ["warm", "Family or nostalgic words suggest a warm telling."];
  }
  if (/\b(adventure|exploring|hiking|road trip|climbing|surfing)\b/.test(words)) {
    return ["lively", "Adventure words suggest an expressive telling."];
  }
  if (/\b(birthday|party|celebration|celebrate|celebrating|laugh|laughing)\b/.test(words)) {
    return ["bright", "Celebration words suggest an upbeat telling."];
  }
  return ["warm", "No clear mood detected; warm is our starting point."];
}

function showVoice() {
  sample.pause();
  sample.hidden = true;
  sample.removeAttribute("src");
  sample.load();

  const voice = voiceChoices.find(v => v.id === voiceSelect.value);
  preview.disabled = !voice?.preview;

  voiceNote.textContent = voice
    ? (voice.description || "No description available.") +
      (voice.preview ? "" : " No preview sample available.")
    : "Using the default narrator. Voice choices have not loaded.";
}

function matchVoice() {
  if (!voiceChoices.length) return;

  const keywords = styles[moodSelect.value].words;
  const ranked = voiceChoices.map(voice => {
    const description = [
      voice.name,
      voice.description,
      ...Object.values(voice.labels),
    ].join(" ").toLowerCase();

    return {
      voice,
      score: keywords.filter(word => description.includes(word)).length,
    };
  }).sort((a, b) => b.score - a.score);

  if (ranked[0].score > 0) {
    voiceSelect.value = ranked[0].voice.id;
    showVoice();
    voiceNote.textContent =
      "Suggested from the voice description. " + voiceNote.textContent;
  } else {
    showVoice();
    voiceNote.textContent =
      "No clear voice match—preview and choose one yourself. " +
      voiceNote.textContent;
  }
}

function suggestMood() {
  const [mood, reason] = guessMood(story.value);
  moodSelect.value = mood;
  moodNote.textContent = reason + " You can change this suggestion.";
  if (automaticVoice) matchVoice();
}

story.addEventListener("input", () => {
  if (automaticMood) suggestMood();
});

moodSelect.addEventListener("change", () => {
  automaticMood = false;
  moodNote.textContent = "You chose this mood.";
  if (automaticVoice) matchVoice();
});

voiceSelect.addEventListener("change", () => {
  automaticVoice = false;
  showVoice();
});

document.getElementById("suggest").onclick = () => {
  automaticMood = true;
  automaticVoice = true;
  suggestMood();
};

preview.onclick = async () => {
  const voice = voiceChoices.find(v => v.id === voiceSelect.value);
  if (!voice?.preview) return;

  if (audio) audio.pause();
  sample.src = voice.preview;
  sample.hidden = false;

  try {
    await sample.play();
  } catch {
    voiceNote.textContent =
      "Preview could not start. Try its play control or another voice.";
  }
};

sample.onerror = () => {
  voiceNote.textContent = "This preview could not load. Try another voice.";
};

save.addEventListener("click", () => sample.pause());
play.addEventListener("click", () => sample.pause());
stop.addEventListener("click", () => sample.pause());

suggestMood();

fetch("/voices")
  .then(async response => {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  })
  .then(result => {
    voiceChoices = result.voices;
    if (!voiceChoices.length) throw new Error("No voices returned by ElevenLabs.");

    voiceSelect.replaceChildren();
    voiceChoices.forEach(voice => {
      voiceSelect.add(new Option(voice.name, voice.id));
    });
    matchVoice();

    if (result.has_more) {
      const note = document.createElement("small");
      note.textContent = "Showing the first 100 returned voices.";
      panel.append(note);
    }
  })
  .catch(error => {
    voiceNote.textContent =
      error.message + " Default George is still available to try.";
  });



// MEMORY FRAME MICROPHONE — Whisper recording
const micButton = document.createElement("button");
micButton.id = "mic-button";
micButton.type = "button";
micButton.textContent = "🎙 Record your memory";

const micHelp = document.createElement("p");
micHelp.id = "mic-help";
micHelp.setAttribute("role", "status");
micHelp.textContent =
  "Record up to 2 minutes. Whisper transcribes after you stop.";

const recordingPlayer = document.createElement("audio");
recordingPlayer.controls = true;
recordingPlayer.hidden = true;

story.before(micButton, micHelp, recordingPlayer);

let recorder = null;
let recordingStream = null;
let recordingTimer = null;
let recordingUrl = null;
let busyRecording = false;

function releaseMicrophone() {
  clearTimeout(recordingTimer);
  recordingStream?.getTracks().forEach(track => track.stop());
  recordingStream = null;
}

function lockControls(locked) {
  story.disabled = locked;
  save.disabled = locked;
  play.disabled = locked || !audio;
  preview.disabled = locked ||
    !voiceChoices.find(v => v.id === voiceSelect.value)?.preview;
}

if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
  micButton.disabled = true;
  micHelp.textContent =
    "Recording is unavailable here. Open the app in Chrome over HTTPS.";
}

micButton.onclick = async () => {
  if (recorder?.state === "recording") {
    micButton.disabled = true;
    recorder.stop();
    return;
  }
  if (busyRecording) return;

  busyRecording = true;
  micButton.disabled = true;
  lockControls(true);

  if (audio) audio.pause();
  sample.pause();
  recordingPlayer.pause();

  // Keep the existing story; append this recording only once.
  const previousStory = story.value.trim();

  try {
    micHelp.textContent = "Allow microphone access to begin.";
    recordingStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });

    const mimeType = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
    ].find(type => MediaRecorder.isTypeSupported(type));

    recorder = mimeType
      ? new MediaRecorder(recordingStream, { mimeType })
      : new MediaRecorder(recordingStream);

    const chunks = [];
    let recordingFailed = false;

    recorder.ondataavailable = event => {
      if (event.data.size) chunks.push(event.data);
    };

    recorder.onerror = () => {
      recordingFailed = true;
      releaseMicrophone();
      busyRecording = false;
      lockControls(false);
      micButton.disabled = false;
      micButton.classList.remove("listening");
      micButton.textContent = "🎙 Record your memory";
      micHelp.textContent = "Recording failed. Please try again.";
    };

    recorder.onstop = async () => {
      releaseMicrophone();
      if (recordingFailed) return;

      micButton.disabled = true;
      micButton.classList.remove("listening");
      micButton.textContent = "Transcribing…";

      try {
        const blob = new Blob(chunks, {
          type: recorder.mimeType || "audio/webm",
        });

        if (!blob.size) throw new Error("No audio was recorded.");
        if (blob.size > 10 * 1024 * 1024) {
          throw new Error("Recording is too large. Try a shorter one.");
        }

        if (recordingUrl) URL.revokeObjectURL(recordingUrl);
        recordingUrl = URL.createObjectURL(blob);
        recordingPlayer.src = recordingUrl;
        recordingPlayer.hidden = false;

        micHelp.textContent =
          "Whisper is transcribing in your Codespace. Please wait…";

        const response = await fetch("/transcribe", {
          method: "POST",
          headers: { "Content-Type": blob.type },
          body: blob,
        });

        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Transcription failed.");
        }

        if (!result.text?.trim()) {
          micHelp.textContent =
            "No speech detected. Listen to your recording and try again.";
          return;
        }

        story.value = [previousStory, result.text.trim()]
          .filter(Boolean).join("\n\n");

        story.dispatchEvent(new Event("input", { bubbles: true }));

        micHelp.textContent = story.value.length > 3000
          ? "Transcribed. Shorten the story to 3000 characters before generating."
          : "Transcribed! Review the words, then choose your narration voice.";
      } catch (error) {
        micHelp.textContent = error.message;
      } finally {
        busyRecording = false;
        lockControls(false);
        micButton.disabled = false;
        micButton.textContent = "🎙 Record more";
      }
    };

    recorder.start();
    micButton.disabled = false;
    micButton.classList.add("listening");
    micButton.textContent = "■ Stop & transcribe";
    micHelp.textContent =
      "Recording… Speak naturally. Tap Stop & transcribe when finished.";

    recordingTimer = setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, 120000);
  } catch (error) {
    releaseMicrophone();
    busyRecording = false;
    lockControls(false);
    micButton.disabled = false;
    micButton.textContent = "🎙 Record your memory";
    micHelp.textContent = error.name === "NotAllowedError"
      ? "Microphone access was denied. Allow it in Chrome's site settings."
      : "Could not start recording. Check microphone access and try again.";
  }
};
