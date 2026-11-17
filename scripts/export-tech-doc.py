from __future__ import annotations

import html
import re
import textwrap
from pathlib import Path

from pypdf import PdfReader
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path.cwd()
SOURCE = ROOT / "docs" / "技术文档.md"
OUTPUT = ROOT / "output" / "pdf" / "守药人-MediGuardian-技术文档-提交版.pdf"
FONT_REGULAR = Path(r"C:\Windows\Fonts\msyh.ttc")
FONT_BOLD = Path(r"C:\Windows\Fonts\msyhbd.ttc")
FONT_NAME = "MicrosoftYaHei"
FONT_BOLD_NAME = "MicrosoftYaHei-Bold"
INK = colors.HexColor("#24302D")
MUTED = colors.HexColor("#58645F")
ACCENT = colors.HexColor("#0C6E65")
ACCENT_DARK = colors.HexColor("#084E49")
LINE = colors.HexColor("#D7DFDC")
WASH = colors.HexColor("#F2F6F4")
WARNING = colors.HexColor("#9D5106")
PAGE_WIDTH, PAGE_HEIGHT = A4
FRAME_WIDTH = PAGE_WIDTH - 34 * mm


def register_fonts() -> None:
    if not FONT_REGULAR.exists() or not FONT_BOLD.exists():
        raise FileNotFoundError("Microsoft YaHei regular/bold fonts are required for Chinese PDF text.")
    pdfmetrics.registerFont(TTFont(FONT_NAME, str(FONT_REGULAR), subfontIndex=0))
    pdfmetrics.registerFont(TTFont(FONT_BOLD_NAME, str(FONT_BOLD), subfontIndex=0))
    pdfmetrics.registerFontFamily(
        FONT_NAME,
        normal=FONT_NAME,
        bold=FONT_BOLD_NAME,
        italic=FONT_NAME,
        boldItalic=FONT_BOLD_NAME,
    )


def inline_markup(value: str) -> str:
    protected: list[str] = []

    def hold(match: re.Match[str]) -> str:
        protected.append(match.group(0))
        return f"@@LINK{len(protected) - 1}@@"

    value = re.sub(r"\[([^\]]+)\]\((https?://[^ )]+)\)", hold, value)
    value = html.escape(value, quote=False)
    value = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", value)
    value = re.sub(r"`([^`]+)`", r'<font color="#45534E">\1</font>', value)
    for index, raw in enumerate(protected):
        match = re.fullmatch(r"\[([^\]]+)\]\((https?://[^ )]+)\)", raw)
        if match:
            label, url = match.groups()
            replacement = f'<link href="{html.escape(url, quote=True)}"><u>{html.escape(label)}</u></link>'
            value = value.replace(f"@@LINK{index}@@", replacement)
    return value


def split_table_row(line: str) -> list[str]:
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def metadata_from_markdown(lines: list[str]) -> tuple[list[tuple[str, str]], int]:
    for index, line in enumerate(lines):
        if line.strip() != "| 项 | 内容 |":
            continue
        rows: list[tuple[str, str]] = []
        cursor = index + 2
        while cursor < len(lines) and lines[cursor].lstrip().startswith("|"):
            cells = split_table_row(lines[cursor])
            if len(cells) >= 2:
                rows.append((cells[0], cells[1]))
            cursor += 1
        return rows, cursor
    return [], 0


