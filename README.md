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
  brighter and redder as it gets louder.
* **What the sound was.** `Footsteps`, `Door`, `SLAM`, `KNOCK`, `Breathing`, `WHISPER`, `HEARTBEAT`,
  `PHONE RINGING` and the rest, each with a direction arrow and how long ago it happened. Same model
  and same 237 sound names as the PC version, generated from the same source file.
* **Footprints** on the side when footsteps come from somewhere that is not straight ahead.
* **Live captions** of anything anyone says, transcribed on the phone itself.
* **A phrase board** with 63 ready lines. Tap one and it is spoken out loud in a natural voice.

## How the sound gets to the phone

Two ways. Start with the first, it costs nothing.

### 1. Let the phone listen (no hardware)

Put the phone near your TV or speakers and let its own microphone hear the game. Works immediately on
any phone. Good enough for captions and for knowing something happened, weaker in a noisy room, and
left/right is only as good as the phone's microphones.

### 2. A cable from the controller (better)

Plug into the **3.5 mm headphone jack on the DualSense** (or your controller / TV headphone out) and
run that into the phone through a small USB audio adapter. The phone then gets the game's own clean
stereo, with no room noise, and left/right becomes exact.

That same adapter carries your voice the other way, so when you tap a phrase the team hears it
through the controller's microphone line. You want an adapter with **both a microphone input and a
headphone output**, plus a TRRS splitter, roughly 25 dollars in total.

> A phone **cannot** connect to a PS5 as a Bluetooth headset. Sony reserves the PS5's Bluetooth for
> controllers and its own headsets, and no phone can present itself as a headset anyway. iPhones
> never can, and a web page cannot touch Bluetooth audio at all. The cable is the way.

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

## What it does not do

* **It cannot hear a game running on the same phone.** Neither iOS nor Android lets one app capture
  another app's sound. This is built to watch a TV or monitor, not the phone itself.
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
