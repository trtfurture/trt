# PEA Studio — free open-source video starter

PEA includes a starter notebook for **Wan2.1 T2V-1.3B**, an open-source text-to-video model. The notebook uses the official Wan project source from GitHub and downloads its model weights from ModelScope. It does not call a paid generation API and does not use the public Hugging Face demo queue.

## What you get

- A prompt-to-video starter notebook: `static/ai/PEA-Wan21-Free-GPU.ipynb`.
- A short 480p test profile that saves an MP4.
- A direct import path back into PEA's Media Library and selected scene.
- Model and code links from the original project authors.

Wan's official repository states that the T2V-1.3B model requires about **8.19 GB of GPU VRAM** and recommends 480p for this smaller model. The ModelScope model card lists the model as **Apache 2.0** and about **17.57 GB** in size. Kaggle lists free GPU notebook access, and a 2026 Kaggle announcement says T4x2 remains an accelerator option after the P100 retirement. Free capacity is limited and varies; a GPU session is not guaranteed.

## Use the notebook

1. Open PEA Studio and choose **Create with AI**.
2. Download **PEA-Wan21-Free-GPU.ipynb** from the open-source starter card.
3. Open Kaggle Notebooks, create/import a notebook from that file, enable Internet, and select an available GPU accelerator (T4x2 if offered).
4. Run the cells in order. The model download is large, approximately 17.6 GB; make sure the notebook session has enough free disk space.
5. Edit the `PROMPT` variable in **Create your clip** and run that cell.
6. Download the generated MP4 from the notebook output.
7. Return to PEA → **Create with AI** → **Import finished clip**. PEA adds it to the selected scene and Media Library. Continue with scene timing, titles, transitions, music and final MP4 export.

The default notebook profile is 41 frames at 16 fps (about 2.5 seconds), 832 × 480, and 25 sampling steps. It is intentionally a small first test. After a successful run, you can adjust `--frame_num` to another value of the form `4n+1` and increase `--sample_steps` toward 50 for a longer or more refined result, subject to GPU memory and session time.

## What this route does not promise

- Kaggle does not guarantee that free GPU capacity will be available every time.
- The first session must download the large model weights; a fresh notebook session may need to download them again.
- T4 performance is not the same as a high-end workstation GPU; generation can take a while.
- This starter is text-to-video. It does not automatically keep a character perfectly identical across different generated shots. Reuse a detailed character description, review each shot, and assemble the results in PEA.
- This notebook is not an always-on API connection. Clips are downloaded from Kaggle and imported into PEA. It avoids exposing an unauthenticated ComfyUI port or pretending a notebook is a permanent inference server.

## Original projects

- Wan2.1 source code: https://github.com/Wan-Video/Wan2.1
- Wan2.1 T2V-1.3B model on ModelScope: https://www.modelscope.cn/models/Wan-AI/Wan2.1-T2V-1.3B
- Kaggle Notebooks: https://www.kaggle.com/code
- Kaggle notebook documentation: https://www.kaggle.com/docs/notebooks

Review the complete model licence and the applicable platform terms before commercial use. The licence does not grant rights to third-party media, logos, voices, music or characters that you upload or generate.
