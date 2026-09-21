# PhasmoSound Mobile

**The deaf gaming overlay, on a phone.** Put the phone next to your screen and it shows you the
sounds you cannot hear, captions what people say, and speaks for you.

This is the phone version of
[Phasmophobia Tools for the Deaf and Hard of Hearing](https://github.com/devarim28supply-afk/Phasmophobia-Tools-for-the-Deaf-and-Hard-of-Hearing).
The PC version overlays the game on the same screen. This one runs on a second screen you already
own, which means it works with a **PS5, Xbox, Switch or any TV**, not just a gaming PC.

It is a web page. Nothing to install, no app store, no account. Open it, tap once, and add it to your
home screen if you want it to feel like an app.

**Version 0.1.** Everything below works; it has not yet been through a long night of real play.

---

## What it shows you

* **Which side a sound came from.** The left and right edges of the screen light up with the sound,
  brighter and redder as it gets louder. This needs a **stereo cable** — see below; a phone's own
  microphone cannot do it.
* **What the sound was.** `Footsteps`, `Door`, `SLAM`, `KNOCK`, `Breathing`, `WHISPER`, `HEARTBEAT`,
  `PHONE RINGING` and the rest, each with a direction arrow and how long ago it happened. Same model
  and same 237 sound names as the PC version, generated from the same source file.
* **Footprints** on the side when footsteps come from somewhere that is not straight ahead.
* **Live captions** of anything anyone says, transcribed on the phone itself.
* **A phrase board** with 63 ready lines. Tap one and it is spoken out loud in a natural voice.

## How the sound gets to the phone

Two ways. Only one of them can tell left from right, so read this before buying anything.

### 1. Let the phone listen (no hardware)

Put the phone near your TV or speakers and let its own microphone hear the game. Works immediately on
any phone. Good enough for captions and for knowing something happened, weaker in a noisy room, and
left/right is only as good as the phone's microphones.

### 2. A cable (the only way to get left and right)

**The trap first, because it costs people money.** A cheap USB-C "headphone and microphone"
adapter will not work. Its microphone input is **mono by design** — one channel, because it was
built for a headset boom mic. Plug the game into it and both sides of the screen light off the
same signal. You need something with a **stereo LINE input**.

What works, all class-compliant so there are no drivers:

| | |
|---|---|
| **Behringer UCA202** or **UCA222**, about $30 | USB, stereo RCA in and a headphone out, so one box carries both directions |
| **USB-C OTG adapter**, about $8 | only if your phone has no USB-A; many phones need this |
| **3.5 mm TRRS splitter**, about $7 | splits the controller jack into audio out and mic in |
| **3.5 mm to twin RCA cable**, about $7 | game sound into the UCA202 |

### Wiring it to a PS5

The DualSense headphone jack is a TRRS headset jack: stereo out **and** a mic line in. That single
jack does both jobs.

```
DualSense 3.5 mm jack
        │
   TRRS splitter
        ├── green (stereo game sound) ──► 3.5 mm-to-RCA ──► UCA202  INPUT
        └── pink  (mic in) ◄───────────── 3.5 mm cable ◄─── UCA202  PHONES OUT
                                                              │
                                                          USB ─┴─► OTG ──► phone
```

Game sound reaches the phone in true stereo, and the lines you tap on the phrase board go back out
through the controller's microphone line so your team hears them.

**Turn the phone's volume down before the first test.** The UCA202's headphone output is much
hotter than a microphone input expects, and a loud signal there is what makes people say you sound
distorted. Start low and bring it up.

### Wiring it to a TV instead

If you would rather leave the controller alone, take the **TV's headphone jack** (or an HDMI audio
extractor, about $20, sitting between the console and the TV) into the UCA202 the same way. An
extractor is better if other people are in the room, because a TV headphone jack usually mutes the
TV speakers. You lose the way back for your voice, so the phrase board would need the controller
jack or a USB microphone on the console.

### Check it in the app, do not guess

Settings has **Check this input**. It opens every input your phone has and tells you which one
gives real stereo, because the device names never say. The bar at the top of the main screen also
reads **stereo**, **mono**, or **both sides the same** while you play.

