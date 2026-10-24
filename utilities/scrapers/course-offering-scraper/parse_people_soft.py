#!/usr/bin/env python3
"""Parse saved Stony Brook PeopleSoft Browse Course Catalog XML responses.

This script is deliberately offline-only: it parses response files you save from
PeopleSoft and does not log in, call private APIs, or bypass session controls.
"""
from __future__ import annotations
import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any
from bs4 import BeautifulSoup


def get_page_html(path: Path) -> str:
    raw = path.read_text(encoding="utf-8", errors="replace")
    # Playwright saves rendered HTML; existing downloaded PeopleSoft XML
    # responses begin with an XML declaration and a PAGE root.
    if not raw.lstrip().startswith("<?xml"):
        if raw.lstrip().startswith("<"):
            return raw
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as exc:
        # Some saved HTML responses omit a doctype or begin with a fragment.
        if not raw.lstrip().startswith("<?xml") and "<" in raw[:500]:
            return raw
        raise ValueError(f"{path} is not a valid PeopleSoft XML or HTML response: {exc}") from exc
    for field in root.findall("FIELD"):
        if field.attrib.get("id") in {"win0divPSPAGECONTAINER", "win0divPAGECONTAINER"}:
            return field.text or ""
    raise ValueError(f"No page-container FIELD found in {path}")


def text_of(node) -> str | None:
    if node is None:
        return None
    value = node.get_text(" ", strip=True)
    value = re.sub(r"\s+", " ", value).strip()
    return value or None


def parse_index(path: Path) -> list[dict[str, Any]]:
    soup = BeautifulSoup(get_page_html(path), "html.parser")
    subjects: dict[str, str] = {}
    # PeopleSoft uses the same numeric group index for the subject heading and course grid.
    for node in soup.select('[id^="win0divDERIVED_SSS_BCC_GROUP_BOX_1$147$$"]'):
        match = re.search(r"\$\$(\d+)$", node.get("id", ""))
        label = text_of(node)
        if match and label:
            code = label.split(" - ", 1)[0].strip()
            subjects[match.group(1)] = code

    records = []
    for row in soup.select('tr[id^="trCOURSE_LIST$"]'):
        match = re.match(r"trCOURSE_LIST\$(\d+)_row\d+$", row.get("id", ""))
        if not match:
            continue
        group = match.group(1)
        number = text_of(row.select_one('[id^="CRSE_NBR$"]'))
        title = text_of(row.select_one('[id^="CRSE_TITLE$"]'))
        if not number or not title:
            continue
        number = number.strip()
        # Preserve unusual identifiers too (e.g. SBS/AP, 300TRG, or parenthesized
        # future-course numbers). Do not silently drop records based on code shape.
        subject = subjects.get(group)
        records.append({
            "subject": subject,
            "course_number": number,
            "course_code": f"{subject} {number}" if subject else None,
            "title": title,
            "source_file": path.name,
            "source_group_index": int(group),
        })

    # Deduplicate in case a page contains repeated grids, retaining original order.
    unique: dict[tuple[str | None, str, str], dict[str, Any]] = {}
    for record in records:
        key = (record["subject"], record["course_number"], record["title"])
        unique.setdefault(key, record)
    return list(unique.values())


def field_text(soup: BeautifulSoup, element_id: str) -> str | None:
    return text_of(soup.find(id=element_id))


def parse_detail(path: Path) -> dict[str, Any]:
    soup = BeautifulSoup(get_page_html(path), "html.parser")
    heading = field_text(soup, "DERIVED_CRSECAT_DESCR200")
    # Usually formatted as "EAS 101 - Engineering and Applied Sciences".
    code, title = None, None
    if heading:
        m = re.match(r"\s*([A-Z][A-Z0-9&]*\s+\d+[A-Za-z]?)\s*-\s*(.*)\s*$", heading)
        if m:
            code, title = m.group(1), m.group(2)
        else:
            title = heading

    full_text = text_of(soup) or ""
    prerequisite_mentions = []
    for line in re.split(r"\s{2,}|\n", full_text):
        if re.search(r"prerequisite|corequisite|co-requisite|advisory requisite", line, re.I):
            prerequisite_mentions.append(line.strip())

    return {
        "course_code": code,
        "title": title,
        "career": field_text(soup, "SSR_CRSE_OFF_VW_ACAD_CAREER$0"),
        "credits_range": field_text(soup, "DERIVED_CRSECAT_UNITS_RANGE$0"),
        "grading_basis": field_text(soup, "SSR_CRSE_OFF_VW_GRADING_BASIS$0"),
        "course_component": field_text(soup, "DERIVED_CRSECAT_DESCR$0"),
        "component_requirement": field_text(soup, "DERIVED_CRSECAT_DESCR50$0"),
        "campus": field_text(soup, "CAMPUS_TBL_DESCR$0"),
        "academic_group": field_text(soup, "ACAD_GROUP_TBL_DESCR$0"),
        "academic_organization": field_text(soup, "ACAD_ORG_TBL_DESCR$0"),
        "scheduling_status": field_text(soup, "DERIVED_SAA_CRS_SSS_LONGCHAR_2$146$"),
        "description": field_text(soup, "SSR_CRSE_OFF_VW_DESCRLONG$0"),
        "prerequisite_related_text": prerequisite_mentions,
        # The whole page, always: SBC attributes and the required SBC grade live
        # here too, including on courses with no prerequisite to mention.
        "page_text": re.sub(r"\s+", " ", full_text).strip(),
        "source_file": path.name,
        "source_page": "SSS_CRSE_OFFER_DTL",
    }


def write_json(data: Any, output: Path | None) -> None:
    rendered = json.dumps(data, ensure_ascii=False, indent=2)
    if output:
        output.write_text(rendered + "\n", encoding="utf-8")
        print(f"Wrote {output} ({len(data) if isinstance(data, list) else 1} record(s))")
    else:
        print(rendered)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=["index", "detail"], help="Type of saved PeopleSoft response")
    parser.add_argument("input", type=Path, help="Path to saved XML response")
    parser.add_argument("-o", "--output", type=Path, help="Output JSON file (default: stdout)")
    args = parser.parse_args()
    try:
        data = parse_index(args.input) if args.kind == "index" else parse_detail(args.input)
        write_json(data, args.output)
    except (OSError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
