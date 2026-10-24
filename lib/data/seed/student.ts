/**
 * DEMO SEED DATA — A FICTIONAL STUDENT.
 *
 * This record does not belong to a real person. It stands in for a parsed
 * transcript until the upload flow exists. It follows the real Fall 2026
 * Computer Science BS, and includes a C- in AMS 310 on purpose: the major
 * requires C or higher there, and CSE prerequisites require C or higher, so
 * the audit and planner have a realistic problem to surface.
 *
 * Like a real transcript, attempts carry printed titles, credits, and SBC
 * attributes where the scraped course catalog lacks them (ARH 101 and HIS 104
 * are missing from it; WST 102 has no tags there).
 */
import type { StudentRecord } from "@/lib/domain/types";

export const seedStudent: StudentRecord = {
  id: "demo-student",
  name: "Alex Rivera",
  entryTerm: "2024-FA",
  currentTerm: "2026-FA",
  programIds: ["cse-bs"],
  plan: [],
  attempts: [
    // AP credit
    { code: "MAT 131", source: "ap", grade: "T", status: "completed", origin: "AP Calculus BC" },
    { code: "MAT 132", source: "ap", grade: "T", status: "completed", origin: "AP Calculus BC" },
    { code: "WRT 101", source: "ap", grade: "T", status: "completed", origin: "AP English Language" },

    // Fall 2024
    { code: "CSE 114", source: "sbu", term: "2024-FA", grade: "A-", status: "completed" },
    { code: "WRT 102", source: "sbu", term: "2024-FA", grade: "A", status: "completed" },
    { code: "PHY 131", source: "sbu", term: "2024-FA", grade: "B", status: "completed" },
    { code: "PHY 133", source: "sbu", term: "2024-FA", grade: "A", status: "completed" },
    { code: "ECO 108", source: "sbu", term: "2024-FA", grade: "B", status: "completed" },

    // Spring 2025
    { code: "CSE 113", source: "sbu", term: "2025-SP", grade: "A-", status: "completed" },
    { code: "CSE 214", source: "sbu", term: "2025-SP", grade: "B+", status: "completed" },
    { code: "AMS 210", source: "sbu", term: "2025-SP", grade: "B+", status: "completed" },
    { code: "ARH 101", source: "sbu", term: "2025-SP", grade: "A", status: "completed", credits: 3, title: "Art in Culture", sbc: ["ARTS"] },

    // Summer 2025 — transfer
    { code: "PSY 103", source: "transfer", term: "2025-SU", grade: "T", status: "completed", origin: "Community college (demo)" },

    // Fall 2025
    { code: "CSE 213", source: "sbu", term: "2025-FA", grade: "B", status: "completed" },
    { code: "CSE 220", source: "sbu", term: "2025-FA", grade: "B+", status: "completed" },
    { code: "AMS 310", source: "sbu", term: "2025-FA", grade: "C-", status: "completed" },
    { code: "HIS 104", source: "sbu", term: "2025-FA", grade: "B+", status: "completed", credits: 3, title: "United States since 1877", sbc: ["SBS", "USA"] },
    { code: "EGL 121", source: "sbu", term: "2025-FA", grade: "A", status: "completed" },

    // Spring 2026
    { code: "CSE 307", source: "sbu", term: "2026-SP", grade: "B", status: "completed" },
    { code: "CSE 316", source: "sbu", term: "2026-SP", grade: "A-", status: "completed" },
    { code: "CSE 320", source: "sbu", term: "2026-SP", grade: "C+", status: "completed" },
    { code: "CSE 300", source: "sbu", term: "2026-SP", grade: "A", status: "completed" },
    { code: "AST 203", source: "sbu", term: "2026-SP", grade: "B+", status: "completed" },

    // Fall 2026 — in progress
    { code: "CSE 373", source: "sbu", term: "2026-FA", status: "in-progress" },
    { code: "CSE 312", source: "sbu", term: "2026-FA", status: "in-progress" },
    { code: "CSE 310", source: "sbu", term: "2026-FA", status: "in-progress" },
    { code: "CSE 323", source: "sbu", term: "2026-FA", status: "in-progress" },
    { code: "WST 102", source: "sbu", term: "2026-FA", status: "in-progress", title: "Introduction to Women's and Gender Studies", sbc: ["SBS", "DIV"] },
  ],
};