**Android is the reliable one.** Chrome on Android passes a USB audio interface through with both
channels intact. iOS is far more restrictive about multichannel capture in Safari, so on an iPhone
expect mono — captions and sound names still work, left and right may not.

### 3. Let the phone listen (no hardware, no direction)

Put the phone near the TV and let its own microphone hear the game. Works instantly on any phone
and is fine for captions and for knowing something happened. It will say **mono**: phones mix
their microphones down to one channel before a web page ever sees them, so there is no left and
right on this path. That is a limit of the phone, not of this app.

## Using it

| | |
|---|---|
| **Start listening** | Tap once. Browsers will not open an audio input without a tap. |
| **Speak** | The button at the bottom. Pick a category, tap a line, it is spoken. |
| **Type something else** | Inside the Speak screen, for anything not on the board. |
| **Settings** | The cog, top right: input device, sensitivity, captions on or off. |

Captions are **off by default** because the speech model is about 40 MB on first use. Turn them on in
settings once, on wifi, and it is cached from then on.

## Add it to your home screen

* **iPhone / iPad:** open it in Safari, tap Share, then *Add to Home Screen*.
* **Android:** open it in Chrome, tap the menu, then *Install app*.

It then runs full screen with no browser bars, and works without a signal.

## Other games

Only two things in here are about Phasmophobia. **Captions, the left/right display, the direction
arrows and the footprints work with any game, any console, or a film** — they never knew what game
they were watching.

* **Sound names.** Settings has a *Which game* choice. Phasmophobia mode only allows the 91 sounds
  that exist in that game, which keeps wrong guesses down. Switch it to **Any game** and it names
  everything the model recognises: gunshots, engines, alarms, glass, water, dogs, doors and so on.
* **The phrase board.** The 63 lines are about ghost hunting. Edit `app/phrases/phrases.json` and
  drop in your own clips, or use *Type something else*, which works for anything.

## What it does not do

* **It cannot hear a game running on the same phone.** Neither iOS nor Android lets one app capture
  another app's sound. This is built to watch a TV or monitor, not the phone itself.
* **Left and right without a cable.** A phone hands a web page one mixed channel from its own
  microphones, so on that path there is no direction at all and the app says so.
* **Front and back.** Two channels give left and right only. A sound straight ahead or straight
  behind lands in the middle.
* **Captions come at pauses**, not word by word, usually within a second of someone finishing.
* **Choosing the output device** for your voice only works on Android. iOS always uses the system
  output, so on an iPhone the cable has to be the system output.

## Privacy

Everything happens on the phone. The sound model and the speech model are downloaded once and then
run locally. No audio is ever uploaded, and there is no account, no analytics and no server.

## Built with

| | |
|---|---|
| [YAMNet](https://www.kaggle.com/models/google/yamnet) via [ONNX Runtime Web](https://onnxruntime.ai/) | naming sounds (Apache-2.0 / MIT) |
| [Whisper](https://github.com/openai/whisper) via [transformers.js](https://github.com/huggingface/transformers.js) | captions (MIT / Apache-2.0) |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) | the voice, pre-recorded into the 63 clips (Apache-2.0) |

## Development

```
app/                the whole web app; there is no build step
  index.html
  js/audio.js       capture, loudness, direction, sudden sounds, 16 kHz ring buffer
  js/classify.js    YAMNet + the shared label rules
  js/captions.js    Whisper, with the same utterance segmentation as the desktop version
  js/phrases.js     the phrase board and the voice
  js/main.js        wiring and drawing
  models/           yamnet.onnx, the class map, labels.json
  phrases/          phrases.json and 63 mp3 clips
tools/
  extract-labels.js regenerates models/labels.json from the desktop Classifier.cs
```

Serve `app/` over HTTPS (or `localhost`) — microphone access requires it.

```
npx serve app
```

To change the phrases, edit `app/phrases/phrases.json` and regenerate the clips with the desktop
project's Kokoro server, then re-run `node tools/extract-labels.js` if the sound labels changed.

## License

[MIT](LICENSE). Built by **Kaalob Moran**, who is deaf, as a contribution to deaf and hard of hearing
players. Not affiliated with Kinetic Games or Sony. No game asset is included.
