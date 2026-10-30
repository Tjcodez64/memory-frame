
// Save one narration in this browser.
let restoringAudio = true;
let audioSaveFailed = false;

function storedAudio(mode, value) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("memory-frame-audio", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("memory");
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Storage blocked"));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction("memory", mode);
      const store = tx.objectStore("memory");
      const operation = mode === "readonly"
        ? store.get("current")
        : store.put(value, "current");
      tx.oncomplete = () => {
        db.close();
        resolve(operation.result);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error || new Error("Storage failed"));
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error("Storage failed"));
      };
    };
  });
}

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
  "Narration saves in this browser. Download a backup: clearing browser data removes saved audio.";

try {
  story.value = localStorage.getItem("memory-frame-story") || "";
} catch {}

story.addEventListener("input", () => {
  status.textContent =
    "Story edited. Generate again to update the narration.";
});

save.addEventListener("click", async () => {
  if (restoringAudio) return;
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
    audioSaveFailed = false;
    try {
      await storedAudio("readwrite", { blob, text });
    } catch {
      audioSaveFailed = true;
    }

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
      audioSaveFailed
        ? "Audio is ready but could not be saved. Download it before leaving."
        : "Narration saved in this browser! Refresh and it will still be here.";
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

// Restore saved audio without calling ElevenLabs.
save.disabled = true;
story.disabled = true;
micButton.disabled = true;
status.textContent = "Loading saved narration…";

(async () => {
  try {
    const saved = await storedAudio("readonly");
    if (saved && saved.blob instanceof Blob && saved.blob.size) {
      story.value = saved.text;
      story.dispatchEvent(new Event("input", { bubbles: true }));
      audioUrl = URL.createObjectURL(saved.blob);
      audio = new Audio(audioUrl);
      audio.onended = () => {
        status.textContent = "Touch again to hear your memory.";
      };
      audio.onerror = () => {
        status.textContent = "Playback failed. Try downloading the MP3.";
      };
      download.href = audioUrl;
      download.style.display = "block";
      status.textContent = "Saved narration restored! Touch to hear it.";
    } else {
      status.textContent = "Generate narration to save it in this browser.";
    }
  } catch {
    status.textContent = "Browser storage is unavailable. Download your narration to keep it.";
  } finally {
    restoringAudio = false;
    save.disabled = false;
    story.disabled = false;
    play.disabled = !audio;
    micButton.disabled =
      !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder;
  }
})();

// Remove the saved story and generated narration.
const clearMemory = document.createElement("button");
clearMemory.id = "clear-memory";
clearMemory.type = "button";
clearMemory.className = "secondary";
clearMemory.textContent = "Clear memory";
download.after(clearMemory);

clearMemory.onclick = async () => {
  if (save.disabled || busyRecording) {
    status.textContent = "Wait for the current task to finish first.";
    return;
  }

  if (!confirm("Delete this browser's saved story and narration? Downloaded MP3 files will remain.")) {
    return;
  }

  clearMemory.disabled = true;
  save.disabled = true;
  micButton.disabled = true;

  try {
    // Replace the stored record with an empty value.
    await storedAudio("readwrite", null);

    let textCleared = true;
    try {
      localStorage.removeItem("memory-frame-story");
    } catch {
      textCleared = false;
    }

    if (audio) audio.pause();
    audio = null;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = null;

    sample.pause();
    recordingPlayer.pause();
    recordingPlayer.removeAttribute("src");
    recordingPlayer.load();
    recordingPlayer.hidden = true;
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    recordingUrl = null;

    download.removeAttribute("href");
    download.style.display = "none";
    play.disabled = true;
    story.value = "";
    story.dispatchEvent(new Event("input", { bubbles: true }));
    micButton.textContent = "🎙 Record your memory";
    micHelp.textContent = "Record up to 2 minutes. Whisper transcribes after you stop.";

    status.textContent = textCleared
      ? "Memory cleared. Ready for a new story."
      : "Audio cleared, but old story text could not be removed from browser storage.";
  } catch {
    status.textContent = "Could not clear the saved memory. Please try again.";
  } finally {
    clearMemory.disabled = false;
    save.disabled = false;
    micButton.disabled =
      !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder;
  }
};

// OWN VOICE NARRATION
// Records the user's actual voice, without ElevenLabs credits.
(() => {
  const section = document.createElement("section");
  section.className = "voice-panel";
  section.innerHTML = `
    <h2>🎙 Use Your Own Voice</h2>
    <p>Read your memory aloud and save your own narration.</p>
    <button type="button" id="own-record">Record my narration</button>
    <button type="button" id="own-play" disabled>Play my narration</button>
    <audio id="own-audio" controls hidden></audio>
    <a id="own-download" hidden>Download my narration</a>
    <p id="own-status" role="status">Ready to record.</p>
  `;

  document.querySelector("#save").before(section);

  const recordButton = section.querySelector("#own-record");
  const playButton = section.querySelector("#own-play");
  const player = section.querySelector("#own-audio");
  const downloadLink = section.querySelector("#own-download");
  const message = section.querySelector("#own-status");

  let recorder;
  let stream;
  let chunks = [];
  let audioURL = null;

  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    recordButton.disabled = true;
    message.textContent = "Microphone recording requires HTTPS and a supported browser.";
    return;
  }

  recordButton.onclick = async () => {
    if (recorder?.state === "recording") {
      recordButton.disabled = true;
      recorder.stop();
      return;
    }

    recordButton.disabled = true;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const type = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4"
      ].find(t => MediaRecorder.isTypeSupported(t));

      recorder = type
        ? new MediaRecorder(stream, { mimeType: type })
        : new MediaRecorder(stream);

      chunks = [];

      recorder.ondataavailable = event => {
        if (event.data.size) chunks.push(event.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());

        const blob = new Blob(chunks, {
          type: recorder.mimeType || "audio/webm"
        });

        if (audioURL) URL.revokeObjectURL(audioURL);
        audioURL = URL.createObjectURL(blob);

        player.src = audioURL;
        player.hidden = false;
        playButton.disabled = false;

        downloadLink.href = audioURL;
        downloadLink.download =
          blob.type.includes("mp4") ? "my-memory.m4a" : "my-memory.webm";
        downloadLink.hidden = false;

        try {
          await storedAudio("readwrite", {
            blob,
            text: document.querySelector("#story").value
          });
          message.textContent = "Your narration is saved in this browser!";
        } catch {
          message.textContent =
            "Recording ready. Download it to keep a copy.";
        }

        recordButton.textContent = "Record again";
        recordButton.disabled = false;
      };

      recorder.onerror = () => {
        stream.getTracks().forEach(track => track.stop());
        recordButton.disabled = false;
        recordButton.textContent = "Record again";
        message.textContent = "Recording failed. Please try again.";
      };

      recorder.start();
      recordButton.textContent = "■ Stop my narration";
      recordButton.disabled = false;
      message.textContent = "Recording your voice…";

    } catch (error) {
      recordButton.disabled = false;
      message.textContent =
        "Could not access microphone. Check browser permissions.";
    }
  };

  playButton.onclick = () => {
    player.currentTime = 0;
    player.play().catch(() => {
      message.textContent = "Playback failed.";
    });
  };
})();

