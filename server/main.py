"""
WebSocket server that runs MediaPipe face/pose detection and returns landmark JSON.
The client (browser) receives landmarks and applies KalidoKit rigging locally.

Usage:
    pip install -r requirements.txt
    python main.py

Client connects with:
    ?server=ws://<host>:8000/ws
"""

import asyncio
import io
import json
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision as mp_vision

MODEL_DIR = Path(__file__).parent / "models"
FACE_MODEL = MODEL_DIR / "face_landmarker.task"
POSE_MODEL = MODEL_DIR / "pose_landmarker_lite.task"
FACE_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
POSE_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"


def download_if_missing(url: str, path: Path) -> None:
    if path.exists():
        return
    print(f"Downloading {path.name} ...")
    urllib.request.urlretrieve(url, path)
    print(f"Downloaded {path.name}")


def init_landmarkers():
    MODEL_DIR.mkdir(exist_ok=True)
    download_if_missing(FACE_URL, FACE_MODEL)
    download_if_missing(POSE_URL, POSE_MODEL)

    face_opts = mp_vision.FaceLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(FACE_MODEL)),
        running_mode=mp_vision.RunningMode.IMAGE,
        num_faces=1,
        output_face_blendshapes=True,
        output_facial_transformation_matrixes=True,
    )
    pose_opts = mp_vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(POSE_MODEL)),
        running_mode=mp_vision.RunningMode.IMAGE,
        num_poses=1,
    )
    return (
        mp_vision.FaceLandmarker.create_from_options(face_opts),
        mp_vision.PoseLandmarker.create_from_options(pose_opts),
    )


face_landmarker, pose_landmarker = init_landmarkers()

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def process_frame(jpeg_bytes: bytes) -> str:
    image = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.array(image))

    face_result = face_landmarker.detect(mp_image)
    pose_result = pose_landmarker.detect(mp_image)

    face_data = None
    if face_result.face_landmarks:
        lms = face_result.face_landmarks[0]
        face_data = {
            # faceLandmarks: used by KalidoKit Face.solve and skeleton drawing
            "faceLandmarks": [[{"x": lm.x, "y": lm.y, "z": lm.z} for lm in lms]],
            # presence check only in rigger.ts — content unused
            "facialTransformationMatrixes": [{}],
        }

    pose_data = None
    if pose_result.pose_world_landmarks:
        wlms = pose_result.pose_world_landmarks[0]
        # normalized landmarks (image coords) for skeleton.ts visualization
        lms = pose_result.pose_landmarks[0] if pose_result.pose_landmarks else wlms
        pose_data = {
            "worldLandmarks": [
                [{"x": lm.x, "y": lm.y, "z": lm.z, "visibility": lm.visibility} for lm in wlms]
            ],
            "landmarks": [
                [{"x": lm.x, "y": lm.y, "z": lm.z, "visibility": lm.visibility} for lm in lms]
            ],
        }

    return json.dumps({"face": face_data, "pose": pose_data})


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await websocket.accept()
    loop = asyncio.get_running_loop()
    try:
        while True:
            data = await websocket.receive_bytes()
            result_json = await loop.run_in_executor(None, process_frame, data)
            await websocket.send_text(result_json)
    except WebSocketDisconnect:
        pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
