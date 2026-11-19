#!/usr/bin/env python3
"""Minimal Markdown -> DOCX renderer for the CodeScope course documents.

Supported syntax:
  # / ## / ### / #### headings
  paragraphs, **bold**, `inline code`, *italic*
  - bullets (2-space nesting)
  1. numbered lists
  pipe tables (header row + |---| separator), [[TABLE:caption]] before a table
  [[FIG:path|caption|width_cm]] for figures
  [[PAGEBREAK]]
  fenced code blocks
"""
from __future__ import annotations

import re
from pathlib import Path

from docx import Document
from docx.enum.table import WD_ALIGN_VERTICAL, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_TAB_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor
from PIL import Image

NAVY = RGBColor(0x1F, 0x38, 0x64)
BLUE = RGBColor(0x2E, 0x75, 0xB6)
SLATE = RGBColor(0x47, 0x55, 0x69)
MUTED = RGBColor(0x64, 0x74, 0x8B)
INK = RGBColor(0x1F, 0x29, 0x37)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)

HEADER_FILL = "1F3864"
BAND_FILL = "F1F5F9"
BORDER = "CBD5E1"


def ea(run, font="宋体"):
    rPr = run._element.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.insert(0, rFonts)
    rFonts.set(qn("w:eastAsia"), font)


def style_font(style, ascii_font, ea_font, size, bold=None, color=None):
    style.font.name = ascii_font
    style.font.size = Pt(size)
    if bold is not None:
        style.font.bold = bold
    if color is not None:
        style.font.color.rgb = color
    rPr = style.element.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.append(rFonts)
    rFonts.set(qn("w:ascii"), ascii_font)
    rFonts.set(qn("w:hAnsi"), ascii_font)
    rFonts.set(qn("w:eastAsia"), ea_font)


def add_field(paragraph, code, placeholder=""):
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = code
    sep = OxmlElement("w:fldChar")
    sep.set(qn("w:fldCharType"), "separate")
    text = OxmlElement("w:t")
    text.text = placeholder
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.append(begin)
    run._r.append(instr)
    run._r.append(sep)
    run._r.append(text)
    run._r.append(end)
    return run


P_BDR_SUCCESSORS = (
    "w:shd", "w:tabs", "w:suppressAutoHyphens", "w:kinsoku", "w:wordWrap",
    "w:overflowPunct", "w:topLinePunct", "w:autoSpaceDE", "w:autoSpaceDN",
    "w:bidi", "w:adjustRightInd", "w:snapToGrid", "w:spacing", "w:ind",
    "w:contextualSpacing", "w:mirrorIndents", "w:suppressOverlap", "w:jc",
    "w:textDirection", "w:textAlignment", "w:textboxTightWrap",
    "w:outlineLvl", "w:divId", "w:cnfStyle", "w:rPr", "w:sectPr", "w:pPrChange",
)


def para_border(paragraph, edge="bottom", color=BORDER, size="6", space="4"):
    pPr = paragraph._p.get_or_add_pPr()
    pBdr = OxmlElement("w:pBdr")
    el = OxmlElement(f"w:{edge}")
    el.set(qn("w:val"), "single")
    el.set(qn("w:sz"), size)
    el.set(qn("w:space"), space)
    el.set(qn("w:color"), color)
    pBdr.append(el)
    pPr.insert_element_before(pBdr, *P_BDR_SUCCESSORS)


