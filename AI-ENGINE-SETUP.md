# PEA Studio — advanced local AI engine

This guide covers PEA's advanced connection to **ComfyUI running on a computer you control**. The recommended model in this path is **LTX-2.5**. PEA sends your prompt and selected source photo to ComfyUI, waits for the real job result, then downloads the generated video or image into your PEA Media Library. This does not use a public demo queue.

**For the free-GPU starter route, use [FREE-OPEN-SOURCE-AI.md](FREE-OPEN-SOURCE-AI.md) instead.**

## What is included in PEA

- Secure, authenticated PEA-to-ComfyUI connection check.
- ComfyUI API workflow validation and prompt/image input discovery.
- Upload of the selected PEA source image to ComfyUI.
- Queue submission, status polling, reconnect handling, retry and cancellation.
- Job metadata stored in a local SQLite database, so a local PEA restart does not immediately erase the job record.
- Finished video/image output retrieval and import into the current PEA scene/media library.
- Clear error messages for unavailable engines, invalid API exports, missing nodes/models and workflows without saved outputs.

## Hardware and model requirements

LTX-2.5 is a large video model. The current LTX ComfyUI guide lists a CUDA-compatible GPU with **32 GB+ VRAM**, Python 3.12+ and **100 GB+ free disk space** as prerequisites. The docs also list lower-VRAM INT8 model variants; they can reduce memory pressure, but do not promise that a 4 GB / 8 GB laptop GPU or CPU-only computer will run it. Check your actual GPU before downloading the model files.

- ComfyUI: https://www.comfy.org/download
- Official LTX ComfyUI guide: https://docs.ltx.io/open-source-model/integration-tools/comfy-ui
- Official LTX-2.5 workflow examples: https://github.com/Lightricks/ComfyUI-LTXVideo/tree/master/example_workflows/2.5
- Recommended light/preview workflow: `LTX-2.5_T2V_I2V_Single_Stage_Distilled.json`

The PEA ZIP deliberately does **not** contain model weights. They are very large, are distributed separately by their authors, and must be downloaded into ComfyUI's model folders. Use ComfyUI's Templates panel: search **LTX-2.5**, open an Image-to-Video or Text-to-Video template, click **Download all**, wait for it to finish, then restart ComfyUI. The single-stage distilled workflow is a sensible first test; use the two-stage workflow later for higher spatial detail. The LTX-2.x license grants royalty-free use subject to its conditions, but entities with annual revenue of at least **US$10 million** need a paid commercial licence for production use. Read the complete current license before using generated scenes in client work.

## One-time setup on Windows

1. Install ComfyUI using its official Windows installer/desktop distribution. Start it and confirm that its local page opens at `http://127.0.0.1:8188`.
2. In ComfyUI, open **Templates**, search **LTX-2.5**, and choose an Image-to-Video or Text-to-Video template. Download all required models and restart ComfyUI. If the LTXVideo nodes are missing, follow the official guide to install the Lightricks `ComfyUI-LTXVideo` custom node and its requirements, then restart.
3. Run the LTX workflow once directly inside ComfyUI. This verifies that the model files and custom nodes are installed before PEA tries to use them.
4. In ComfyUI, choose **File → Export Workflow (API)**. Save the API-format JSON somewhere easy to find. The normal workflow JSON from **Save** is not the API export PEA needs.
5. Extract the PEA project. Run `Start-PEA-Local.ps1` from the PEA folder. The script creates a Python virtual environment, installs PEA's Python requirements, asks for your existing admin name and password, then starts PEA locally. FFmpeg is needed for MP4 export; the script reports if it is missing.
6. Open `http://127.0.0.1:5000`, sign in, choose **Create with AI**, press **Connect**, load the API JSON, select the positive prompt field and image input field, choose a photo from your library (or upload one inside the AI panel), describe the movement, and generate.
7. When PEA reports that the scene is ready, choose **Add to advert**. The generated clip is copied into your PEA media library and placed in the selected scene. Finish the campaign in PEA and export your MP4.

## Running on macOS or Linux

Use Python 3.10+ and install FFmpeg with your operating-system package manager. From the project folder:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
export ADMIN_NAME='your-admin-name'
export ADMIN_PASSWORD='your-strong-password'
python run_local.py
```

Keep ComfyUI running at `http://127.0.0.1:8188` while PEA creates scenes.

## Important: PEA on Render versus your own computer

A Render service and your personal computer are two different machines. When PEA is hosted on Render, `127.0.0.1:8188` means the Render container itself, **not your computer**. A Render-hosted PEA can only reach ComfyUI if you deliberately provide a reachable HTTPS engine endpoint. Do not expose an unauthenticated ComfyUI port to the public internet. For a private, no-cloud-cost setup, the simplest and safest starting configuration is to run both PEA and ComfyUI locally on the same computer.

The Render Docker deployment remains useful for accessing the editor remotely, but the AI GPU does not run inside Render and the free web service does not provide a GPU. The included application continues to use only the two PEA credential variables: `ADMIN_NAME` and `ADMIN_PASSWORD`.

## Why the earlier public queue error is different

The earlier message said a public model demo closed its queue before returning a result. PEA no longer submits generation requests to that public demo. It sends work to the ComfyUI address you explicitly connect. If your local GPU engine is stopped, missing model weights, or has an incompatible workflow, PEA reports that local engine error instead of pretending the job succeeded. When the engine is temporarily unreachable, PEA keeps the job record and retries status checks without automatically submitting duplicate generations.

## What “free” means here

ComfyUI and the LTX workflow software are open-source. Local generation does not charge a per-video cloud inference fee, but it still uses your computer's GPU, electricity, disk space and network download allowance for the model files. Review the current LTX model license before commercial use; the LTX-2.x Community License has conditions, including a revenue threshold for commercial entities. License: https://github.com/Lightricks/LTX-2/blob/main/LICENSE-2_x

## Troubleshooting

- **PEA cannot reach the AI engine:** Start ComfyUI first. Confirm the local page opens. Use `http://127.0.0.1:8188` if PEA is running on the same computer.
- **PEA says this is not an API workflow:** Reopen the workflow in ComfyUI and use **File → Export Workflow (API)**. Do not upload the ordinary canvas-save JSON.
- **No prompt field found:** Start with an official LTX-2.5 Text-to-Video or Image-to-Video workflow and export its API JSON.
- **No image field found:** Use an Image-to-Video workflow that contains a Load Image node. Text-to-video workflows can run without a reference photo.
- **Missing node/model errors:** Load the workflow in ComfyUI directly, install missing nodes from its manager, download missing models, restart ComfyUI, and run it once in ComfyUI before returning to PEA.
- **Workflow completes without output:** Ensure the workflow includes a video or image save/output node. PEA can only import files that ComfyUI reports in its completed history.
- **GPU out-of-memory:** Try the single-stage distilled workflow, use the documented INT8 ConvRot model set, reduce resolution/frame count, close other GPU applications, and restart ComfyUI. Do not assume every GPU can run LTX-2.5.
- **MP4 export fails locally:** Install FFmpeg and confirm `ffmpeg -version` works in a new terminal. Render's Docker image already installs FFmpeg for the hosted editor.

PEA stores generation records in `instance/pea-ai-jobs.sqlite3` on the PEA server and stores the source image and campaign media in your browser's IndexedDB. Keep `.pea` project backups for the actual project/media; ComfyUI retains its output files in its own output folder.