def make_styles() -> dict[str, ParagraphStyle]:
    return {
        "body": ParagraphStyle(
            "Body",
            fontName=FONT_NAME,
            fontSize=9,
            leading=14,
            textColor=INK,
            spaceAfter=6,
            wordWrap="CJK",
            splitLongWords=1,
        ),
        "h1": ParagraphStyle(
            "Heading1",
            fontName=FONT_BOLD_NAME,
            fontSize=17,
            leading=23,
            textColor=ACCENT_DARK,
            spaceBefore=13,
            spaceAfter=8,
            keepWithNext=1,
            wordWrap="CJK",
        ),
        "h2": ParagraphStyle(
            "Heading2",
            fontName=FONT_BOLD_NAME,
            fontSize=13,
            leading=18,
            textColor=ACCENT,
            spaceBefore=11,
            spaceAfter=6,
            keepWithNext=1,
            wordWrap="CJK",
        ),
        "h3": ParagraphStyle(
            "Heading3",
            fontName=FONT_BOLD_NAME,
            fontSize=10.5,
            leading=15,
            textColor=INK,
            spaceBefore=8,
            spaceAfter=4,
            keepWithNext=1,
            wordWrap="CJK",
        ),
        "quote": ParagraphStyle(
            "Quote",
            fontName=FONT_NAME,
            fontSize=8.8,
            leading=13.5,
            textColor=ACCENT_DARK,
            leftIndent=5,
            rightIndent=5,
            spaceAfter=2,
            wordWrap="CJK",
        ),
        "table": ParagraphStyle(
            "TableCell",
            fontName=FONT_NAME,
            fontSize=7.1,
            leading=10,
            textColor=INK,
            spaceAfter=0,
            wordWrap="CJK",
            splitLongWords=1,
        ),
        "tableHeader": ParagraphStyle(
            "TableHeader",
            fontName=FONT_BOLD_NAME,
            fontSize=7.1,
            leading=10,
            textColor=colors.white,
            spaceAfter=0,
            wordWrap="CJK",
            splitLongWords=1,
        ),
        "code": ParagraphStyle(
            "CodeBlock",
            fontName=FONT_NAME,
            fontSize=6.6,
            leading=8.7,
            textColor=colors.HexColor("#34423D"),
            leftIndent=3,
            rightIndent=3,
            spaceAfter=0,
            wordWrap="CJK",
            splitLongWords=1,
        ),
        "coverTitle": ParagraphStyle(
            "CoverTitle",
            fontName=FONT_BOLD_NAME,
            fontSize=28,
            leading=36,
            alignment=TA_CENTER,
            textColor=ACCENT_DARK,
            spaceAfter=4,
            wordWrap="CJK",
        ),
        "coverSubtitle": ParagraphStyle(
            "CoverSubtitle",
            fontName=FONT_NAME,
            fontSize=12,
            leading=18,
            alignment=TA_CENTER,
            textColor=MUTED,
            spaceAfter=8,
            wordWrap="CJK",
        ),
        "coverLabel": ParagraphStyle(
            "CoverLabel",
            fontName=FONT_BOLD_NAME,
            fontSize=10,
            leading=15,
            alignment=TA_CENTER,
            textColor=ACCENT,
            spaceAfter=4,
            wordWrap="CJK",
        ),
        "coverMeta": ParagraphStyle(
            "CoverMeta",
            fontName=FONT_NAME,
            fontSize=8.2,
            leading=12,
            textColor=INK,
            wordWrap="CJK",
            splitLongWords=1,
        ),
        "coverMetaLabel": ParagraphStyle(
            "CoverMetaLabel",
            fontName=FONT_BOLD_NAME,
            fontSize=8,
            leading=12,
            textColor=ACCENT_DARK,
            wordWrap="CJK",
        ),
    }


def table_widths(column_count: int) -> list[float]:
    if column_count == 2:
        ratios = [0.24, 0.76]
    elif column_count == 3:
        ratios = [0.18, 0.24, 0.58]
    elif column_count == 4:
        ratios = [0.15, 0.23, 0.22, 0.40]
    else:
        ratios = [1 / column_count] * column_count
    return [FRAME_WIDTH * ratio for ratio in ratios]