def shade(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    tcPr.append(shd)


def repeat_header(row):
    trPr = row._tr.get_or_add_trPr()
    el = OxmlElement("w:tblHeader")
    el.set(qn("w:val"), "true")
    trPr.append(el)


def no_split(row):
    trPr = row._tr.get_or_add_trPr()
    if trPr.find(qn("w:cantSplit")) is None:
        trPr.append(OxmlElement("w:cantSplit"))


INLINE = re.compile(r"(\*\*.+?\*\*|`.+?`|\*.+?\*)")


def add_inline(paragraph, text, size=None, color=None, bold=False, italic=False):
    for part in INLINE.split(text):
        if not part:
            continue
        run = None
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            run = paragraph.add_run(part[2:-2])
            run.bold = True
        elif part.startswith("`") and part.endswith("`") and len(part) > 2:
            run = paragraph.add_run(part[1:-1])
            run.font.name = "Consolas"
            rPr = run._element.get_or_add_rPr()
            rFonts = rPr.find(qn("w:rFonts"))
            if rFonts is None:
                rFonts = OxmlElement("w:rFonts")
                rPr.insert(0, rFonts)
            rFonts.set(qn("w:eastAsia"), "Consolas")
            if size:
                run.font.size = Pt(max(size - 1, 8))
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            run = paragraph.add_run(part[1:-1])
            run.italic = True
        else:
            run = paragraph.add_run(part)
        if run is None:
            continue
        if bold:
            run.bold = True
        if italic:
            run.italic = True
        if size:
            run.font.size = Pt(size)
        if color:
            run.font.color.rgb = color
        ea(run)


def setup_document() -> Document:
    doc = Document()
    style_font(doc.styles["Normal"], "Times New Roman", "宋体", 10.5, color=INK)
    normal = doc.styles["Normal"]
    normal.paragraph_format.line_spacing = 1.5
    normal.paragraph_format.space_after = Pt(4)

    specs = {
        "Heading 1": ("Arial", "黑体", 16, NAVY, 16, 8),
        "Heading 2": ("Arial", "黑体", 13.5, BLUE, 12, 6),
        "Heading 3": ("Arial", "黑体", 11.5, NAVY, 10, 4),
        "Heading 4": ("Arial", "宋体", 10.5, SLATE, 8, 3),
    }
    for name, (ascii_f, ea_f, size, color, before, after) in specs.items():
        st = doc.styles[name]
        style_font(st, ascii_f, ea_f, size, bold=True, color=color)
        st.paragraph_format.space_before = Pt(before)
        st.paragraph_format.space_after = Pt(after)
        st.paragraph_format.keep_with_next = True
        st.paragraph_format.line_spacing = 1.2

    section = doc.sections[0]
    section.page_width, section.page_height = Cm(21), Cm(29.7)
    section.left_margin = section.right_margin = Cm(2.0)
    section.top_margin = Cm(2.2)
    section.bottom_margin = Cm(2.0)
    section.header_distance = section.footer_distance = Cm(0.9)
    section.different_first_page_header_footer = True
    return doc


def add_header_footer(doc, header_left, header_right):
    section = doc.sections[0]

    try:
        doc.styles["Header"].paragraph_format.tab_stops.clear_all()
    except KeyError:
        pass
    hp = section.header.paragraphs[0]
    hp.alignment = WD_ALIGN_PARAGRAPH.LEFT
    hp.paragraph_format.tab_stops.clear_all()
    hp.paragraph_format.tab_stops.add_tab_stop(Cm(17.0), WD_TAB_ALIGNMENT.RIGHT)
    r = hp.add_run(header_left)
    r.font.name = "Arial"
    r.font.size = Pt(8)
    r.font.color.rgb = MUTED
    ea(r, "宋体")
    r = hp.add_run("\t" + header_right)
    r.font.name = "Arial"
    r.font.size = Pt(8)
    r.font.color.rgb = MUTED
    ea(r, "宋体")
    para_border(hp, "bottom")

    fp = section.footer.paragraphs[0]
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = fp.add_run("第 ")
    r.font.size = Pt(9)
    ea(r)
    add_field(fp, "PAGE", "1")
    r = fp.add_run(" 页 · 共 ")
    r.font.size = Pt(9)
    ea(r)
    add_field(fp, "NUMPAGES", "1")
    r = fp.add_run(" 页")
    r.font.size = Pt(9)
    ea(r)


def add_cover(doc, meta):
    for _ in range(3):
        p = doc.add_paragraph()
        p.paragraph_format.space_after = Pt(0)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(meta.get("course", "软件工程课程 · 期末项目"))
    r.font.name = "Arial"
    r.font.size = Pt(12)
    r.font.color.rgb = MUTED
    ea(r, "黑体")

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(10)
    r = p.add_run(meta["project"])
    r.font.name = "Arial"
    r.font.size = Pt(26)
    r.bold = True
    r.font.color.rgb = NAVY
    ea(r, "黑体")

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(meta["title"])
    r.font.name = "Arial"
    r.font.size = Pt(24)
    r.bold = True
    r.font.color.rgb = NAVY
    ea(r, "黑体")

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = p.add_run(f"版本 {meta['version']}")
    r.font.name = "Arial"
    r.font.size = Pt(12)
    r.font.color.rgb = SLATE
    ea(r, "宋体")

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    para_border(p, "bottom", "1F3864", "12", "6")

    for _ in range(5):
        doc.add_paragraph()

    for label, value in (
        ("项目名称", meta["project"]),
        ("课程名称", meta.get("course_name", "软件工程")),
        ("作者", meta["author"]),
        ("学号", meta["student_id"]),
        ("完成日期", meta["date"]),
        ("代码仓库", meta.get("repo", "（提交前填写）")),
    ):
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_after = Pt(8)
        r = p.add_run(f"{label}：")
        r.font.name = "Arial"
        r.font.size = Pt(11)
        r.font.color.rgb = SLATE
        ea(r, "黑体")
        r = p.add_run(value)
        r.font.name = "Arial"
        r.font.size = Pt(11)
        r.font.color.rgb = INK
        ea(r, "宋体")

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(40)
    r = p.add_run("2026 年 11 月")
    r.font.name = "Arial"
    r.font.size = Pt(10.5)
    r.font.color.rgb = MUTED
    ea(r, "宋体")

    doc.add_page_break()


def add_revision(doc, author, note="按课程模板完成软件需求规约，冻结核心需求基线"):
    p = doc.add_paragraph(style="Heading 1")
    p.paragraph_format.page_break_before = False
    r = p.add_run("修订历史记录")
    ea(r, "黑体")

    rows = [
        ["日期", "版本", "修订说明", "作者"],
        ["2026-11-09", "v0.1", "完成项目章程与范围冻结，明确两个正交维度与 P0/P1 范围", author],
        ["2026-11-20", "v1.0", note, author],
    ]
    add_table(doc, rows)
    doc.add_page_break()


def add_toc(doc, entries=None):
    p = doc.add_paragraph(style="Heading 1")
    p.paragraph_format.page_break_before = False
    r = p.add_run("目录")
    ea(r, "黑体")
    if entries:
        rows = [["章节", "页码"]]
        for level, title, page in entries:
            indent = "" if level == 1 else ("　　" if level == 2 else "　　　　")
            rows.append([indent + title, str(page)])
        add_table(doc, rows, font_size=8.5, compact=True)
        p = doc.add_paragraph()
        r = p.add_run("说明：页码依据生成时的排版；若在 Word 中增删内容，请重新核对页码。")
        r.font.size = Pt(9)
        r.font.color.rgb = MUTED
        ea(r)
    else:
        p = doc.add_paragraph()
        add_field(p, 'TOC \\o "1-3" \\h \\z \\u', "（目录生成中）")
        p = doc.add_paragraph()
        r = p.add_run("提示：若目录未自动展开，请在 Word 中全选后按 F9，或右键目录选择“更新域”。")
        r.font.size = Pt(9)
        r.font.color.rgb = MUTED
        ea(r)


def add_heading(doc, text, level):
    p = doc.add_paragraph(style=f"Heading {level}")
    if level == 1:
        p.paragraph_format.page_break_before = True
    r = p.add_run(text)
    if level <= 2:
        r.bold = True
    ea(r, "黑体" if level <= 3 else "宋体")
    return p


def add_paragraph(doc, text):
    p = doc.add_paragraph()
    add_inline(p, text)
    return p


def add_bullet(doc, text, level=0):
    style = "List Bullet" if level == 0 else "List Bullet 2"
    try:
        p = doc.add_paragraph(style=style)
    except KeyError:
        p = doc.add_paragraph(style="List Bullet")
    add_inline(p, text)
    return p


def add_number(doc, text, n):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.9)
    p.paragraph_format.first_line_indent = Cm(-0.55)
    p.paragraph_format.space_after = Pt(2)
    r = p.add_run(f"{n}. ")
    r.font.size = Pt(10.5)
    ea(r)
    add_inline(p, text)
    return p