// MULTIPLE PHOTO MEMORIES
(() => {
  const gallery = document.createElement("section");
  gallery.className = "voice-panel";
  gallery.innerHTML = `
    <h2>📸 My Photo Memories</h2>
    <p>Save a photo, its story and its narration together.</p>
    <input id="photo-title" placeholder="Memory title">
    <input id="photo-file" type="file" accept="image/*">
    <button id="save-photo-memory" type="button">
      Save this memory
    </button>
    <p id="gallery-status" role="status"></p>
    <div id="memory-gallery"></div>
  `;
  document.querySelector("#save").before(gallery);

  const title = gallery.querySelector("#photo-title");
  const file = gallery.querySelector("#photo-file");
  const message = gallery.querySelector("#gallery-status");
  const items = gallery.querySelector("#memory-gallery");

  function database() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("memory-frame-gallery", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("photos", { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function operate(mode, action) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("photos", mode);
      const store = tx.objectStore("photos");
      const req = action(store);
      tx.oncomplete = () => {
        db.close();
        resolve(req.result);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    });
  }

  async function refreshGallery() {
    const memories = await operate(
      "readonly", store => store.getAll()
    );
    items.replaceChildren();

    if (!memories.length) {
      items.textContent = "No photo memories saved yet.";
      return;
    }

    for (const memory of memories.reverse()) {
      const card = document.createElement("div");
      card.style.cssText =
        "border:1px solid #aaa;border-radius:12px;" +
        "padding:12px;margin:12px 0";

      const heading = document.createElement("h3");
      heading.textContent = memory.title;
      card.append(heading);

      if (memory.photo) {
        const img = document.createElement("img");
        const url = URL.createObjectURL(memory.photo);
        img.src = url;
        img.alt = memory.title;
        img.style.cssText =
          "width:100%;max-height:220px;object-fit:contain";
        img.onload = () => URL.revokeObjectURL(url);
        card.append(img);
      }

      const open = document.createElement("button");
      open.type = "button";
      open.textContent = "Open memory";
      open.onclick = async () => {
        try {
          story.value = memory.text;
          story.dispatchEvent(new Event("input", {
            bubbles: true
          }));

          if (audio) audio.pause();
          if (audioUrl) URL.revokeObjectURL(audioUrl);
          audio = null;
          audioUrl = null;
          play.disabled = true;
          download.style.display = "none";
          download.removeAttribute("href");

          if (memory.narration) {
            await storedAudio("readwrite", {
              blob: memory.narration,
              text: memory.text
            });
            audioUrl = URL.createObjectURL(memory.narration);
            audio = new Audio(audioUrl);
            play.disabled = false;
            download.href = audioUrl;
            download.download = memory.narration.type.includes("mpeg")
              ? "memory.mp3" : "memory.webm";
            download.style.display = "block";
          } else {
            await storedAudio("readwrite", null);
          }

          localStorage.setItem(
            "memory-frame-story", memory.text
          );
          status.textContent = "Memory opened!";
          message.textContent = "Opened: " + memory.title;
        } catch (err) {
          message.textContent = "Could not open memory.";
        }
      };

      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Delete";
      remove.className = "secondary";
      remove.onclick = async () => {
        if (!confirm("Delete " + memory.title + "?")) return;
        try {
          await operate(
            "readwrite",
            store => store.delete(memory.id)
          );
          await refreshGallery();
          message.textContent = "Memory deleted.";
        } catch {
          message.textContent = "Delete failed.";
        }
      };

      card.append(open, remove);
      items.append(card);
    }
  }

  gallery.querySelector("#save-photo-memory").onclick =
    async () => {
      const name = title.value.trim();
      const text = story.value.trim();

      if (!name || !text) {
        message.textContent =
          "Enter a title and a story first.";
        return;
      }

      try {
        // Save the currently selected narration if available.
        let narration = null;
        if (audioUrl && audio) {
          narration = await fetch(audioUrl).then(r => r.blob());
        } else {
          const saved = await storedAudio("readonly");
          if (saved?.text === text) {
            narration = saved.blob;
          }
        }

        await operate("readwrite", store => store.put({
          id: Date.now() + "-" +
              Math.random().toString(36).slice(2),
          title: name,
          text,
          photo: file.files[0] || null,
          narration,
          created: new Date().toISOString()
        }));

        title.value = "";
        file.value = "";
        message.textContent = "Photo memory saved!";
        await refreshGallery();
      } catch (err) {
        message.textContent =
          "Could not save memory. Check browser storage.";
      }
    };

  refreshGallery().catch(() => {
    message.textContent = "Gallery storage unavailable.";
  });
})();
