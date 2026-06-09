import { useEffect, useMemo, useState } from "react";
import { listSkills, readSkill, writeSkill } from "../lib/ipc";
import type { Skill } from "../lib/types";

const NEW_SKILL_TEMPLATE = (name: string) =>
  `---
name: ${name}
description: One-line summary of what this playbook does.
trigger: keyword: ${name}
---

# ${name}

Step-by-step instructions for the agent. Plain markdown.
Reference files, scripts, or external services by absolute path or URL.
`;

/**
 * Modal manager for the skills directory.
 *
 * Layout: master/detail. Left column = list of files in ~/.claude-agent-desktop/skills/.
 * Right column = the selected file's raw text. Save flushes to disk and re-lists.
 * "New skill" prompts for a name and seeds a starter file with frontmatter.
 *
 * We intentionally edit the raw markdown rather than offering a structured
 * form: frontmatter parsing is liberal (gray_matter) and the user keeps full
 * control. The agent loads these via build_system_append on every turn.
 */
export default function SkillsManager({ onClose }: { onClose: () => void }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const list = await listSkills();
      setSkills(list);
      if (!selectedPath && list.length > 0) {
        setSelectedPath(list[0].path);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedPath) {
      setDraft("");
      return;
    }
    void readSkill(selectedPath).then((s) => {
      setDraft(s);
      setDirty(false);
    });
  }, [selectedPath]);

  const selected = useMemo(
    () => skills.find((s) => s.path === selectedPath) ?? null,
    [skills, selectedPath],
  );

  async function onSave() {
    if (!selectedPath) return;
    try {
      await writeSkill(selectedPath, draft);
      setDirty(false);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function onNew() {
    const name = prompt("Skill name (lowercase, no spaces):", "my-skill");
    if (!name) return;
    const safe = name.replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
    if (!safe) return;
    // Skills live next to existing ones; we derive the dir from any existing skill,
    // falling back to a stable default. The backend's seed sets up the dir on first boot.
    const base = skills[0]?.path?.replace(/[\\/][^\\/]+$/, "") ??
      // Windows-friendly default
      `${(navigator as any).userAgent ?? ""}`.includes("Windows")
        ? "%USERPROFILE%\\.claude-agent-desktop\\skills"
        : "~/.claude-agent-desktop/skills";
    const sep = base.includes("\\") ? "\\" : "/";
    const path = `${base}${sep}${safe}.md`;
    try {
      await writeSkill(path, NEW_SKILL_TEMPLATE(safe));
      await refresh();
      setSelectedPath(path);
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div
      className="fixed inset-0 bg-ink-900/80 backdrop-blur-sm grid place-items-center z-50"
      onClick={onClose}
    >
      <div
        className="w-[920px] max-w-[95vw] h-[78vh] bg-ink-800 border border-ink-500 rounded-lg flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-ink-600 flex items-center justify-between">
          <div>
            <div className="font-semibold text-zinc-200">Skills</div>
            <div className="text-[11px] text-zinc-500 font-mono">
              Markdown playbooks with YAML frontmatter. Loaded into the system prompt by trigger.
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onNew}
              className="px-3 py-1.5 text-xs rounded border border-ink-500 hover:bg-ink-600/40"
            >
              + new skill
            </button>
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-200 text-sm px-2"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex">
          <aside className="w-60 border-r border-ink-600 overflow-y-auto p-2">
            {skills.length === 0 ? (
              <div className="px-2 py-3 text-xs text-zinc-500 italic">
                No skills yet. Hit "new skill" to add one.
              </div>
            ) : (
              skills.map((s) => (
                <button
                  key={s.path}
                  onClick={() => setSelectedPath(s.path)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs font-mono mb-1 ${
                    selectedPath === s.path
                      ? "bg-accent/10 border border-accent/40"
                      : "border border-transparent hover:bg-ink-600/30"
                  }`}
                >
                  <div className="text-zinc-100 truncate">{s.name}</div>
                  <div className="text-[10px] text-zinc-500 truncate">
                    {triggerSummary(s)}
                  </div>
                </button>
              ))
            )}
          </aside>

          <div className="flex-1 min-w-0 flex flex-col">
            {selected ? (
              <>
                <div className="px-3 py-2 border-b border-ink-600 text-[11px] text-zinc-500 font-mono truncate">
                  {selected.path}
                </div>
                <textarea
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setDirty(true);
                  }}
                  spellCheck={false}
                  className="flex-1 bg-ink-900 text-zinc-200 font-mono text-sm p-4 resize-none focus:outline-none leading-relaxed"
                />
              </>
            ) : (
              <div className="flex-1 grid place-items-center text-zinc-500 text-sm">
                Select a skill on the left.
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="px-4 py-2 text-xs text-red-400 border-t border-ink-600">{error}</div>
        )}
        <div className="px-4 py-3 border-t border-ink-600 flex items-center justify-end gap-2">
          {dirty && <span className="text-[11px] text-amber-400 mr-2">unsaved changes</span>}
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm rounded border border-ink-500 hover:bg-ink-600/40"
          >
            close
          </button>
          <button
            onClick={onSave}
            disabled={!selected || !dirty}
            className="px-3 py-1.5 text-sm rounded bg-accent text-ink-900 font-semibold disabled:opacity-50"
          >
            save
          </button>
        </div>
      </div>
    </div>
  );
}

function triggerSummary(s: Skill): string {
  switch (s.trigger.kind) {
    case "always":
      return "trigger: always";
    case "keyword":
      return `trigger: keyword: ${s.trigger.keywords.join(", ")}`;
    case "manual":
      return "trigger: manual";
    case "never":
      return "trigger: never";
  }
}
