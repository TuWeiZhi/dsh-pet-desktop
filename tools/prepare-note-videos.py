"""Key the five user-supplied MP4s; preserve their complete animated frames.

Requires numpy, opencv-python-headless and FFmpeg with libvpx-vp9.
Run: python tools/prepare-note-videos.py --ffmpeg C:/ffmpeg/bin/ffmpeg.exe
Paper color is matched without replacing its texture or generating motion.
"""
import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
WIDTH, HEIGHT, FPS = 640, 480, 24
# Measured settled-paper bounds in each 960 x 720 source. A single fixed
# transform is applied to the WHOLE clip, never a frame-dependent paper warp.
CLIPS = {
    '拿出': ('桌宠“拿出便签”连续动画生成需求.mp4', (225, 362, 510, 258)),
    '待机': ('桌宠持签待机循环动画生成需求.mp4', (223, 371, 515, 272)),
    '上一页': ('桌宠“上一页”动作生成.mp4', (225, 362, 510, 258)),
    '下一页': ('桌宠“下一页”动作生成.mp4', (225, 363, 510, 258)),
    '收起': ('桌宠“收起便签”连续动画生成需求.mp4', (225, 363, 510, 258)),
}
SOURCE_PAPER = (150, 242, 340, 172)
# Match the ordinary 640x360 pet's 62..330 body height. The whole note frame
# uses one fixed transform; neither the character nor the paper zooms at runtime.
BODY_SCALE, BODY_X, BODY_Y = .9, 32, 30
PAPER = (167, 248, 306, 155)
PAPER_RGB = np.float32([235, 218, 208])


def match_paper(rgba, correction):
    rgb = rgba[:, :, :3].astype(np.float32)
    red, green, blue = np.moveaxis(rgb, 2, 0)
    # Select the warm, lightly saturated paper surface, leaving ink, blue hair,
    # white clothing and the green-screen matte alone. Connected regions must
    # reach the paper's resting height, excluding the face above it.
    weight = np.minimum.reduce([
        np.clip((red - blue - 8) / 6, 0, 1),
        np.clip((75 - (red - blue)) / 15, 0, 1),
        np.clip((red - green - 2) / 4, 0, 1),
        np.clip((blue - 110) / 30, 0, 1),
        np.clip(rgba[:, :, 3] / 255, 0, 1),
    ])
    count, labels, stats, _ = cv2.connectedComponentsWithStats((weight > .5).astype(np.uint8))
    selected = np.zeros(count, dtype=bool)
    for label in range(1, count):
        x, y, w, h, area = stats[label]
        selected[label] = area >= 800 and y + h >= PAPER[1] + 10
    mask = selected[labels].astype(np.float32)
    mask = cv2.GaussianBlur(mask, (5, 5), 0) * weight
    result = rgba.copy()
    result[:, :, :3] = np.clip(rgb + correction * mask[:, :, None], 0, 255).astype(np.uint8)
    return result


def key_frame(bgr, transform):
    rgb = bgr[:, :, ::-1].astype(np.float32)
    excess = rgb[:, :, 1] - np.maximum(rgb[:, :, 0], rgb[:, :, 2])
    # Fixed across clips/frames so a mottled green background cannot make the
    # matte breathe. Blue hair, neutral clothing and warm paper stay opaque.
    t = np.clip((excess - 15) / 70, 0, 1)
    alpha = 1 - t * t * (3 - 2 * t)
    rgb[:, :, 1] = np.minimum(rgb[:, :, 1], np.maximum(rgb[:, :, 0], rgb[:, :, 2]))
    premultiplied = np.dstack((rgb * alpha[:, :, None], alpha * 255))
    resized = cv2.warpAffine(premultiplied, transform, (WIDTH, HEIGHT), flags=cv2.INTER_AREA)
    a = resized[:, :, 3:4] / 255
    color = np.clip(resized[:, :, :3] / np.maximum(a, .001), 0, 255).astype(np.uint8)
    # Extend color beneath fully transparent pixels to avoid dark VP9 chroma
    # fringes. The alpha mask and visible artwork are unchanged by this step.
    bleed = cv2.dilate(color, np.ones((7, 7), np.uint8))
    color = np.where(a > .001, color, bleed)
    return np.dstack((color, np.clip(resized[:, :, 3], 0, 255).astype(np.uint8)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ffmpeg', default=shutil.which('ffmpeg') or 'C:/ffmpeg/bin/ffmpeg.exe')
    args = parser.parse_args()
    destination = ROOT / 'assets/note-video'
    destination.mkdir(parents=True, exist_ok=True)
    manifest = {'width': WIDTH, 'height': HEIGHT, 'fps': FPS, 'paper': PAPER,
                'paperRgb': PAPER_RGB.astype(int).tolist(), 'bodyScale': BODY_SCALE, 'clips': {}}
    for name, (filename, bounds) in CLIPS.items():
        source = ROOT / filename
        cap = cv2.VideoCapture(str(source))
        if not cap.isOpened():
            raise RuntimeError(f'Cannot open {source}')
        if (int(cap.get(3)), int(cap.get(4)), round(cap.get(5))) != (960, 720, FPS):
            raise ValueError(f'Unexpected video dimensions/rate: {source}')
        x, y, w, h = bounds
        sx, sy = SOURCE_PAPER[2] / w, SOURCE_PAPER[3] / h
        transform = np.float32([[sx * BODY_SCALE, 0, (SOURCE_PAPER[0] - x * sx) * BODY_SCALE + BODY_X],
                                [0, sy * BODY_SCALE, (SOURCE_PAPER[1] - y * sy) * BODY_SCALE + BODY_Y]])
        # One correction per clip avoids frame-to-frame exposure/color pumping.
        reference_frame = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) - 1 if name == '拿出' else 0
        cap.set(cv2.CAP_PROP_POS_FRAMES, reference_frame)
        ok, reference = cap.read()
        if not ok:
            raise RuntimeError(f'Cannot sample {source}')
        sample = key_frame(reference, transform)[280:370, 230:410, :3]
        correction = PAPER_RGB - np.median(sample, axis=(0, 1))
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        target = destination / (name + '.webm')
        command = [args.ffmpeg, '-hide_banner', '-loglevel', 'error', '-y',
                   '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', f'{WIDTH}x{HEIGHT}',
                   '-framerate', str(FPS), '-i', '-', '-an', '-c:v', 'libvpx-vp9',
                   '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '18', '-deadline', 'good',
                   '-cpu-used', '4', '-row-mt', '1', '-auto-alt-ref', '0', str(target)]
        count = 0
        with subprocess.Popen(command, stdin=subprocess.PIPE) as encoder:
            try:
                while True:
                    ok, frame = cap.read()
                    if not ok:
                        break
                    encoder.stdin.write(match_paper(key_frame(frame, transform), correction).tobytes())
                    count += 1
            finally:
                cap.release()
                encoder.stdin.close()
            if encoder.wait() != 0:
                raise RuntimeError(f'Encoding failed: {target}')
        manifest['clips'][name] = {
            'source': filename, 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
            'frames': count, 'duration': count / FPS, 'sourcePaper': bounds,
            'paperCorrectionRgb': correction.tolist(),
        }
        print(f'{name}: {count} frames, {target.stat().st_size} bytes', flush=True)
    (destination / 'sources.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
