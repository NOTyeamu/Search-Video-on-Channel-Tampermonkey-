# YouTube — Go to Video on Channel

A Tampermonkey userscript that adds an **"On Channel"** button to every YouTube video page. Click it and the script automatically opens the channel's video list, finds the exact video, scrolls to it, and highlights it with a glowing animation — all without any manual searching.

---

## ✨ Features

- **"On Channel" button** injected natively into YouTube's UI, visually matching YouTube's own buttons
- **Parallel search + scroll** — the API scan and DOM card loading run simultaneously for maximum speed
- **Blur overlay** locks the entire page during search; only the found video card is clickable
- **Glowing highlight animation** (blue → red pulse) on the found video card
- **Fast API scanning** with pipelined parallel requests (up to 4 concurrent) — no waiting between pages
- **Instant scroll** to bottom while loading cards (`behavior: instant`)
- **Auto-fade** — highlight and overlay smoothly disappear after a moment
- **Error feedback** — spinner text only appears on failure (`❌ Video not found`)
- Works on channels with hundreds or thousands of videos

---

## 📋 Requirements

- A browser extension that runs userscripts:
  - **[Tampermonkey](https://www.tampermonkey.net/)** (Chrome, Firefox, Edge, Safari) — recommended
  - **[Violentmonkey](https://violentmonkey.github.io/)** (Chrome, Firefox, Edge)

---

## 📥 Installation

### Option 1 — Copy the raw script

1. Open the file [`YouTube_GoToChannel_v12.user.js`](./YouTube_GoToChannel_v12.user.js)
2. Click **Raw** (top-right of the file view)
3. Tampermonkey will detect it automatically and show an install prompt
4. Click **Install**

### Option 2 — Manual copy-paste

1. Open Tampermonkey → **Dashboard** → **+** (Create new script)
2. Delete the default template content
3. Copy the full contents of [`YouTube_GoToChannel_v12.user.js`](./YouTube_GoToChannel_v12.user.js) and paste it in
4. Press **Ctrl + S** to save

---

## 🚀 How to use

1. Open any YouTube video (e.g. `youtube.com/watch?v=...`)
2. Find the **"On Channel"** button in the row of buttons under the video title

   > The button appears to the right of the Share button

3. Click **"On Channel"**
4. A new tab opens with the channel's `/videos` page
5. A blur overlay appears and a red spinner starts — the script searches and scrolls automatically
6. The video card is highlighted with a glowing blue/red animation
7. The overlay fades away — the card is now fully clickable

---

## 📄 License

MIT — do whatever you want with it.