def add_quote(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.8)
    r = p.add_run(text)
    r.italic = True
    r.font.color.rgb = SLATE
    ea(r)
    return p


def add_code_line(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.5)
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.line_spacing = 1.0
    r = p.add_run(text if text else " ")
    r.font.name = "Consolas"
    r.font.size = Pt(8.5)
    rPr = r._element.get_or_add_rPr()
    rFonts = rPr.find(qn("w:rFonts"))
    if rFonts is None:
        rFonts = OxmlElement("w:rFonts")
        rPr.insert(0, rFonts)
    rFonts.set(qn("w:eastAsia"), "Consolas")
    pPr = p._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), "F5F7FA")
    pPr.append(shd)
    return p


def add_table(doc, rows, caption=None, font_size=9, compact=False):
    if not rows:
        return
    cols = max(len(r) for r in rows)
    if caption:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.space_before = Pt(6)
        p.paragraph_format.space_after = Pt(2)
        r = p.add_run(caption)
        r.font.size = Pt(9)
        r.bold = True
        r.font.color.rgb = SLATE
        ea(r)

    table = doc.add_table(rows=len(rows), cols=cols)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = True

    for i, row in enumerate(rows):
        for j in range(cols):
            cell = table.cell(i, j)
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
            text = row[j] if j < len(row) else ""
            text = text.replace("<br>", "\n").replace("<br/>", "\n")
            cell.text = ""
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.0 if compact else 1.1
            parts = text.split("\n")
            if i == 0:
                shade(cell, HEADER_FILL)
                for idx, part in enumerate(parts):
                    add_inline(p, part, size=font_size, color=WHITE, bold=True)
                    if idx < len(parts) - 1:
                        p.add_run().add_break()
            else:
                if i % 2 == 0:
                    shade(cell, BAND_FILL)
                for idx, part in enumerate(parts):
                    add_inline(p, part, size=font_size)
                    if idx < len(parts) - 1:
                        p.add_run().add_break()
    repeat_header(table.rows[0])
    for row in table.rows:
        no_split(row)
    if compact:
        tblPr = table._tbl.tblPr
        mar = OxmlElement("w:tblCellMar")
        for side in ("top", "left", "bottom", "right"):
            el = OxmlElement(f"w:{side}")
            el.set(qn("w:w"), "30" if side in ("top", "bottom") else "80")
            el.set(qn("w:type"), "dxa")
            mar.append(el)
        tblPr.append(mar)
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(6)
    return table


