#!/usr/bin/env python3
"""UI-driven scraper for Stony Brook's public PeopleSoft course catalog.

Uses Playwright to interact with the ordinary public catalog page. It does not
call undocumented endpoints, bypass access controls, or reuse saved session tokens.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
import zipfile
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bs4 import BeautifulSoup
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from parse_people_soft import parse_detail, parse_index

CATALOG_URL = (
    "https://prod.ps.stonybrook.edu/psc/csprodg/EMPLOYEE/CAMP/"
    "c/COMMUNITY_ACCESS.SSS_BROWSE_CATLG.GBL"
)
ALPHABET_PREFIX = "DERIVED_SSS_BCC_SSR_ALPHANUM_"
EXPAND_PREFIX = "DERIVED_SSS_BCC_SSS_EXPAND_ALL"
RETURN_PREFIX = "DERIVED_SAA_CRS_RETURN_PB"
LETTERS_DEFAULT = "A-Z-0-9"


def normalized(text: str | None) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def page_course_records(html: str, source_name: str) -> list[dict[str, Any]]:
    """Extract index records and the currently rendered detail-link ID."""
    soup = BeautifulSoup(html, "html.parser")
    subjects: dict[str, str] = {}
    # Match the group heading container and/or its clickable anchor. PeopleSoft
    # renders both IDs, and minor markup differences occur between responses.
    for node in soup.find_all(id=re.compile(r"(?:win0div)?DERIVED_SSS_BCC_GROUP_BOX_1\$147\$\$(\d+)$")):
        m = re.search(r"\$\$(\d+)$", node.get("id", ""))
        label = normalized(node.get_text(" ", strip=True))
        if m and label:
            subjects[m.group(1)] = label.split(" - ", 1)[0].strip()

    records: list[dict[str, Any]] = []
    for row in soup.select('tr[id^="trCOURSE_LIST$"]'):
        m = re.match(r"trCOURSE_LIST\$(\d+)_row\d+$", row.get("id", ""))
        if not m:
            continue
        group_index = m.group(1)
        # The clickable anchors are nested inside spans with similar IDs.
        number_node = row.select_one('a[id^="CRSE_NBR$"]') or row.select_one('[id^="CRSE_NBR$"]')
        title_node = row.select_one('a[id^="CRSE_TITLE$"]') or row.select_one('[id^="CRSE_TITLE$"]')
        number = normalized(number_node.get_text(" ", strip=True) if number_node else None)
        title = normalized(title_node.get_text(" ", strip=True) if title_node else None)
        if not number or not title:
            continue
        subject = subjects.get(group_index)
        records.append({
            "subject": subject,
            "course_number": number,
            "course_code": f"{subject} {number}" if subject else None,
            "title": title,
            "source_file": source_name,
            "source_group_index": int(group_index),
            "_detail_link_id": title_node.get("id") if title_node else None,
        })
    unique: dict[tuple[str | None, str, str], dict[str, Any]] = {}
    for record in records:
        unique.setdefault((record["subject"], record["course_number"], record["title"]), record)
    return list(unique.values())


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def safe_filename(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", value).strip("._")[:120] or "course"


def existing_detail_keys(jsonl_path: Path) -> set[tuple[str, str]]:
    found: set[tuple[str, str]] = set()
    if not jsonl_path.exists():
        return found
    with jsonl_path.open(encoding="utf-8") as stream:
        for line in stream:
            try:
                item = json.loads(line)
                found.add((normalized(item.get("catalog_course_code") or item.get("course_code")), normalized(item.get("catalog_title") or item.get("title"))))
            except (json.JSONDecodeError, AttributeError):
                continue
    return found

def upsert_jsonl(path: Path, item: dict[str, Any], key_fields: tuple[str, ...]) -> None:
    """Replace a matching JSONL record instead of accumulating duplicate course rows."""
    rows = read_jsonl(path)
    wanted = tuple(normalized(item.get(k)) for k in key_fields)
    replaced = False
    output: list[dict[str, Any]] = []
    for row in rows:
        row_key = tuple(normalized(row.get(k)) for k in key_fields)
        if row_key == wanted:
            if not replaced:
                output.append(item)
                replaced = True
        else:
            output.append(row)
    if not replaced:
        output.append(item)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as stream:
        for row in output:
            stream.write(json.dumps(row, ensure_ascii=False) + "\n")


def write_index(index_path: Path, records: list[dict[str, Any]]) -> None:
    clean = [{k: v for k, v in r.items() if not k.startswith("_")} for r in records]
    save_json(index_path, clean)


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not path.exists():
        return rows
    with path.open(encoding="utf-8") as stream:
        for line in stream:
            try:
                item = json.loads(line)
                if isinstance(item, dict):
                    rows.append(item)
            except json.JSONDecodeError:
                continue
    return rows


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    """Write a CSV using the union of fields, JSON-encoding nested values."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fields: list[str] = []
    seen: set[str] = set()
    for row in rows:
        for key in row:
            if key not in seen:
                seen.add(key)
                fields.append(key)
    with path.open("w", newline="", encoding="utf-8-sig") as stream:
        if not fields:
            stream.write("\n")
            return
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({
                key: json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else value
                for key, value in row.items()
            })


