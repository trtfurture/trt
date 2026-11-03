# PEA Studio

**A private, local-first creative advertising studio.** Built with Flask, vanilla JavaScript, Canvas, IndexedDB and FFmpeg. No registration, no public accounts, no third-party CDN and no paid frontend service.

## What is included

PEA is an art-directed advert composer, not just a generic clip trimmer. The **Build an advert** creative brief turns a brand/product brief into a three-scene social campaign and places uploaded visual assets automatically. The compositions include editorial campaigns, product spotlights, split-screen stories, offer features, graphic posters, cinematic showcases and minimal product studio layouts. Drag assets from the media library onto the live canvas or directly onto a scene card; drag scene cards to reorder the story. You can also drop local files onto the canvas or a target scene.

- Private sign-in using only `ADMIN_NAME` and `ADMIN_PASSWORD`.
- No registration route and no public editor access.
- Art-directed advert composer with a live designed canvas (not an empty clip timeline).
- 9:16, 4:5, 1:1 and 16:9 formats.
- Image, video and audio uploads from your device.
- Headline, supporting copy, call-to-action, text colour, font, placement, client-logo overlay and Pea signature controls.
- Creative brief / art direction wizard for product launches, fashion, offers, food, property, business, events and apps; automatically generates a three-scene advert and distributes uploaded photos or clips.
- Distinct art-directed layouts: editorial, product spotlight, split-screen, offer feature, graphic campaign poster, cinematic showcase and minimal product studio.
- Drag-and-drop media placement onto the canvas or individual scenes; drag-and-drop scene reordering.
- Built-in story starters, typography, colour accents, visual looks, image treatments, text motion, scene entrances and atmospheric effects (golden light leaks, floating dust, fine film grain and prism flares).
- Scene sequencing, duration control, reorder, add and delete.
- Local project autosave and a `.pea` backup/import file containing project data and media.
- Full-HD browser render, then server-side H.264/AAC MP4 conversion with FFmpeg.
- WebM download fallback when offline or when the MP4 conversion service cannot be reached.
- Installable PWA shell with cached frontend assets and an offline unlock flow.
- No external fonts, JavaScript CDNs or image services are required by the editor.

## Render deployment

This project includes a `Dockerfile` because the MP4 export service needs the FFmpeg system binary. The Docker image installs FFmpeg itself; do not deploy this project as a plain native Python service if you need MP4 conversion.

1. Upload the complete contents of this folder to a new GitHub repository, with `Dockerfile` and `render.yaml` at the repository root.
2. In Render, choose **New → Blueprint** and connect that repository. Render will read `render.yaml` and build the Docker image.
3. When prompted, supply these two environment variables:

   | Key | Value |
   |---|---|
   | `ADMIN_NAME` | Your chosen private admin name |
   | `ADMIN_PASSWORD` | Your chosen strong password |

4. Deploy. Open the generated `onrender.com` address and sign in.

**Only those two application credentials are required.** Render supplies its own `PORT` runtime variable. The Flask session signing key is derived from the two admin credentials, so a third secret variable is not needed. Changing `ADMIN_PASSWORD` invalidates existing server sessions; sign in again afterward.

If you already created a Render service instead of creating a new Blueprint, select the **Docker** runtime and make sure it builds from this repository's `Dockerfile`. Add or verify `ADMIN_NAME` and `ADMIN_PASSWORD` in the service Environment page. Render notes that Blueprint variables marked `sync: false` are prompted on initial Blueprint creation; subsequent changes to existing services must be entered in the Dashboard manually.

### Important Render free-plan behaviour

Render's free web services can spin down after inactivity and do not support persistent disks. PEA Studio therefore stores project files and uploaded media in the browser on your device, not on the Render filesystem. The first page load, sign-in and MP4 conversion need the Render service to be reachable. Once the studio has loaded and cached its shell, local editing can continue offline. A free instance may need to wake before the server-side MP4 conversion responds; upgrade the service plan later if you need an always-on export endpoint.

## Local computer installation

You need Python 3.10+ and FFmpeg installed on the computer. The Docker image already includes FFmpeg for Render. For local use, install FFmpeg from the official FFmpeg download page or your operating system's package manager and confirm `ffmpeg -version` works in a terminal.

### Windows PowerShell

```powershell
cd pea-studio
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:ADMIN_NAME = "Pea"
$env:ADMIN_PASSWORD = "change-this-to-your-own-strong-password"
python run_local.py
```

### macOS / Linux

```bash
cd pea-studio
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
export ADMIN_NAME="Pea"
export ADMIN_PASSWORD="change-this-to-your-own-strong-password"
python run_local.py
```

Open `http://127.0.0.1:5000`. Localhost works for service-worker/PWA development. Keep this terminal open while using the local server.

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
├── templates/
│   ├── login.html
│   ├── setup_error.html
│   └── studio.html
└── static/
    ├── css/app.css
    ├── js/app.js
    ├── js/engine.js
    ├── js/login.js
    ├── js/register-sw.js
    ├── js/store.js
    ├── sw.js
    ├── manifest.webmanifest
    └── icons/
```

The offline password check is an access gate, not full disk encryption: files inside the browser profile are not encrypted at rest by this application. Protect your computer account and browser profile, and do not use a shared/public computer for confidential client work.