def add_figure(doc, path: Path, caption: str, width_cm: float = 15.5):
    if not path.exists():
        p = doc.add_paragraph()
        r = p.add_run(f"[缺失图片：{path}]")
        r.font.color.rgb = RGBColor(0xC0, 0x00, 0x00)
        return
    with Image.open(path) as im:
        w, h = im.size
    if w and h / w > 1.05:
        width_cm = min(width_cm, 11.5)
    if w and h:
        max_h_cm = 21.5
        if (h / w) * width_cm > max_h_cm:
            width_cm = max_h_cm * w / h
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(2)
    p.add_run().add_picture(str(path), width=Cm(width_cm))
    cap = doc.add_paragraph()
    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
    cap.paragraph_format.space_after = Pt(8)
    r = cap.add_run(caption)
    r.font.size = Pt(9)
    r.font.color.rgb = MUTED
    ea(r)


TABLE_SEP = re.compile(r"^\|?\s*:?-{2,}.*\|")


def parse_table(lines, start):
    header = lines[start].strip()
    rows = []
    i = start
    while i < len(lines) and lines[i].strip().startswith("|"):
        line = lines[i].strip()
        if i == start + 1 and TABLE_SEP.match(line):
            i += 1
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        rows.append(cells)
        i += 1
    return rows, i


