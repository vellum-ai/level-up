/**
 * Unit tests for the pure path/result classification helpers.
 *
 * Run with: `bun test __tests__/detect.test.ts`
 */

import { describe, expect, test } from "bun:test";

import {
  classifyCapabilityPath,
  classifyManagedSkillTool,
  detectCapabilityEdit,
  findToolUse,
  resultLooksLikeNewFile,
} from "../src/detect.ts";
import { assistantToolCall, toolUseBlock, userText } from "./_helpers.ts";

import type { ToolUseContent } from "@vellumai/plugin-api";

describe("classifyCapabilityPath", () => {
  test("classifies a workspace-relative skill file", () => {
    // GIVEN a relative path into a skill directory
    const path = "skills/sanity/SKILL.md";

    // WHEN classified
    const ref = classifyCapabilityPath(path);

    // THEN it is recognized as the sanity skill's SKILL.md
    expect(ref).toEqual({ kind: "skill", name: "sanity", file: "SKILL.md" });
  });

  test("classifies an absolute plugin file with a nested path", () => {
    // GIVEN an absolute path into a plugin directory
    const path = "/home/user/.vellum/workspace/plugins/level-up/hooks/stop.ts";

    // WHEN classified
    const ref = classifyCapabilityPath(path);

    // THEN it is recognized as the level-up plugin with its relative file
    expect(ref).toEqual({
      kind: "plugin",
      name: "level-up",
      file: "hooks/stop.ts",
    });
  });

  test("normalizes Windows-style separators", () => {
    // GIVEN a path using backslashes
    const path = "skills\\sanity\\references\\api.md";

    // WHEN classified
    const ref = classifyCapabilityPath(path);

    // THEN separators are normalized and the file path is preserved
    expect(ref).toEqual({
      kind: "skill",
      name: "sanity",
      file: "references/api.md",
    });
  });

  test("ignores the per-plugin storage tree (plugins-data)", () => {
    // GIVEN a path into the sibling plugins-data storage directory
    const path = "plugins-data/level-up/entries.jsonl";

    // WHEN classified
    const ref = classifyCapabilityPath(path);

    // THEN it is not treated as a capability edit
    expect(ref).toBeNull();
  });

  test("ignores vendored node_modules inside a capability", () => {
    // GIVEN a path into a capability's vendored dependencies
    const path = "plugins/foo/node_modules/left-pad/index.js";

    // WHEN classified
    const ref = classifyCapabilityPath(path);

    // THEN it is not treated as authored capability content
    expect(ref).toBeNull();
  });

  test("ignores the skills catalog index and bare capability dirs", () => {
    // GIVEN the catalog index file (no file beneath a capability name)
    // WHEN classified
    // THEN there is no capability edit to report
    expect(classifyCapabilityPath("skills/SKILLS.md")).toBeNull();
    expect(classifyCapabilityPath("skills/sanity")).toBeNull();
  });

  test("ignores unrelated source files", () => {
    // GIVEN a path outside any skills/plugins tree
    const path = "assistant/src/agent/loop.ts";

    // WHEN classified
    const ref = classifyCapabilityPath(path);

    // THEN nothing matches
    expect(ref).toBeNull();
  });
});

describe("findToolUse", () => {
  test("returns the matching tool_use block, scanning newest-first", () => {
    // GIVEN a history with two tool calls sharing a tool name but distinct ids
    const messages = [
      userText("edit my skill"),
      assistantToolCall("call-1", "file_edit", { path: "skills/a/SKILL.md" }),
      assistantToolCall("call-2", "file_edit", { path: "skills/b/SKILL.md" }),
    ];

    // WHEN looking up the second call by id
    const found = findToolUse(messages, "call-2");

    // THEN the correct block is returned with its input intact
    expect(found?.id).toBe("call-2");
    expect(found?.input).toEqual({ path: "skills/b/SKILL.md" });
  });

  test("returns null when no block matches the id", () => {
    // GIVEN a history with no matching tool_use id
    const messages = [assistantToolCall("call-1", "file_edit", {})];

    // WHEN looking up a missing id
    const found = findToolUse(messages, "missing");

    // THEN null is returned
    expect(found).toBeNull();
  });
});

