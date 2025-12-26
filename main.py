from fastapi import FastAPI, HTTPException, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import io
import os
from translate import Translator
from docx import Document
from PyPDF2 import PdfReader
from PIL import Image
import pytesseract
from tempfile import NamedTemporaryFile
try:
    from transformers import pipeline, AutoTokenizer
except Exception as _e:
    pipeline = None
    AutoTokenizer = None
    print(f"Warning: transformers not installed: {_e}")

try:
    import torch
except Exception as _e:
    torch = None
    print(f"Warning: torch not installed: {_e}")


app = FastAPI(title="Multilingual Summarizer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure Tesseract path if installed in default Windows location; adjust if needed
pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

# Supported languages
SUPPORTED_LANGUAGES = {
    "en": "English",
    "hi": "Hindi",
    "ta": "Tamil",
    "te": "Telugu",
    "kn": "Kannada",
    "ml": "Malayalam",
    "bn": "Bengali",
    "gu": "Gujarati",
    "mr": "Marathi",
    "pa": "Punjabi",
    "ur": "Urdu",
    "sa": "Sanskrit",
}


class SummarizationRequest(BaseModel):
    text: str
    target_language: str = "en"
    max_length: Optional[int] = 150
    min_length: Optional[int] = 50


async def extract_text_from_docx(content: bytes) -> str:
    doc = Document(io.BytesIO(content))
    paragraphs = [p.text for p in doc.paragraphs if p.text and p.text.strip()]
    return "\n\n".join(paragraphs)


async def extract_text_from_pdf(content: bytes) -> str:
    try:
        pdf = PdfReader(io.BytesIO(content))
        pages: List[str] = []
        for page in pdf.pages:
            ptext = page.extract_text() or ""
            if ptext.strip():
                pages.append(ptext)
        return "\n\n".join(pages)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to extract PDF text: {e}")


async def extract_text_from_image(content: bytes) -> str:
    tmp_path = None
    try:
        with NamedTemporaryFile(delete=False, suffix=".png") as f:
            f.write(content)
            tmp_path = f.name
        img = Image.open(tmp_path)
        if img.mode != "RGB":
            img = img.convert("RGB")
        text = pytesseract.image_to_string(img)
        return text
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR failed: {e}")
    finally:
        try:
            if tmp_path and os.path.exists(tmp_path):
                os.unlink(tmp_path)
        except Exception:
            pass


# Load summarization model and tokenizer
# Use a smaller model for faster local testing. Swap back to a larger model
# (facebook/bart-large-cnn) for final production runs if you have the disk/time.
MODEL_NAME = "sshleifer/distilbart-cnn-12-6"
try:
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    device = 0 if torch.cuda.is_available() else -1
    summarizer = pipeline("summarization", model=MODEL_NAME, tokenizer=tokenizer, device=device)
except Exception as e:
    # allow server start; model loading errors will be raised on request
    summarizer = None
    tokenizer = None
    print(f"Warning: could not load model '{MODEL_NAME}': {e}")


def ensure_model_loaded():
    """Attempt to import/initialize transformers and torch and load the model lazily.

    Raises HTTPException with actionable guidance if loading fails.
    """
    global pipeline, AutoTokenizer, torch, tokenizer, summarizer

    if summarizer is not None and tokenizer is not None:
        return

    # Try to import missing libraries if they weren't available at module import
    try:
        if pipeline is None or AutoTokenizer is None:
            from transformers import pipeline as _pipeline, AutoTokenizer as _AutoTokenizer
            pipeline = _pipeline
            AutoTokenizer = _AutoTokenizer
    except Exception as ie:
        raise HTTPException(status_code=500, detail=(
            f"Required package 'transformers' is not available or failed to import: {ie}. "
            "Install it in your backend venv: python -m pip install transformers sentencepiece"
        ))

    try:
        if torch is None:
            import importlib
            torch = importlib.import_module('torch')
    except Exception as ie:
        raise HTTPException(status_code=500, detail=(
            f"Required package 'torch' is not available or failed to import: {ie}. "
            "Install it in your backend venv (choose CPU or CUDA wheel): python -m pip install torch"
        ))

    # Finally load tokenizer and pipeline
    try:
        # Load tokenizer and summarizer (this may download model weights on first run)
        tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
        device = 0 if getattr(torch, 'cuda', None) and torch.cuda.is_available() else -1
        summarizer = pipeline("summarization", model=MODEL_NAME, tokenizer=tokenizer, device=device)
    except Exception as e:
        raise HTTPException(status_code=500, detail=(
            f"Failed to load model '{MODEL_NAME}': {e}. "
            "Ensure the server has network access to download model weights or place the model in the local cache."
        ))


def chunk_text_by_tokens(text: str, max_tokens: Optional[int] = None) -> List[str]:
    if tokenizer is None:
        # Naive fallback
        words = text.split()
        chunk_size = 800
        return [" ".join(words[i:i + chunk_size]) for i in range(0, len(words), chunk_size)]

    model_max = min(getattr(tokenizer, "model_max_length", 1024), 1024)
    if max_tokens is None:
        max_tokens = max(256, model_max - 64)

    words = text.split()
    chunks: List[str] = []
    current: List[str] = []
    for w in words:
        current.append(w)
        joined = " ".join(current)
        toks = tokenizer.encode(joined, add_special_tokens=False)
        if len(toks) >= max_tokens:
            # remove last word and finalize
            current.pop()
            if current:
                chunks.append(" ".join(current))
            current = [w]
    if current:
        chunks.append(" ".join(current))
    return chunks


async def summarize_with_local_model(text: str, max_length: int = 150, min_length: int = 50) -> str:
    # If a HF summarizer pipeline is already loaded in memory, use it.
    # Do NOT attempt to download the model automatically here — that can block
    # and crash the server in constrained environments. Instead, fall back to
    # a lightweight extractive summarizer when no model is present.
    if summarizer is None:
        print("Summarizer pipeline not loaded; using fallback extractive summarizer.")
        return fallback_summarize(text, max_length=max_length, min_length=min_length)

    chunks = chunk_text_by_tokens(text)
    summaries: List[str] = []
    for chunk in chunks:
        try:
            res = summarizer(chunk, max_length=max_length, min_length=min_length, do_sample=False)
            summaries.append(res[0].get("summary_text", ""))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Model error: {e}")

    final_summary = "\n\n".join(s.strip() for s in summaries if s and s.strip())
    return final_summary


def fallback_summarize(text: str, max_length: int = 150, min_length: int = 50) -> str:
    """Very small extractive summarizer: return the first N sentences truncated to max_length words.

    This keeps the API usable when a large HF model is unavailable.
    """
    import re

    # Split into sentences (naive)
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    if not sentences:
        return text[:max_length]

    selected = []
    words = 0
    for s in sentences:
        sw = len(s.split())
        if words + sw <= max_length or not selected:
            selected.append(s.strip())
            words += sw
        else:
            break

    summary = " ".join(selected)
    # Ensure we meet min_length roughly by adding more if needed
    if len(summary.split()) < min_length:
        # add more sentences if available
        for s in sentences[len(selected):]:
            summary += " " + s.strip()
            if len(summary.split()) >= min_length:
                break

    return summary


async def translate_text(text: str, target_lang: str) -> str:
    if not target_lang or target_lang.lower() == "en":
        return text
    try:
        translator = Translator(to_lang=target_lang)
        # Break into moderate chunks to avoid remote limits
        MAX_CHUNK = 800
        words = text.split()
        chunks: List[str] = []
        cur: List[str] = []
        cur_len = 0
        for w in words:
            if cur_len + len(w) + 1 > MAX_CHUNK:
                chunks.append(" ".join(cur))
                cur = [w]
                cur_len = len(w)
            else:
                cur.append(w)
                cur_len += len(w) + 1
        if cur:
            chunks.append(" ".join(cur))

        translated_parts: List[str] = []
        for c in chunks:
            translated_parts.append(translator.translate(c))
        return " ".join(translated_parts)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Translation failed: {e}")


@app.post("/summarize")
async def summarize_text(req: SummarizationRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")

    summary = await summarize_with_local_model(text, max_length=req.max_length or 150, min_length=req.min_length or 50)
    translated = await translate_text(summary, req.target_language or "en")
    return {
        "summary": translated,
        "language": req.target_language,
        "original_length": len(text.split()),
        "summary_length": len(translated.split()),
    }


@app.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    target_language: str = Form("en"),
    max_length: int = Form(150),
    min_length: int = Form(50),
):
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    ext = os.path.splitext(file.filename)[1].lower()
    content = await file.read()
    if ext in [".txt", ".md", ".rtf"]:
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            text = content.decode("latin-1", errors="ignore")
    elif ext in [".docx", ".doc"]:
        text = await extract_text_from_docx(content)
    elif ext == ".pdf":
        text = await extract_text_from_pdf(content)
    elif ext in [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff"]:
        text = await extract_text_from_image(content)
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported file extension: {ext}")

    if not text or not text.strip():
        raise HTTPException(status_code=400, detail="No text could be extracted from file")

    summary = await summarize_with_local_model(text, max_length=max_length, min_length=min_length)
    translated = await translate_text(summary, target_language or "en")

    return {
        "summary": translated,
        "language": target_language,
        "original_length": len(text.split()),
        "summary_length": len(translated.split()),
        "filename": file.filename,
        "original_text": text,
    }


@app.get("/languages")
async def get_languages():
    return {"languages": [{"code": k, "name": v} for k, v in SUPPORTED_LANGUAGES.items()]}


@app.post("/load_model")
def load_model(background_tasks: BackgroundTasks):
    """Trigger downloading/loading the HF model in the background.

    Use this when you want to load the summarization model ahead of time.
    Returns immediately while the model loads in a background task.
    """

    def _load():
        try:
            ensure_model_loaded()
            print("Model loaded successfully.")
        except Exception as e:
            print(f"Model load failed in background: {e}")

    background_tasks.add_task(_load)
    return {"status": "loading_started", "model": MODEL_NAME}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