def parse_markdown(doc, md_path: Path, base_dir: Path):
    lines = md_path.read_text(encoding="utf-8").splitlines()
    i = 0
    pending_caption = None
    in_code = False
    code_lines = []
    num_counter = 0
    last_numbered = False
    while i < len(lines):
        line = lines[i]
        raw = line.rstrip()
        stripped = raw.strip()
        prev_numbered = last_numbered
        last_numbered = False

        if in_code:
            if stripped.startswith("```"):
                in_code = False
                for cl in code_lines:
                    add_code_line(doc, cl)
                code_lines = []
            else:
                code_lines.append(raw)
            i += 1
            continue

        if stripped.startswith("```"):
            in_code = True
            code_lines = []
            i += 1
            continue

        if not stripped:
            i += 1
            continue

        m = re.match(r"^(#{1,4})\s+(.*)$", stripped)
        if m:
            add_heading(doc, m.group(2).strip(), len(m.group(1)))
            i += 1
            continue

        m = re.match(r"^\[\[FIG:(.+?)\|(.+?)(?:\|([\d.]+))?\]\]$", stripped)
        if m:
            rel, caption, width = m.group(1), m.group(2), m.group(3)
            add_figure(doc, base_dir / rel, caption, float(width) if width else 15.5)
            i += 1
            continue

        m = re.match(r"^\[\[TABLE:(.+?)\]\]$", stripped)
        if m:
            pending_caption = m.group(1)
            i += 1
            continue

        if stripped == "[[PAGEBREAK]]":
            doc.add_page_break()
            i += 1
            continue

        if stripped.startswith("|") and i + 1 < len(lines) and TABLE_SEP.match(lines[i + 1].strip()):
            rows, i = parse_table(lines, i)
            add_table(doc, rows, pending_caption)
            pending_caption = None
            continue

        if re.match(r"^\s*-\s+", raw):
            indent = len(raw) - len(raw.lstrip())
            add_bullet(doc, re.sub(r"^\s*-\s+", "", raw), 0 if indent < 2 else 1)
            i += 1
            continue

        if re.match(r"^\s*\d+\.\s+", raw):
            num_counter = num_counter + 1 if prev_numbered else 1
            add_number(doc, re.sub(r"^\s*\d+\.\s+", "", raw), num_counter)
            last_numbered = True
            i += 1
            continue

        if stripped.startswith(">"):
            add_quote(doc, stripped.lstrip("> ").strip())
            i += 1
            continue

        if re.fullmatch(r"-{3,}", stripped):
            p = doc.add_paragraph()
            para_border(p, "bottom", BORDER, "6", "2")
            i += 1
            continue

        add_paragraph(doc, stripped)
        i += 1


def build(meta: dict, body_md: Path, out_docx: Path, header_left: str, header_right: str,
          toc_entries=None):
    doc = setup_document()
    add_cover(doc, meta)
    add_revision(doc, meta["author"], meta.get("revision_note", "按课程模板完成软件需求规约，冻结核心需求基线"))
    add_toc(doc, toc_entries)
    parse_markdown(doc, body_md, body_md.parent)
    add_header_footer(doc, header_left, header_right)
    out_docx.parent.mkdir(parents=True, exist_ok=True)
    doc.save(out_docx)
    print(f"wrote {out_docx}")


def extract_headings(body_md: Path):
    result = []
    in_code = False
    for line in body_md.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        m = re.match(r"^(#{1,2})\s+(.*)$", line.strip())
        if m:
            result.append((len(m.group(1)), m.group(2).strip()))
    return result


def pdf_page_map(pdf_path: Path, headings):
    import subprocess

    out = subprocess.run(
        ["pdftotext", "-layout", str(pdf_path), "-"],
        capture_output=True, text=True, check=True,
    ).stdout
    pages = out.split("\f")
    norm = lambda s: re.sub(r"\s+", "", s)
    pages_norm = [norm(p) for p in pages]
    start_idx = 3
    for i, page in enumerate(pages_norm):
        if "页码依据生成时的排版" in page:
            start_idx = i + 1
    result = {}
    for level, title in headings:
        key = norm(title)
        if not key:
            continue
        for i, page in enumerate(pages_norm):
            if i < start_idx:
                continue
            if key in page:
                result[title] = i + 1
                break
    return result
