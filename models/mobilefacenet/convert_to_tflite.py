"""Convert an audited MobileFaceNet SavedModel/Keras model to FP16 TFLite.

Usage:
  python models/mobilefacenet/convert_to_tflite.py \
    --saved-model /path/to/saved_model \
    --output models/mobilefacenet/mobilefacenet.tflite

The source model and license must be recorded in model_card.md before the
converted file is committed.
"""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--saved-model", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        import tensorflow as tf
    except ImportError as exc:
        raise SystemExit(
            "TensorFlow is required for conversion. Install it in a separate "
            "model-prep environment, not in the React Native app runtime."
        ) from exc

    converter = tf.lite.TFLiteConverter.from_saved_model(str(args.saved_model))
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    converter.target_spec.supported_types = [tf.float16]
    converter.experimental_new_converter = True

    tflite_model = converter.convert()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(tflite_model)

    digest = hashlib.sha256(tflite_model).hexdigest()
    size_mb = len(tflite_model) / (1024 * 1024)
    print(f"Wrote {args.output}")
    print(f"Size: {size_mb:.2f} MB")
    print(f"SHA-256: {digest}")
    if size_mb > 5:
        raise SystemExit("Converted model exceeds the 5 MB MobileFaceNet target")


if __name__ == "__main__":
    main()
