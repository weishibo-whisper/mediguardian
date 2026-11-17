#!/usr/bin/env python3
import hashlib
import io
import json
from pathlib import Path

from PIL import Image, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
EVAL_DIR = ROOT / "data" / "eval"
OUT_DIR = EVAL_DIR / "vision-images" / "benchmark"
RESAMPLING = getattr(Image, "Resampling", Image)
TRANSFORM = getattr(Image, "Transform", Image)


def fit_rgb(image: Image.Image, max_side: int = 1200) -> Image.Image:
    image = image.convert("RGB")
    image.thumbnail((max_side, max_side), RESAMPLING.LANCZOS)
    return image


def compressed(image: Image.Image, quality: int = 42) -> Image.Image:
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=quality, optimize=True)
    buffer.seek(0)
    return Image.open(buffer).convert("RGB")


def center_crop(image: Image.Image, ratio: float = 0.08) -> Image.Image:
    width, height = image.size
    dx, dy = int(width * ratio), int(height * ratio)
    cropped = image.crop((dx, dy, width - dx, height - dy))
    return cropped.resize((width, height), RESAMPLING.LANCZOS)


def perspective(image: Image.Image) -> Image.Image:
    width, height = image.size
    quad = (
        width * 0.05, height * 0.03,
        width * 0.02, height * 0.94,
        width * 0.94, height * 0.98,
        width * 0.98, height * 0.08,
    )
    return image.transform(image.size, TRANSFORM.QUAD, quad, RESAMPLING.BICUBIC)


def variants(image: Image.Image):
    yield "original-resized", image
    yield "rotate-minus-5", image.rotate(-5, RESAMPLING.BICUBIC, expand=False, fillcolor="white")
    yield "rotate-plus-7", image.rotate(7, RESAMPLING.BICUBIC, expand=False, fillcolor="white")
    yield "dark-58pct", ImageEnhance.Brightness(image).enhance(0.58)
    yield "bright-low-contrast", ImageEnhance.Contrast(ImageEnhance.Brightness(image).enhance(1.18)).enhance(0.72)
    yield "gaussian-blur-1.3", image.filter(ImageFilter.GaussianBlur(1.3))
    yield "center-crop-8pct", center_crop(image)
    yield "mild-perspective", perspective(image)
    yield "jpeg-quality-42", compressed(image)


source_data = json.loads((EVAL_DIR / "vision-sources.json").read_text(encoding="utf-8"))
OUT_DIR.mkdir(parents=True, exist_ok=True)
samples = []

for source in source_data["sources"]:
    source_path = EVAL_DIR / source["file"]
    if not source_path.exists():
        raise FileNotFoundError(source_path)
    source_sha = hashlib.sha256(source_path.read_bytes()).hexdigest()
    base = fit_rgb(Image.open(source_path))
    for index, (transform, image) in enumerate(variants(base), start=1):
        sample_id = f"{source['id']}-{index:02d}"
        output_path = OUT_DIR / f"{sample_id}.jpg"
        image.save(output_path, "JPEG", quality=82, optimize=True)
        samples.append({
            "id": sample_id,
            "file": output_path.relative_to(EVAL_DIR).as_posix(),
            "expectedDrugIds": source["expectedDrugIds"],
            "sourceId": source["id"],
            "sourcePage": source["sourcePage"],
            "author": source["author"],
            "license": source["license"],
            "transform": transform,
            "sourceSha256": source_sha,
            "notes": "公开原图的确定性工程增强样本；不是独立临床照片。",
        })

manifest = {
    "datasetName": "MediGuardian Open-License Vision Robustness Benchmark v1",
    "generatedAt": "2026-11-16",
    "licenseVerified": True,
    "independentOriginals": len(source_data["sources"]),
    "augmentedSamples": len(samples),
    "clinicalValidation": False,
    "disclaimer": "由 4 张公开许可原图派生的 36 张鲁棒性样本，只验证工程链路与图像扰动稳定性，不代表 36 张独立真实样本或临床准确率；mock 结果不计入指标。",
    "samples": samples,
}
(EVAL_DIR / "vision-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"视觉基准已生成：{manifest['independentOriginals']} 张公开原图 -> {manifest['augmentedSamples']} 张增强样本")