def export_everything(out_dir: Path, args: argparse.Namespace, processed_codes: list[str]) -> None:
    """Create normalized JSON/CSV exports and a ZIP bundle of all collected files."""
    index_rows = []
    index_path = out_dir / "course-index.json"
    if index_path.exists():
        try:
            index_rows = json.loads(index_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            index_rows = []
    detail_rows = read_jsonl(out_dir / "course-details.jsonl")
    section_rows = read_jsonl(out_dir / "course-sections.jsonl")

    save_json(out_dir / "course-details.json", detail_rows)
    save_json(out_dir / "course-sections.json", section_rows)
    write_csv(out_dir / "course-index.csv", index_rows)
    write_csv(out_dir / "course-details.csv", detail_rows)
    write_csv(out_dir / "course-sections.csv", section_rows)

    summary = {
        "exported_at_utc": datetime.now(timezone.utc).isoformat(),
        "catalog_url": args.url,
        "letters_processed_this_run": processed_codes,
        "course_index_records": len(index_rows),
        "course_detail_records": len(detail_rows),
        "class_section_records": len(section_rows),
        "sections_term": args.sections_term or None,
        "files": [
            "course-index.json", "course-index.csv",
            "course-details.jsonl", "course-details.json", "course-details.csv",
            "course-sections.jsonl", "course-sections.json", "course-sections.csv",
            "index/", "raw/",
        ],
        "warning": "Review run logs for skipped letters/courses and validate the raw captures before treating this export as complete."
    }
    save_json(out_dir / "export-summary.json", summary)

    zip_path = out_dir / "semesteros-export.zip"
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file_path in sorted(out_dir.rglob("*")):
            if not file_path.is_file() or file_path == zip_path:
                continue
            archive.write(file_path, file_path.relative_to(out_dir))
    print(f"Exported index: {len(index_rows)} records (JSON + CSV)")
    print(f"Exported details: {len(detail_rows)} records (JSONL + JSON + CSV)")
    print(f"Exported sections: {len(section_rows)} records (JSONL + JSON + CSV)")
    print(f"Complete bundle: {zip_path}")


def click_if_present(page, selector: str, timeout: int = 10000) -> bool:
    locator = page.locator(selector).first
    try:
        locator.wait_for(state="visible", timeout=timeout)
        locator.click(timeout=timeout)
        page.wait_for_timeout(900)
        return True
    except PlaywrightTimeoutError:
        return False


def expand_letter_once(page, letter: str) -> str:
    """Select a letter and expand all subject groups. Returns "rows", "empty", or "failed"."""
    letter_link = page.locator(f'[id="{ALPHABET_PREFIX}{letter}"]').first
    try:
        letter_link.wait_for(state="visible", timeout=6000)
        run_postback(page, lambda: letter_link.click(timeout=10000))
        expand_button = page.locator(f'input[id^="{EXPAND_PREFIX}"]').first
        if expand_button.count() == 0:
            # No Expand All control: the letter has no subject groups at all.
            return "empty"
        # Subject groups start collapsed after switching letters; expand them.
        if not run_postback(page, lambda: expand_button.click(timeout=10000), timeout=30000):
            return "failed"
    except PlaywrightTimeoutError:
        return "failed"
    return "rows" if page.locator('tr[id^="trCOURSE_LIST$"]').count() else "failed"


def ensure_letter_expanded(page, letter: str, raw_index_dir: Path) -> list[dict[str, Any]]:
    """Select a letter and expand all subject groups, then persist the rendered HTML.

    A letter that has subject groups but shows no course rows is retried once
    from a fresh catalog page; that's how a whole letter (H) went missing before.
    """
    outcome = expand_letter_once(page, letter)
    if outcome == "failed":
        print(f"  [{letter}] No course rows after Expand All; reloading the catalog and retrying once.")
        page.goto(CATALOG_URL, wait_until="domcontentloaded", timeout=60000)
        page.locator(f'[id="{ALPHABET_PREFIX}{letter}"]').wait_for(state="visible", timeout=30000)
        outcome = expand_letter_once(page, letter)
    if outcome != "rows":
        print(f"  [{letter}] {'Letter has no subject groups.' if outcome == 'empty' else 'FAILED: still no course rows after a retry.'}")
        # Save the response for diagnosis rather than silently pretending
        # this letter was successfully scraped.
        raw_path = raw_index_dir / f"index_{letter}_{outcome}.html"
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        raw_path.write_text(page.content(), encoding="utf-8")
        return []

    html = page.content()
    raw_path = raw_index_dir / f"index_{letter}.html"
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    raw_path.write_text(html, encoding="utf-8")
    records = page_course_records(html, raw_path.name)
    print(f"  [{letter}] Found {len(records)} course entries.")
    return records


def find_current_detail_link(page, wanted: dict[str, Any]) -> str | None:
    """Resolve the live link ID for a course by subject, number, and title."""
    current = page_course_records(page.content(), "live-page")
    for record in current:
        if (record.get("subject"), record.get("course_number"), record.get("title")) == (
            wanted.get("subject"), wanted.get("course_number"), wanted.get("title")
        ):
            return record.get("_detail_link_id")
    return None


def ensure_course_list(page, letter: str, wanted: dict[str, Any], raw_index_dir: Path) -> str | None:
    """After returning from a detail page, restore the relevant list if needed."""
    link_id = find_current_detail_link(page, wanted)
    if link_id:
        return link_id
    print(f"    Restoring the {letter} subject list…")
    records = ensure_letter_expanded(page, letter, raw_index_dir)
    if not records:
        return None
    return find_current_detail_link(page, wanted)



def term_from_dates(dates: str | None, fallback: str) -> str:
    """Real term from a meeting's start date ("07/06/2026 - ..." -> "Summer 2026").

    PeopleSoft returns sections from every open term regardless of the term
    selected, so the requested term can't be trusted as the label.
    Jan-Apr -> Spring, May-Jul -> Summer, Aug-Dec -> Fall.
    """
    match = re.match(r"\s*(\d{2})/\d{2}/(\d{4})", dates or "")
    if not match:
        return fallback
    month, year = int(match.group(1)), match.group(2)
    season = "Spring" if month <= 4 else "Summer" if month <= 7 else "Fall"
    return f"{season} {year}"


def parse_class_sections(html: str, term: str) -> list[dict[str, Any]]:
    """Parse the visible PeopleSoft class-section and meeting-pattern grids."""
    fields = re.findall(r"<FIELD\b[^>]*><!\[CDATA\[(.*?)\]\]></FIELD>", html, re.I | re.S)
    markup = "\n".join(fields) if fields else html
    soup = BeautifulSoup(markup, "html.parser")

    def value(element_id: str) -> str | None:
        node = soup.find(id=element_id)
        if not node:
            return None
        text = normalized(node.get_text(" ", strip=True))
        return text or None

    sections: list[dict[str, Any]] = []
    for link in soup.find_all("a", id=re.compile(r"^CLASS_SECTION\$\d+$")):
        match = re.search(r"\$(\d+)$", link.get("id", ""))
        if not match:
            continue
        idx = match.group(1)
        label = normalized(link.get_text(" ", strip=True))
        class_number_match = re.search(r"\((\d+)\)\s*$", label)
        section_label = re.sub(r"\s*\(\d+\)\s*$", "", label).strip()
        status_node = soup.find(id=f"CLASS_STATUS${idx}")
        status = None
        if status_node:
            status = normalized(status_node.get_text(" ", strip=True)) or None
            if not status:
                image = status_node.find("img")
                if image:
                    status = image.get("alt") or image.get("title")
                    if not status and image.get("src"):
                        icon_name = image["src"].rsplit("/", 1)[-1]
                        status_match = re.search(r"STATUS_([A-Z]+)_ICN", icon_name)
                        if status_match:
                            status = status_match.group(1).title()

        meeting = {
            "days": value(f"MTGPAT_DAYS${idx}"),
            "start": value(f"MTGPAT_START${idx}"),
            "end": value(f"MTGPAT_END${idx}"),
            "room": value(f"MTGPAT_ROOM${idx}"),
            "instructor": value(f"MTGPAT_INSTR${idx}"),
            "dates": value(f"MTGPAT_DATES${idx}"),
        }
        meetings = [meeting] if any(meeting.values()) else []
        sections.append({
            "term": term_from_dates(meeting["dates"], term),
            "requested_term": term,
            "section": section_label,
            "class_number": class_number_match.group(1) if class_number_match else None,
            "session": value(f"CLASS_SESSION${idx}"),
            "status": status,
            "meetings": meetings,
        })
    return sections


def run_postback(page, action, timeout: int = 20000) -> bool:
    """Run a UI action that submits the PeopleSoft form, and wait for the server's reply.

    Every PeopleSoft control posts the page back to the server. Waiting for that
    response, instead of for an element, avoids two failure modes: reading the
    previous grid while the new one is still loading, and sleeping on a fixed
    timeout when the result is legitimately empty. Returns False if no response
    arrived in time.
    """
    try:
        with page.expect_response(lambda r: r.request.method == "POST", timeout=timeout):
            action()
    except PlaywrightTimeoutError:
        return False
    # The response is applied to the DOM by script right after it arrives.
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(250)
    return True


def wanted_terms(spec: str) -> set[str] | None:
    """--sections-term value -> set of normalized term labels, or None for every listed term."""
    if normalized(spec).casefold() == "all":
        return None
    return {normalized(t).casefold() for t in spec.split(",") if normalized(t)}


def capture_term(page, option: dict[str, Any], raw_detail_dir: Path, slug: str) -> tuple[list[dict[str, Any]], str]:
    """Select one term in the class-sections view and capture its grid."""
    label = normalized(option.get("label"))
    term_select = page.locator('select[id="DERIVED_SAA_CRS_TERM_ALT"]').first
    show_button = page.get_by_role("button", name="Show Sections").first
    sections: list[dict[str, Any]] = []
    status = "ok"
    # Seasons the date check understands; a "Winter" term's dates fall in Fall or Spring.
    checkable = label.split(" ")[0] in {"Spring", "Summer", "Fall"}
    for attempt in (1, 2):
        if term_select.input_value() != option["value"]:
            # Changing the term may post back on its own; wait briefly for that, then carry on.
            run_postback(page, lambda: term_select.select_option(value=option["value"]), timeout=5000)
        if not run_postback(page, lambda: show_button.click(timeout=12000)):
            raise PlaywrightTimeoutError(f"no server response after Show Sections for {label}")
        html = page.content()
        sections = parse_class_sections(html, label)
        # PeopleSoft can still show the previous term's grid; the meeting dates say which term it is.
        if not sections or not checkable or any(normalized(s["term"]).casefold() == label.casefold() for s in sections):
            status = "ok" if sections else "none"
            break
        status = "term-mismatch"
        print(f"      {label}: grid shows {sorted({s['term'] for s in sections})}; {'retrying' if attempt == 1 else 'keeping it, labeled by dates'}.")
    raw_path = raw_detail_dir / f"{slug}_sections_{safe_filename(label)}.html"
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    raw_path.write_text(html, encoding="utf-8")
    for section in sections:
        section["raw_sections_file"] = str(raw_path.relative_to(raw_detail_dir.parent.parent))
    print(f"      {label}: found {len(sections)} class sections.")
    return sections, status


def scrape_class_sections(page, term_spec: str, raw_detail_dir: Path, slug: str) -> tuple[list[dict[str, Any]], str]:
    """Open View Class Sections and capture the requested terms ("all" = every listed term).

    Returns the sections and a status: "ok", "none" (the term lists no sections),
    "no-sections-button" (the course has no View Class Sections button),
    "term-unavailable", or "term-mismatch" (PeopleSoft kept showing another term).
    """
    # The detail page is fully loaded by now, so a missing button means the course
    # has no sections at all. Check immediately instead of waiting for it to appear.
    view_button = page.locator('input[id="DERIVED_SAA_CRS_SSR_PB_GO"]')
    if view_button.count() == 0:
        print("      No View Class Sections button; course has no sections.")
        return [], "no-sections-button"
    if not run_postback(page, lambda: view_button.first.click(timeout=12000)):
        raise PlaywrightTimeoutError("no server response after View Class Sections")

    term_select = page.locator('select[id="DERIVED_SAA_CRS_TERM_ALT"]').first
    term_select.wait_for(state="visible", timeout=15000)
    # PeopleSoft only lists terms available for the current course.
    options = term_select.locator("option").evaluate_all(
        "els => els.map(el => ({label: (el.label || el.textContent || '').trim(), value: el.value, disabled: el.disabled}))"
    )
    wanted = wanted_terms(term_spec)
    targets = [
        o for o in options
        if normalized(o.get("label")) and o.get("value") and not o.get("disabled")
        and (wanted is None or normalized(o.get("label")).casefold() in wanted)
    ]
    if not targets:
        available = [normalized(o.get("label")) for o in options if normalized(o.get("label"))]
        print(f"      {term_spec}: not listed for this course. Available terms: {', '.join(available) or '(none shown)'}")
        raw_path = raw_detail_dir / f"{slug}_sections_{safe_filename(term_spec)}_term-unavailable.html"
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        raw_path.write_text(page.content(), encoding="utf-8")
        return [], "term-unavailable"

    sections: list[dict[str, Any]] = []
    statuses: list[str] = []
    for option in targets:
        found, status = capture_term(page, option, raw_detail_dir, slug)
        sections.extend(found)
        statuses.append(status)
    # Report the worst outcome across terms.
    for status in ("term-mismatch", "ok", "none"):
        if status in statuses:
            return sections, status
    return sections, "ok"


def _merge_jsonl_files(paths: list[Path], destination: Path, key_fields: tuple[str, ...]) -> None:
    """Merge JSONL inputs by stable keys, keeping the latest occurrence."""
    merged: dict[tuple[str, ...], dict[str, Any]] = {}
    order: list[tuple[str, ...]] = []
    for path in paths:
        for row in read_jsonl(path):
            key = tuple(normalized(row.get(field)) for field in key_fields)
            if key not in merged:
                order.append(key)
            merged[key] = row
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8") as stream:
        for key in order:
            stream.write(json.dumps(merged[key], ensure_ascii=False) + "\n")


def scrape_parallel(args: argparse.Namespace, letters: list[str]) -> int:
    """Run isolated browser sessions for disjoint groups, then merge their outputs."""
    out_dir = args.output.resolve()
    workers_root = out_dir / ".workers"
    logs_dir = out_dir / "logs"
    workers_root.mkdir(parents=True, exist_ok=True)
    logs_dir.mkdir(parents=True, exist_ok=True)
    worker_count = min(args.workers, len(letters))
    assignments = [letters[i::worker_count] for i in range(worker_count)]
    script_path = Path(__file__).resolve()

    # Seed each isolated worker with prior detail/section records so resume behavior
    # remains useful without allowing workers to write to the same files.
    prior_details = out_dir / "course-details.jsonl"
    prior_sections = out_dir / "course-sections.jsonl"
    jobs: list[tuple[int, list[str], Path, Path]] = []
    for idx, group_letters in enumerate(assignments, start=1):
        worker_dir = workers_root / f"worker_{idx:02d}"
        if worker_dir.exists():
            shutil.rmtree(worker_dir)
        worker_dir.mkdir(parents=True, exist_ok=True)
        if args.resume:
            for source in (prior_details, prior_sections):
                if source.exists():
                    shutil.copy2(source, worker_dir / source.name)
        log_path = logs_dir / f"worker_{idx:02d}.log"
        jobs.append((idx, group_letters, worker_dir, log_path))

    def run_job(job: tuple[int, list[str], Path, Path]) -> tuple[int, int, Path]:
        idx, group_letters, worker_dir, log_path = job
        cmd = [
            sys.executable, str(script_path),
            "--url", args.url,
            "--output", str(worker_dir),
            "--letters", ",".join(group_letters),
            "--workers", "1",
            "--delay-ms", str(args.delay_ms),
            "--pause-every", str(args.pause_every),
            "--pause-seconds", str(args.pause_seconds),
        ]
        if args.index_only:
            cmd.append("--index-only")
        if args.courses:
            cmd.extend(["--courses", args.courses])
        if args.sections_term:
            cmd.extend(["--sections-term", args.sections_term])
        if args.headless:
            cmd.append("--headless")
        if not args.resume:
            cmd.append("--no-resume")
        with log_path.open("w", encoding="utf-8") as log:
            log.write(f"Worker {idx} groups: {', '.join(group_letters)}\nCommand: {' '.join(cmd)}\n\n")
            log.flush()
            result = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, text=True)
        return idx, result.returncode, log_path

    print(f"Starting {worker_count} isolated browser workers (requested {args.workers}).")
    print("Each worker gets separate PeopleSoft session state; output will be merged after completion.")
    results: list[tuple[int, int, Path]] = []
    from concurrent.futures import ThreadPoolExecutor, as_completed
    with ThreadPoolExecutor(max_workers=worker_count) as pool:
        futures = [pool.submit(run_job, job) for job in jobs]
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            idx, code, log_path = result
            print(f"  Worker {idx}: {'finished' if code == 0 else f'exited with code {code}'} — log: {log_path}")

    # Merge each worker's partial indexes and deduplicate detail/section records.
    index_records: dict[tuple[str, str, str], dict[str, Any]] = {}
    detail_paths: list[Path] = []
    section_paths: list[Path] = []
    for idx, group_letters, worker_dir, log_path in jobs:
        index_path = worker_dir / "course-index.json"
        if index_path.exists():
            try:
                for row in json.loads(index_path.read_text(encoding="utf-8")):
                    key = (normalized(row.get("subject")), normalized(row.get("course_number")), normalized(row.get("title")))
                    index_records[key] = row
            except (json.JSONDecodeError, OSError):
                print(f"WARNING: Could not read worker {idx} course index.")
        detail_paths.append(worker_dir / "course-details.jsonl")
        section_paths.append(worker_dir / "course-sections.jsonl")
        for subdir in ("index", "raw"):
            source_dir = worker_dir / subdir
            if source_dir.exists():
                for source in source_dir.rglob("*"):
                    if not source.is_file():
                        continue
                    relative = source.relative_to(worker_dir)
                    target = out_dir / relative
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, target)

    save_json(out_dir / "course-index.json", list(index_records.values()))
    _merge_jsonl_files(detail_paths, out_dir / "course-details.jsonl", ("catalog_course_code", "catalog_title"))
    _merge_jsonl_files(section_paths, out_dir / "course-sections.jsonl", ("course_code", "term", "class_number", "section"))
    # Worker directories contain intermediate copies and nested exports; keep the
    # human-readable logs but remove intermediates before building the final ZIP.
    shutil.rmtree(workers_root, ignore_errors=True)
    export_everything(out_dir, args, letters)
    failed = [r for r in results if r[1] != 0]
    if failed:
        print(f"WARNING: {len(failed)} worker(s) failed. Inspect logs in {logs_dir}; partial data was merged.")
        return 1
    print("Parallel scrape finished. Review logs for skipped groups or course-level errors.")
    return 0


