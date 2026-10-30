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
