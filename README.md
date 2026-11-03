# PEA Studio

**A private AI-assisted creative advertising studio.** Bring real product photos, video clips, logos and music; generate original motion scenes with your own local LTX-2.5 / ComfyUI engine; finish the advert with PEA's art-directed layouts, effects, typography and MP4 export.

> **AI creation has two clear paths.** Start with the open-source **Wan2.1 T2V-1.3B** notebook, which uses a free Kaggle GPU session when available and downloads model weights from ModelScope—not a paid inference API or a Hugging Face demo queue. Download the notebook from PEA's Create with AI panel, run it in Kaggle, then import the finished MP4 into PEA. For a private local setup, PEA also retains its advanced ComfyUI connection. See [FREE-OPEN-SOURCE-AI.md](FREE-OPEN-SOURCE-AI.md) and [AI-ENGINE-SETUP.md](AI-ENGINE-SETUP.md).

## What PEA does

- Private sign-in using only `ADMIN_NAME` and `ADMIN_PASSWORD`; no registration.
- Upload your own product photos, logos, videos and audio into a local-first Media Library.
- Generate short text-to-video shots with the included open-source Wan2.1 notebook using an available free Kaggle GPU session; import the resulting MP4 directly into the selected scene.
- Connect to a ComfyUI engine and use official LTX-2.5 text-to-video / image-to-video workflows as the advanced local-engine option.
- Upload selected PEA source photos to ComfyUI, replace the positive prompt, submit generation jobs, reconnect/poll status, retry, cancel, and import completed outputs back into the selected advert scene.
- Persist generation job records locally in SQLite so a local PEA restart does not immediately lose job tracking.
- Compose complete campaigns with editorial, product spotlight, split-screen, offer, graphic poster, cinematic showcase and minimal product studio layouts.
- Refine text, logo, type, atmosphere effects, motion, transitions, scene timing, soundtrack and social aspect ratios.
- Save projects and uploaded assets in browser IndexedDB; export/import `.pea` backups.
- Render social video in the browser and convert to H.264/AAC MP4 using FFmpeg.
- Installable PWA shell with cached editor assets and offline editing support.

## Start creating with an open model

For the most accessible first attempt, open **Create with AI** and choose **Wan 2.1 · Free GPU starter**. Download `static/ai/PEA-Wan21-Free-GPU.ipynb`, import it into Kaggle, enable Internet and select a GPU accelerator. The notebook downloads official Wan source from GitHub and model weights from ModelScope, generates a short 480p MP4, and shows the output file for download. Import that MP4 back into PEA to continue editing. Read **[FREE-OPEN-SOURCE-AI.md](FREE-OPEN-SOURCE-AI.md)** before starting; free GPU sessions and disk capacity are limited and not guaranteed.

PEA also retains its advanced local ComfyUI bridge. Read **[AI-ENGINE-SETUP.md](AI-ENGINE-SETUP.md)** before installing LTX-2.5. The default local engine address is `http://127.0.0.1:8188`.

**Important deployment distinction:** on Render, `127.0.0.1` means the Render container, not your laptop. Render does not provide the user's local GPU. Local ComfyUI generation requires PEA and ComfyUI on the same computer, or a deliberately configured reachable HTTPS ComfyUI endpoint. Do not expose an unauthenticated ComfyUI port publicly.

For Windows, use the included **`Start-PEA-Local.bat`** after the one-time Python/FFmpeg and ComfyUI setup. It asks for the same admin credentials you store in Render and does not save them into a project file.

## Render deployment

This project includes a Dockerfile because the MP4 export service needs FFmpeg.

1. Upload the complete contents of this folder to a new GitHub repository, with `Dockerfile` and `render.yaml` at the repository root.
2. In Render choose **New → Blueprint** and connect the repository, or use Docker runtime for an existing service.
3. Set exactly these two application credentials:

   | Key | Value |
   |---|---|
   | `ADMIN_NAME` | Your private admin name |
   | `ADMIN_PASSWORD` | Your strong private password |

4. Deploy and sign in.

No additional application secret variables are required. The Flask session signing key is derived from the two credentials; Render supplies `PORT` itself.

Render's free service can spin down and its filesystem is ephemeral. Project and source media remain in the browser's IndexedDB; AI job tracking uses local SQLite and is not guaranteed to survive a Render instance replacement. For reliable local AI production, use the local launcher documented in [AI-ENGINE-SETUP.md](AI-ENGINE-SETUP.md).

## Offline use

1. Open the deployed or local studio while connected.
2. Sign in successfully on the device you intend to use offline.
3. Keep the site installed or open it at least once so the service worker can cache the approved studio shell and editor assets.
4. Your project data and uploaded media are stored in this browser's IndexedDB. The local offline unlock is protected by a PBKDF2 password verifier stored on this device; the password itself is not stored.
5. When disconnected, open the cached studio and unlock with the same admin name and password.