def scrape(args: argparse.Namespace) -> int:
    out_dir = args.output.resolve()
    raw_index_dir = out_dir / "raw" / "index"
    raw_detail_dir = out_dir / "raw" / "details"
    index_dir = out_dir / "index"
    detail_jsonl = out_dir / "course-details.jsonl"
    sections_jsonl = out_dir / "course-sections.jsonl"
    out_dir.mkdir(parents=True, exist_ok=True)
    done = existing_detail_keys(detail_jsonl) if args.resume else set()
    completed_section_terms: set[tuple[str, str]] = set()
    if args.resume and args.sections_term:
        for old_record in read_jsonl(detail_jsonl):
            old_code = normalized(old_record.get("catalog_course_code") or old_record.get("course_code"))
            # Records from before statuses existed only count if they captured sections;
            # their empty lists mix "no sections" with timeouts, so those get another try.
            status = old_record.get("class_sections_status")
            finished = status not in (None, "error") or bool(old_record.get("class_sections"))
            if old_code and finished and normalized(old_record.get("class_sections_term")) == normalized(args.sections_term):
                completed_section_terms.add((old_code, normalized(args.sections_term)))

    only_courses = {normalized(c).upper() for c in args.courses.split(",") if normalized(c)}
    if only_courses and args.letters == LETTERS_DEFAULT:
        # Visit only the letters those courses live under.
        args.letters = ",".join(sorted({c[0] for c in only_courses}))
    requested = [x.strip().upper() for x in args.letters.split(",") if x.strip()]
    if len(requested) == 1 and requested[0] in {"A-Z", "A-Z-0-9", "ALL", "ALPHANUMERIC"}:
        # PeopleSoft's selector includes alphabetic groups followed by numeric groups.
        letters = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
    elif len(requested) == 1 and requested[0] == "0-9":
        letters = list("0123456789")
    elif len(requested) == 1 and requested[0] == "A-Z":
        letters = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
    else:
        letters = requested
    invalid = [x for x in letters if len(x) != 1 or not x.isalnum()]
    if invalid:
        print(f"Invalid letter(s): {', '.join(invalid)}", file=sys.stderr)
        return 2
    if args.workers > 1:
        if args.max_details:
            print("--max-details is a single-worker test option; omit it for parallel full runs.", file=sys.stderr)
            return 2
        return scrape_parallel(args, letters)

    total_details = 0
    processed_codes: list[str] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=args.headless)
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        page.set_default_timeout(15000)
        print(f"Opening public catalog: {CATALOG_URL}")
        page.goto(CATALOG_URL, wait_until="domcontentloaded", timeout=60000)
        try:
            page.locator(f'[id="{ALPHABET_PREFIX}A"]').wait_for(state="visible", timeout=30000)
        except PlaywrightTimeoutError:
            page.screenshot(path=str(out_dir / "catalog-open-failed.png"), full_page=True)
            print("Could not find the catalog's alphabet controls.", file=sys.stderr)
            print(f"Current URL: {page.url}", file=sys.stderr)
            print(f"A screenshot was saved to {out_dir / 'catalog-open-failed.png'}", file=sys.stderr)
            browser.close()
            return 1

        all_index: dict[tuple[str | None, str, str], dict[str, Any]] = {}
        for letter in letters:
            processed_codes.append(letter)
            print(f"\nProcessing subject-code group {letter}…")
            records = ensure_letter_expanded(page, letter, raw_index_dir)
            # Save an explicit empty index for letters/digits with no catalog entries.
            clean_records = [{k: v for k, v in r.items() if not k.startswith("_")} for r in records]
            save_json(index_dir / f"index_{letter}.json", clean_records)
            if not records:
                write_index(out_dir / "course-index.json", list(all_index.values()))
                continue
            for record in records:
                key = (record.get("subject"), record.get("course_number"), record.get("title"))
                all_index.setdefault(key, record)
            write_index(out_dir / "course-index.json", list(all_index.values()))

            if args.index_only:
                continue

            for position, wanted in enumerate(records, start=1):
                if args.max_details and total_details >= args.max_details:
                    print(f"\nReached --max-details={args.max_details}; stopping after test run.")
                    browser.close()
                    export_everything(out_dir, args, processed_codes)
                    return 0
                if only_courses and normalized(wanted.get("course_code")).upper() not in only_courses:
                    continue
                key = (normalized(wanted.get("course_code")), normalized(wanted.get("title")))
                if args.resume and key in done and not only_courses:
                    if not args.sections_term or (normalized(wanted.get("course_code")), normalized(args.sections_term)) in completed_section_terms:
                        continue

                link_id = ensure_course_list(page, letter, wanted, raw_index_dir)
                if not link_id:
                    print(f"    SKIP: Could not locate {wanted.get('course_code')} — {wanted.get('title')}")
                    continue
                print(f"    [{position}/{len(records)}] Opening {wanted.get('course_code')} — {wanted.get('title')}")
                try:
                    page.locator(f'[id="{link_id}"]').click(timeout=15000)
                    page.locator(f'[id^="{RETURN_PREFIX}"]').first.wait_for(state="visible", timeout=20000)
                    page.wait_for_timeout(args.delay_ms)
                    html = page.content()
                    code = wanted.get("course_code") or f"{wanted.get('subject')}-{wanted.get('course_number')}"
                    slug = safe_filename(f"{code}_{wanted.get('title', '')}")
                    raw_detail_path = raw_detail_dir / f"{slug}.html"
                    raw_detail_path.parent.mkdir(parents=True, exist_ok=True)
                    raw_detail_path.write_text(html, encoding="utf-8")
                    parsed = parse_detail(raw_detail_path)
                    parsed["catalog_subject"] = wanted.get("subject")
                    parsed["catalog_course_number"] = wanted.get("course_number")
                    parsed["catalog_course_code"] = wanted.get("course_code")
                    parsed["catalog_title"] = wanted.get("title")
                    parsed["raw_detail_file"] = str(raw_detail_path.relative_to(out_dir))
                    section_status = None
                    if args.sections_term:
                        parsed["class_sections_term"] = args.sections_term
                        try:
                            sections, section_status = scrape_class_sections(page, args.sections_term, raw_detail_dir, slug)
                            parsed["class_sections"] = sections
                            for section in sections:
                                section["course_code"] = wanted.get("course_code")
                                section["course_title"] = wanted.get("title")
                                upsert_jsonl(sections_jsonl, section, ("course_code", "term", "class_number", "section"))
                        except (PlaywrightTimeoutError, ValueError) as section_exc:
                            print(f"      WARNING: Could not collect {args.sections_term} sections: {section_exc}")
                            parsed["class_sections"] = []
                            section_status = "error"
                        parsed["class_sections_status"] = section_status
                    upsert_jsonl(detail_jsonl, parsed, ("catalog_course_code", "catalog_title"))
                    done.add((normalized(parsed.get("catalog_course_code") or parsed.get("course_code")), normalized(parsed.get("catalog_title") or parsed.get("title"))))
                    if args.sections_term and section_status != "error":
                        completed_section_terms.add((normalized(parsed.get("catalog_course_code") or parsed.get("course_code")), normalized(args.sections_term)))
                    total_details += 1
                except PlaywrightTimeoutError as exc:
                    print(f"    ERROR: Timed out opening detail for {wanted.get('course_code')}: {exc}")
                    page.screenshot(path=str(out_dir / f"timeout-{safe_filename(wanted.get('course_code') or 'course')}.png"))
                    # Don't attempt a return click if the detail page never loaded.
                    if not page.locator(f'[id^="{RETURN_PREFIX}"]').count():
                        continue
                finally:
                    if page.locator(f'[id^="{RETURN_PREFIX}"]').count():
                        try:
                            page.locator(f'[id^="{RETURN_PREFIX}"]').first.click(timeout=12000)
                            page.wait_for_timeout(args.delay_ms)
                            page.locator(f'[id="{ALPHABET_PREFIX}{letter}"]').wait_for(state="visible", timeout=15000)
                        except PlaywrightTimeoutError:
                            print("    WARNING: Return-to-catalog action timed out; attempting to reload catalog.")
                            page.goto(CATALOG_URL, wait_until="domcontentloaded", timeout=60000)
                            page.locator(f'[id="{ALPHABET_PREFIX}{letter}"]').wait_for(state="visible", timeout=30000)
                if args.pause_every and total_details and total_details % args.pause_every == 0:
                    print(f"    Pausing {args.pause_seconds}s after {total_details} detail pages…")
                    time.sleep(args.pause_seconds)

        browser.close()

    export_everything(out_dir, args, processed_codes)
    print("\nFinished.")
    print(f"Index: {out_dir / 'course-index.json'}")
    print(f"Details: {detail_jsonl}")
    if args.sections_term:
        print(f"Class sections: {sections_jsonl}")
    print(f"Raw HTML: {out_dir / 'raw'}")
    print(f"CSV exports: {out_dir / 'course-index.csv'}, {out_dir / 'course-details.csv'}, {out_dir / 'course-sections.csv'}")
    print(f"ZIP export: {out_dir / 'semesteros-export.zip'}")
    print("Note: check the run log for skipped or timed-out courses before treating the data as complete.")
    return 0


