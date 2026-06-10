// The skill library / marketplace. Browse by category, search, inspect a
// skill's full detail, and attach it to your next message ("Use this skill").
// Malformed skills are filtered upstream; any that failed validation are
// surfaced as a banner so they're visible, not silently missing.

import { useMemo, useState } from "react";
import { SKILLS, SKILL_LOAD_ERRORS } from "../lib/skills";
import { CATEGORIES, categoryIcon, type SafetyLevel, type Skill, type SkillCategory } from "../lib/skills/types";

const SAFETY_LABEL: Record<SafetyLevel, { label: string; tone: string }> = {
  "read-only": { label: "read-only", tone: "bg-emerald-500/15 text-emerald-400" },
  "writes-files": { label: "writes files", tone: "bg-sky-500/15 text-sky-400" },
  "runs-commands": { label: "runs commands", tone: "bg-amber-500/15 text-amber-400" },
  destructive: { label: "destructive", tone: "bg-red-500/15 text-red-400" },
};

export default function SkillLibrary({
  onUse,
  onClose,
}: {
  onUse: (skill: Skill, prompt?: string) => void;
  onClose: () => void;
}) {
  const [cat, setCat] = useState<SkillCategory | "all">("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Skill | null>(null);

  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const s of SKILLS) m[s.category] = (m[s.category] ?? 0) + 1;
    return m;
  }, []);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return SKILLS.filter((s) => {
      if (cat !== "all" && s.category !== cat) return false;
      if (!needle) return true;
      return (
        s.name.toLowerCase().includes(needle) ||
        s.description.toLowerCase().includes(needle) ||
        s.purpose.toLowerCase().includes(needle) ||
        s.examplePrompts.some((p) => p.toLowerCase().includes(needle))
      );
    });
  }, [cat, q]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/80 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-[80vh] w-[920px] max-w-[94vw] flex-col overflow-hidden rounded-xl border border-ink-500 bg-ink-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center justify-between border-b border-ink-600 px-4 py-3">
          <div>
            <div className="font-semibold text-zinc-100">Skill Library</div>
            <div className="font-mono text-[11px] text-zinc-500">
              {SKILLS.length} expert workflows across {CATEGORIES.length} categories
            </div>
          </div>
          <button onClick={onClose} className="px-2 text-sm text-zinc-400 hover:text-zinc-200">
            ✕
          </button>
        </div>

        {SKILL_LOAD_ERRORS.length > 0 && (
          <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-300">
            ⚠ {SKILL_LOAD_ERRORS.length} skill(s) failed validation and were skipped:{" "}
            {SKILL_LOAD_ERRORS.map((e) => e.name ?? e.id ?? "unnamed").join(", ")}
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          {/* category sidebar */}
          <aside className="w-52 flex-none overflow-y-auto border-r border-ink-600 bg-ink-800/60 p-2">
            <CatButton active={cat === "all"} onClick={() => setCat("all")} icon="✦" label="All skills" count={SKILLS.length} />
            {CATEGORIES.map((c) => (
              <CatButton
                key={c.id}
                active={cat === c.id}
                onClick={() => setCat(c.id)}
                icon={c.icon}
                label={c.label}
                count={counts[c.id] ?? 0}
              />
            ))}
          </aside>

          {/* main */}
          <main className="flex min-w-0 flex-1 flex-col">
            {selected ? (
              <SkillDetail
                skill={selected}
                onBack={() => setSelected(null)}
                onUse={(prompt) => onUse(selected, prompt)}
              />
            ) : (
              <>
                <div className="border-b border-ink-600 p-3">
                  <input
                    autoFocus
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search skills…"
                    className="w-full rounded border border-ink-500 bg-ink-700/40 px-3 py-1.5 text-sm font-mono text-zinc-100 placeholder:text-zinc-600 focus:border-accent/60"
                  />
                </div>
                <div className="grid flex-1 grid-cols-2 content-start gap-2 overflow-y-auto p-3">
                  {results.length === 0 && (
                    <div className="col-span-2 grid place-items-center py-16 text-sm text-zinc-600">
                      No skills match "{q}".
                    </div>
                  )}
                  {results.map((s) => (
                    <SkillCard key={s.id} skill={s} onOpen={() => setSelected(s)} onUse={() => onUse(s)} />
                  ))}
                </div>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

function CatButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs ${
        active ? "bg-accent/10 text-accent" : "text-zinc-300 hover:bg-ink-700/40"
      }`}
    >
      <span className="flex-none">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="flex-none text-[10px] text-zinc-600">{count}</span>
    </button>
  );
}

function SkillCard({ skill, onOpen, onUse }: { skill: Skill; onOpen: () => void; onUse: () => void }) {
  const safety = SAFETY_LABEL[skill.safetyLevel];
  return (
    <div className="group flex flex-col rounded-lg border border-ink-600 bg-ink-700/20 p-3 hover:border-ink-500">
      <button onClick={onOpen} className="text-left">
        <div className="flex items-center gap-2">
          <span className="flex-none">{categoryIcon(skill.category)}</span>
          <span className="truncate text-sm font-semibold text-zinc-100">{skill.name}</span>
        </div>
        <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-zinc-400">{skill.description}</p>
      </button>
      <div className="mt-2 flex items-center justify-between">
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-mono ${safety.tone}`}>{safety.label}</span>
        <div className="flex gap-2 text-[10px] font-mono">
          <button onClick={onOpen} className="text-zinc-500 hover:text-zinc-200">
            details
          </button>
          <button onClick={onUse} className="text-accent hover:underline">
            use →
          </button>
        </div>
      </div>
    </div>
  );
}

function SkillDetail({ skill, onBack, onUse }: { skill: Skill; onBack: () => void; onUse: (prompt?: string) => void }) {
  const safety = SAFETY_LABEL[skill.safetyLevel];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-ink-600 px-4 py-2">
        <button onClick={onBack} className="text-xs text-zinc-500 hover:text-zinc-200">
          ← all skills
        </button>
        <button
          onClick={() => onUse()}
          className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-ink-900 hover:bg-white"
        >
          ⚡ Use this skill
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="flex items-center gap-2">
          <span>{categoryIcon(skill.category)}</span>
          <h2 className="text-lg font-semibold text-zinc-100">{skill.name}</h2>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${safety.tone}`}>{safety.label}</span>
        </div>
        <p className="mt-1 text-sm text-zinc-300">{skill.purpose}</p>
        <p className="mt-1 text-xs text-zinc-500">
          <span className="uppercase tracking-wide text-zinc-600">When to use: </span>
          {skill.whenToUse}
        </p>

        <Section title="What it does">
          <ol className="list-decimal space-y-1 pl-5 text-xs text-zinc-300">
            {skill.steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </Section>

        <div className="grid grid-cols-2 gap-4">
          <Section title="You provide">
            <Bullets items={skill.inputs} />
          </Section>
          <Section title="You get back">
            <Bullets items={skill.outputs} />
          </Section>
        </div>

        <Section title="Try it — example prompts">
          <div className="flex flex-col gap-1">
            {skill.examplePrompts.map((p, i) => (
              <button
                key={i}
                onClick={() => onUse(p)}
                className="rounded border border-ink-600 bg-ink-700/30 px-2 py-1 text-left text-xs text-zinc-300 hover:border-accent/40 hover:text-accent"
                title="Use this skill with this prompt"
              >
                "{p}"
              </button>
            ))}
          </div>
        </Section>

        <div className="grid grid-cols-2 gap-4">
          <Section title="A good result">
            <Bullets items={skill.successCriteria} />
          </Section>
          <Section title="Avoids">
            <Bullets items={skill.failureModes} />
          </Section>
        </div>

        <Section title="Tools & safety">
          <div className="space-y-1 text-xs text-zinc-400">
            {skill.toolsAllowed.length > 0 && (
              <div>
                <span className="text-zinc-600">prefers:</span> {skill.toolsAllowed.join(", ")}
              </div>
            )}
            {skill.toolsDisallowed.length > 0 && (
              <div>
                <span className="text-zinc-600">avoids:</span> {skill.toolsDisallowed.join(", ")}
              </div>
            )}
            <div>
              <span className="text-zinc-600">safety:</span> {safety.label}
              {skill.confirmationRequired ? " · confirmation required" : ""}
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{title}</div>
      {children}
    </div>
  );
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-0.5 pl-4 text-xs text-zinc-300">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}
