import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from md2docx import build, extract_headings, pdf_page_map

base = Path(__file__).resolve().parent.parent
meta = {
    "project": "接力 Relay",
    "title": "软件需求规约",
    "version": "1.0",
    "author": "宋致远",
    "student_id": "524031910665",
    "date": "2026-11-20",
    "repo": "https://github.com/Zhyuan0001/relay",
    "course": "软件工程课程 · 期末项目",
    "course_name": "软件工程",
}
body = base / "docs/requirements.md"
final_docx = base / "docs/软件需求规约-接力-v1.0.docx"
tmp_docx = base / "docs/_tmp_requirements.docx"
header_left = "软件工程 · 期末项目 | 接力 Relay"
header_right = "宋致远 · 524031910665"

headings = extract_headings(body)
placeholder = [(level, title, "…") for level, title in headings]
build(meta, body, tmp_docx, header_left, header_right, toc_entries=placeholder)
subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(tmp_docx.parent), str(tmp_docx)],
               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
tmp_pdf = tmp_docx.with_suffix(".pdf")
pmap = pdf_page_map(tmp_pdf, headings)
missing = [t for _, t in headings if t not in pmap]
entries = [(level, title, pmap.get(title, "–")) for level, title in headings]
build(meta, body, final_docx, header_left, header_right, toc_entries=entries)
subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(final_docx.parent), str(final_docx)],
               check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
print("headings:", len(headings), "missing:", missing)
tmp_docx.unlink(missing_ok=True)
tmp_pdf.unlink(missing_ok=True)