def table_flow(rows: list[list[str]], styles: dict[str, ParagraphStyle]) -> Table:
    column_count = max(len(row) for row in rows)
    cells = []
    for row_index, row in enumerate(rows):
        padded = row + [""] * (column_count - len(row))
        style = styles["tableHeader"] if row_index == 0 else styles["table"]
        cells.append([Paragraph(inline_markup(cell), style) for cell in padded])
    table = Table(cells, colWidths=table_widths(column_count), repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), ACCENT_DARK),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, WASH]),
                ("GRID", (0, 0), (-1, -1), 0.35, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table


def cover_story(metadata: list[tuple[str, str]], styles: dict[str, ParagraphStyle]) -> list[object]:
    rows = [[Paragraph(inline_markup(key), styles["coverMetaLabel"]), Paragraph(inline_markup(value), styles["coverMeta"])] for key, value in metadata]
    table = Table(rows, colWidths=[FRAME_WIDTH * 0.23, FRAME_WIDTH * 0.77], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), WASH),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    warning = Table(
        [[Paragraph(
            "工程演示原型 · 患者为合成数据 · 知识来源尚未逐条复核 · 不构成诊断、处方或临床验证",
            ParagraphStyle(
                "CoverWarning",
                parent=styles["coverMeta"],
                fontName=FONT_BOLD_NAME,
                fontSize=8,
                leading=12,
                textColor=WARNING,
                alignment=TA_CENTER,
            ),
        )]],
        colWidths=[FRAME_WIDTH],
    )
    warning.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FFF7ED")),
                ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#E9C79C")),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return [
        Spacer(1, 31 * mm),
        Paragraph("全国高校 AI Web 开发挑战赛", styles["coverLabel"]),
        Spacer(1, 5 * mm),
        Paragraph("守药人 MediGuardian", styles["coverTitle"]),
        Paragraph("技术文档", styles["coverSubtitle"]),
        HRFlowable(width="28%", thickness=2, color=ACCENT, hAlign="CENTER", spaceBefore=5, spaceAfter=14),
        Paragraph("面向基层医疗的多模态用药安全 Agent", styles["coverSubtitle"]),
        Spacer(1, 10 * mm),
        table,
        Spacer(1, 10 * mm),
        warning,
        Spacer(1, 8 * mm),
        Paragraph("提交版 · 2026-11-05", ParagraphStyle("CoverDate", parent=styles["coverMeta"], alignment=TA_CENTER, textColor=MUTED)),
        PageBreak(),
    ]


def parse_body(lines: list[str], styles: dict[str, ParagraphStyle]) -> list[object]:
    story: list[object] = []
    index = 0
    in_code = False
    code_lines: list[str] = []

    while index < len(lines):
        raw = lines[index]
        line = raw.strip()
        if line.startswith("```"):
            if in_code:
                rendered: list[str] = []
                for code_line in code_lines:
                    pieces = textwrap.wrap(
                        code_line,
                        width=112,
                        subsequent_indent="  ",
                        break_long_words=True,
                        break_on_hyphens=False,
                    ) or [""]
                    rendered.extend(piece.replace(" ", "&#160;") for piece in pieces)
                block = Paragraph("<br/>".join(html.escape(item, quote=False).replace("&amp;#160;", "&#160;") for item in rendered), styles["code"])
                table = Table([[block]], colWidths=[FRAME_WIDTH])
                table.setStyle(
                    TableStyle(
                        [
                            ("BACKGROUND", (0, 0), (-1, -1), WASH),
                            ("BOX", (0, 0), (-1, -1), 0.45, LINE),
                            ("LEFTPADDING", (0, 0), (-1, -1), 7),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                            ("TOPPADDING", (0, 0), (-1, -1), 6),
                            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                        ]
                    )
                )
                story.append(table)
                story.append(Spacer(1, 7))
                code_lines = []
                in_code = False
            else:
                in_code = True
            index += 1
            continue
        if in_code:
            code_lines.append(raw.rstrip())
            index += 1
            continue
        if not line:
            index += 1
            continue
        if line == "---" or line.startswith("***"):
            story.append(HRFlowable(width="100%", thickness=0.45, color=LINE, spaceBefore=4, spaceAfter=7))
            index += 1
            continue
        if line.startswith("|") and index + 1 < len(lines) and re.match(r"^\s*\|?\s*:?-{3,}", lines[index + 1]):
            rows = [split_table_row(line)]
            index += 2
            while index < len(lines) and lines[index].lstrip().startswith("|"):
                rows.append(split_table_row(lines[index]))
                index += 1
            story.append(table_flow(rows, styles))
            story.append(Spacer(1, 7))
            continue
        heading = re.match(r"^(#{1,4})\s+(.*)$", line)
        if heading:
            level = len(heading.group(1))
            key = "h1" if level == 1 else "h2" if level == 2 else "h3"
            story.append(Paragraph(inline_markup(heading.group(2)), styles[key]))
            index += 1
            continue
        if line.startswith(">"):
            quotes = []
            while index < len(lines) and lines[index].strip().startswith(">"):
                quotes.append(re.sub(r"^\s*>\s?", "", lines[index].strip()))
                index += 1
            quote_table = Table([[Paragraph("<br/>".join(inline_markup(item) for item in quotes), styles["quote"])]], colWidths=[FRAME_WIDTH])
            quote_table.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#EEF6F3")),
                        ("LINEBEFORE", (0, 0), (0, -1), 2, ACCENT),
                        ("LEFTPADDING", (0, 0), (-1, -1), 9),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                        ("TOPPADDING", (0, 0), (-1, -1), 7),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                    ]
                )
            )
            story.append(quote_table)
            story.append(Spacer(1, 7))
            continue
        unordered = re.match(r"^\s*[-*]\s+(.*)$", raw)
        ordered = re.match(r"^\s*\d+\.\s+(.*)$", raw)
        if unordered or ordered:
            count = 1
            while index < len(lines):
                current = lines[index]
                bullet = re.match(r"^\s*[-*]\s+(.*)$", current)
                number = re.match(r"^\s*\d+\.\s+(.*)$", current)
                if not bullet and not number:
                    break
                item_text = bullet.group(1) if bullet else number.group(1)
                bullet_text = "•" if unordered else f"{count}."
                list_style = ParagraphStyle(
                    f"List{index}",
                    parent=styles["body"],
                    leftIndent=14,
                    firstLineIndent=-11,
                    spaceAfter=3,
                )
                story.append(Paragraph(inline_markup(item_text), list_style, bulletText=bullet_text))
                count += 1
                index += 1
            story.append(Spacer(1, 2))
            continue
        story.append(Paragraph(inline_markup(line), styles["body"]))
        index += 1

    if in_code and code_lines:
        story.extend(parse_body(["```", *code_lines, "```"], styles))
    return story


