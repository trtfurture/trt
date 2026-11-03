# PEA Studio — creative workflow update

This update shifts PEA Studio from a general-purpose clip editor toward an art-directed advertisement composer.

## What changed

- Fixed the initial preview so the canvas shows a composed still rather than becoming invisible at the first frame of a fade/text entrance.
- Added the three-step quick-start row: Add your media → Build an advert → Export MP4.
- Added Add photos / video directly inside the creative brief.
- Added four selectable animated atmosphere treatments: golden light leak, floating dust, fine film grain and prism flare.
- Added actual zoom and slide scene entrances; the earlier transition selector did not apply those scene transforms.
- Added designed text-led campaign canvases that remain visible without uploaded product photos.
- Added file drag-and-drop onto the canvas and individual scene cards, and scene-card drag reordering. Tapping a library asset also places it into the selected scene for touch devices.
- Added clearer media-loading and media-failure feedback.
- Prevented audio-only uploads from reassigning an earlier image into a scene.
- Bumped the offline shell cache to v3 so previously cached v2 assets are replaced after the next online visit.

## First-use flow

1. Sign in with the Render `ADMIN_NAME` and `ADMIN_PASSWORD`.
2. Add the client’s images, video clips, logo and licensed audio.
3. Open **Build an advert**, complete the short brief and choose an art direction.
4. Compose, then refine each of the three scenes. Drag assets onto a scene or tap an asset to place it.
5. Preview the sequence and export the advert as MP4 while connected to the Render export service.

All existing deployment files and the two-variable Render configuration are retained.
