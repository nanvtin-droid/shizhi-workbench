#!/bin/zsh
set -eu
cd "$(dirname "$0")/.."
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements-asr.lock
printf '\n本地转写环境就绪，首次提取正文会下载 Whisper base 模型。\n'