def main() -> int:
    global CATALOG_URL
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=CATALOG_URL, help="Public PeopleSoft Browse Course Catalog URL")
    parser.add_argument("--output", type=Path, default=Path("semesteros-data"), help="Output directory")
    parser.add_argument("--letters", default=LETTERS_DEFAULT, help="A-Z-0-9 (default), A-Z, 0-9, or comma-separated individual groups")
    parser.add_argument("--courses", default="", help='Only open these courses, e.g. "CSE 214,HIS 101" (re-scrapes them even when resuming)')
    parser.add_argument("--max-details", type=int, default=0, help="Stop after this many detail pages (0 = no limit)")
    parser.add_argument("--workers", type=int, default=1, help="Independent browser workers (1 = sequential; try 4 first, up to 13). Parallel workers use separate sessions and merge outputs.")
    parser.add_argument("--index-only", action="store_true", help="Collect course lists only; do not open detail pages")
    parser.add_argument("--sections-term", default="", help='Also collect class sections: one term ("Spring 2027"), several ("Fall 2026,Spring 2027"), or "all" listed terms')
    parser.add_argument("--headless", action="store_true", help="Run browser invisibly (visible by default for debugging)")
    parser.add_argument("--no-resume", dest="resume", action="store_false", help="Do not skip details already in course-details.jsonl")
    parser.set_defaults(resume=True)
    parser.add_argument("--delay-ms", type=int, default=500, help="Wait after PeopleSoft actions (default: 500ms)")
    parser.add_argument("--pause-every", type=int, default=50, help="Pause after this many detail pages (default: 50; 0 disables)")
    parser.add_argument("--pause-seconds", type=int, default=5, help="Pause duration (default: 5 seconds)")
    args = parser.parse_args()
    if args.workers < 1 or args.workers > 13:
        parser.error("--workers must be between 1 and 13")
    # Keep --url customizable, including if the public catalog's route changes.
    CATALOG_URL = args.url
    try:
        return scrape(args)
    except KeyboardInterrupt:
        print("\nInterrupted. Progress files are saved; rerun with the same --output to resume.")
        return 130
    except Exception as exc:
        print(f"Scraper failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        print("Any completed index/detail records remain in the output directory.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