Offline editing, preview, autosave and browser video rendering are available after the app shell is cached. A disconnected browser cannot contact the Render FFmpeg endpoint, so offline export is downloaded as WebM. Reconnect to the studio to convert a WebM render to MP4. On a computer running the local PEA server with FFmpeg installed, MP4 conversion is available without internet access.

## First advert: recommended workflow

1. Use the quick-start row above the canvas: **Add your media → Build an advert → Export MP4**. You can also use the gold **Build an advert** button in the top bar.
2. Add the client’s product photos, logo artwork, phone clips and licensed music. Tapping an asset places it in the selected scene; on a computer, drag it onto the canvas or a specific scene card.
3. In the creative brief, enter the brand name, product/service, a short reason to choose it, any special offer and a call to action. The brief also has an **Add photos / video** button.
4. Choose the publishing format and one art direction: Quiet luxury, Product spotlight, High-impact, Modern editorial, Warm & inviting, or Digital precision.
5. Choose **Compose my advert**. PEA creates an opening scene, a detail/benefit scene and a closing call-to-action scene. It reuses a single uploaded image in varied compositions or distributes multiple photos/clips across the story.
6. To replace a scene's image, drag an item from Media Library onto the preview canvas or directly onto the scene card. To add files from your computer, drag them onto the preview or scene card. Tap/click an asset to place it in the selected scene.
7. Select each scene to refine its headline, supporting message, offer, layout, colours, typography, motion, atmosphere effect, logo and duration. Drag scene cards to change their order.
8. Play the preview, then choose **Export advert** and render the MP4. Start with a 10–20 second advert and check legibility on a phone-sized screen before sending it to a client.

The canvas displays a designed background and typography even before a photo is added; it should not remain a blank black preview. When a photo is placed, it appears in the selected scene's art-directed layout. If a large image or video is still decoding, the preview may briefly show the designed backdrop while the media loads.

## Projects, media and backups

- Projects and original media are stored in the browser profile that created them. They are not automatically shared between devices or browsers.
- Use **Backup** regularly. It creates a `.pea` file containing the current project and media library. Keep that backup somewhere safe.
- Use **Import** to restore a `.pea` backup in another browser or computer.
- Clearing browser data, using private browsing, uninstalling a browser or losing the device may erase locally saved projects. A backup is your recovery copy.
- Browser storage limits vary by device and available disk space. The studio displays an estimate when the browser provides one.

## Export details

The editor renders at the selected format's Full-HD canvas dimensions, captures a browser WebM recording, and asks the authenticated Flask server to convert it to MP4 using FFmpeg (`libx264`, H.264, AAC audio when present, `yuv420p`, fast-start metadata). The browser and computer determine the actual rendering speed. Heavy source videos, very long timelines or limited memory can slow or interrupt recording; start with short 10–30 second adverts and test longer work on the target computer.

The Media Library includes quick links to Pexels, Pixabay and Mixkit so you can source downloadable creative, then upload it. PEA's own compositions and built-in graphical treatments are bundled with the project and work without paid design subscriptions; they do not grant rights to third-party media. PEA Studio does not bundle or grant rights to stock photos, video clips, fonts or commercial music. Use client-supplied media or assets licensed for the intended commercial use. A music licence for one social platform may not cover another platform.

## Security notes

- Do not commit `.env` files or credentials. `.gitignore` excludes common local secrets.
- Use a unique, strong `ADMIN_PASSWORD` and protect the device used for offline editing.
- The offline credential verifier allows offline access on this device; anyone who can unlock the device and knows the admin credentials can use the cached workspace.
- The studio is private, but this is a first production build. Keep backups and test it with non-critical work before relying on it for client deadlines.

## Files

```text
pea-studio/
├── app.py
├── requirements.txt
├── Procfile
├── Dockerfile
├── render.yaml
├── run_local.py
├── README.md
├── FREE-OPEN-SOURCE-AI.md
├── templates/
│   ├── login.html
│   ├── setup_error.html
│   └── studio.html
└── static/
    ├── css/app.css
    ├── js/app.js
    ├── ai/PEA-Wan21-Free-GPU.ipynb
    ├── js/engine.js
    ├── js/login.js
    ├── js/register-sw.js
    ├── js/store.js
    ├── sw.js
    ├── manifest.webmanifest
    └── icons/
```

The offline password check is an access gate, not full disk encryption: files inside the browser profile are not encrypted at rest by this application. Protect your computer account and browser profile, and do not use a shared/public computer for confidential client work.
