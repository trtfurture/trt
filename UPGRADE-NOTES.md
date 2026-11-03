# PEA Studio — AI production integration

This build keeps the existing PEA art-directed ad composer, friendly UI, local-first media library, effects, scene controls, projects, backups and MP4 export. It adds a local ComfyUI/LTX generation bridge.

## AI features
- Connect to ComfyUI and inspect GPU/queue information.
- Import and validate a ComfyUI API workflow JSON.
- Automatically discover positive-prompt and Load Image nodes.
- Upload a chosen PEA photo to ComfyUI and inject it into the workflow.
- Submit generation, poll status, reconnect after temporary engine outages, retry without duplicate submission, cancel only the matching active task, and retrieve completed image/video output.
- Import generated results into the PEA media library and current scene.
- Persist AI job metadata in SQLite for local restarts.
- The public LTX demo/Hugging Face queue is not used.

## Interface and workflow
- Upload a reference photo directly inside the AI production panel or choose one from the Media Library.
- The light-touch AI modal links to the official starter workflow and explains the required API export.
- PWA cache version bumped so installed clients can receive the new AI interface.

## New setup files
- `AI-ENGINE-SETUP.md` — hardware, ComfyUI/LTX setup, API workflow export and Render/local distinction.
- `Start-PEA-Local.ps1` / `Start-PEA-Local.bat` — Windows local launcher; prompts for the existing admin credentials and does not write them into a file.

## Important boundary
ComfyUI and LTX-2.5 model weights are installed separately on a compatible computer and are not bundled in the PEA ZIP. The bridge is implemented and can communicate with a ComfyUI engine; a real model render still depends on installing the workflow, custom nodes and model weights on supported hardware. Render itself does not supply the user's local GPU. See `AI-ENGINE-SETUP.md`.
