# PEA Studio — AI Studio integration update

## What changed

- Added a new default **AI Studio** workspace with a simplified scene-generation screen and a separate Ad Composer tab. The original art-directed editor, media library, offline shell and MP4 export remain available.
- Connected text-to-video and image-to-video to the public Lightricks LTX Video Gradio Space through a small authenticated Flask job bridge. Character reference images are temporarily uploaded to the model Space only for the generation request.
- Added an original character library with name, visual description and optional reference image. Character records are stored in the browser's IndexedDB and included in version 2 `.pea` backups.
- Connected dialogue/narration generation to a public Kokoro TTS clone using its CPU mode; generated audio is added to the existing media library and selected as the project soundtrack.
- Added generation queue status, error reporting, preview and import of generated media into PEA's local media library.
- Bumped the service-worker shell cache to v4 so the updated interface is fetched after deployment.

## Important limitations

- The video and voice engines are public community-hosted demos, not infrastructure owned or guaranteed by PEA. They may queue, pause, change their endpoint, become unavailable or enforce quotas.
- LTX reference images guide the initial frame; they do not guarantee the exact same character identity or clothing across separate generations.
- Each generated video clip is 2–8 seconds in this UI. Long films must be created as many shots and edited together.
- Kokoro uses preset synthetic voices, not voice cloning. Each voice request is limited to 450 characters in this version. Lip-sync is not included.
- The first generation needs an active internet connection and an authenticated PEA session. Existing editing and local project storage do not depend on the AI providers.
- Generated media is stored in the browser's IndexedDB after download. Back up the project to preserve it. Render's free filesystem is not persistent.

## Deployment

No extra Python package or environment variable is required. Keep the existing Dockerfile, `render.yaml`, `ADMIN_NAME` and `ADMIN_PASSWORD` configuration. Deploy the complete folder so `ai_bridge.py` is included alongside `app.py`.

## First experience

1. Open PEA and sign in while online.
2. In **Characters**, save a character name and visual description; add a face/reference image for image-to-video guidance.
3. In **Create a video scene**, select that character, describe an action, choose clip length and press **Generate video scene**.
4. Preview the returned clip and choose **Add to current scene** to place it into the existing Ad Composer timeline.
5. In **Dialogue & narration**, write a short line, choose a preset voice and generate it. The resulting audio is stored in Media Library and selected as the current project soundtrack.
6. Use **Ad composer** to sequence scenes, adjust text and audio level, and export the assembled advert.