describe("classifyManagedSkillTool", () => {
  test("classifies a fresh scaffold_managed_skill call as a skill creation", () => {
    // GIVEN a scaffold call without overwrite
    // WHEN classified
    const edit = classifyManagedSkillTool("scaffold_managed_skill", {
      skill_id: "bam",
      name: "BAM",
    });

    // THEN it is the bam skill's SKILL.md, created
    expect(edit).toEqual({
      ref: { kind: "skill", name: "bam", file: "SKILL.md" },
      change: "created",
    });
  });

  test("treats an overwriting scaffold as an update", () => {
    // GIVEN a scaffold call with overwrite set
    // WHEN classified
    const edit = classifyManagedSkillTool("scaffold_managed_skill", {
      skill_id: "bam",
      overwrite: true,
    });

    // THEN the change is an update
    expect(edit?.change).toBe("updated");
  });

  test("classifies delete_managed_skill as a deletion", () => {
    // GIVEN a delete call
    // WHEN classified
    const edit = classifyManagedSkillTool("delete_managed_skill", {
      skill_id: "bam",
    });

    // THEN it is the bam skill, deleted
    expect(edit).toEqual({
      ref: { kind: "skill", name: "bam", file: "SKILL.md" },
      change: "deleted",
    });
  });

  test("ignores other tools and inputs without a skill_id", () => {
    // GIVEN a non-managed tool, and a managed tool missing skill_id
    // WHEN classified
    // THEN nothing matches
    expect(
      classifyManagedSkillTool("file_write", { skill_id: "bam" }),
    ).toBeNull();
    expect(classifyManagedSkillTool("scaffold_managed_skill", {})).toBeNull();
    expect(
      classifyManagedSkillTool("scaffold_managed_skill", { skill_id: "  " }),
    ).toBeNull();
  });
});

describe("detectCapabilityEdit", () => {
  test("detects a managed-skill tool by name, ignoring the result text", () => {
    // GIVEN a scaffold_managed_skill call
    const toolUse = toolUseBlock("call-1", "scaffold_managed_skill", {
      skill_id: "bam",
    }) as ToolUseContent;

    // WHEN detecting the capability edit
    const edit = detectCapabilityEdit(toolUse, '{"created":true}');

    // THEN it resolves to the created bam skill
    expect(edit).toEqual({
      ref: { kind: "skill", name: "bam", file: "SKILL.md" },
      change: "created",
    });
  });

  test("detects a filesystem edit by path, labeling new files as created", () => {
    // GIVEN a file_write to a new skill file
    const toolUse = toolUseBlock("call-1", "file_write", {
      path: "skills/sanity/SKILL.md",
    }) as ToolUseContent;

    // WHEN detecting the capability edit from a new-file result
    const edit = detectCapabilityEdit(toolUse, "Wrote file (new file, 40 lines)");

    // THEN it resolves to the created sanity skill
    expect(edit).toEqual({
      ref: { kind: "skill", name: "sanity", file: "SKILL.md" },
      change: "created",
    });
  });

  test("returns null for tools that touch nothing relevant", () => {
    // GIVEN an unrelated tool call
    const toolUse = toolUseBlock("call-1", "web_search", {
      query: "hello",
    }) as ToolUseContent;

    // WHEN detecting the capability edit
    // THEN there is nothing to report
    expect(detectCapabilityEdit(toolUse, "results")).toBeNull();
  });
});

describe("resultLooksLikeNewFile", () => {
  test("detects a new-file write summary", () => {
    // GIVEN a write tool summary for a brand-new file
    // WHEN inspected
    // THEN it is recognized as a creation
    expect(resultLooksLikeNewFile("Wrote skills/a/SKILL.md (new file, 40 lines)")).toBe(
      true,
    );
  });

  test("treats an edit summary as not-new", () => {
    // GIVEN an edit summary
    // WHEN inspected
    // THEN it is not a creation
    expect(resultLooksLikeNewFile("Applied 1 edit (+12 -3)")).toBe(false);
  });
});