def draw_cover(canvas, document) -> None:
    canvas.saveState()
    canvas.setFillColor(ACCENT)
    canvas.rect(0, PAGE_HEIGHT - 7 * mm, PAGE_WIDTH, 7 * mm, stroke=0, fill=1)
    canvas.restoreState()


def draw_page(canvas, document) -> None:
    page = canvas.getPageNumber()
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.line(17 * mm, PAGE_HEIGHT - 13 * mm, PAGE_WIDTH - 17 * mm, PAGE_HEIGHT - 13 * mm)
    canvas.setFont(FONT_NAME, 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(17 * mm, PAGE_HEIGHT - 10.5 * mm, "守药人 MediGuardian · 技术文档 · 工程演示原型")
    canvas.line(17 * mm, 12 * mm, PAGE_WIDTH - 17 * mm, 12 * mm)
    canvas.drawString(17 * mm, 7.5 * mm, "合成数据 · 非临床验证")
    canvas.drawRightString(PAGE_WIDTH - 17 * mm, 7.5 * mm, f"{page - 1}")
    canvas.restoreState()


def main() -> None:
    register_fonts()
    if not SOURCE.exists():
        raise FileNotFoundError(SOURCE)
    markdown = SOURCE.read_text(encoding="utf-8")
    lines = markdown.splitlines()
    metadata, metadata_end = metadata_from_markdown(lines)
    section_start = next((i for i, line in enumerate(lines) if line.startswith("## 1 ")), None)
    if section_start is None:
        raise ValueError("Technical document section 1 was not found.")

    styles = make_styles()
    story = cover_story(metadata, styles)
    story.extend(parse_body(lines[section_start:], styles))

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    document = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        rightMargin=17 * mm,
        leftMargin=17 * mm,
        topMargin=20 * mm,
        bottomMargin=17 * mm,
        title="守药人 MediGuardian 技术文档",
        author="守药人团队（信息待填写）",
        subject="全国高校 AI Web 开发挑战赛提交版技术文档",
    )
    document.build(story, onFirstPage=draw_cover, onLaterPages=draw_page)

    reader = PdfReader(str(OUTPUT))
    page_count = len(reader.pages)
    if page_count > 30:
        raise ValueError(f"PDF exceeds the 30-page limit: {page_count}")
    if page_count < 2:
        raise ValueError(f"Unexpected PDF page count: {page_count}")
    print(f"Created {OUTPUT}")
    print(f"Pages: {page_count}")


if __name__ == "__main__":
    main()
