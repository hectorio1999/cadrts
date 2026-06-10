//! Memory + skills compiler.
//!
//! Every turn we build a single `--append-system-prompt` string that the
//! Claude Code CLI grafts onto its built-in agent system prompt. Order:
//!
//!   1. Memory header + body (verbatim contents of `~/.claude-agent-desktop/memory.md`)
//!   2. Always-on skills (frontmatter `trigger: always`)
//!   3. Keyword-matched skills (frontmatter `trigger: keyword: foo,bar`)
//!      that fire when the user's prompt mentions a listed keyword
//!
//! Skills tagged `trigger: manual` are not auto-injected; the UI invokes them
//! by name. `trigger: never` skills are skipped (useful for drafts).

use anyhow::Result;
use gray_matter::engine::YAML;
use gray_matter::Matter;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skill {
    pub name: String,
    pub description: Option<String>,
    /// The situation that should trigger this skill (frontmatter `when:`),
    /// shown in the catalog so the agent can match it to a request.
    pub when: Option<String>,
    pub trigger: SkillTrigger,
    pub body: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SkillTrigger {
    /// Full body injected every turn (persona, style, standing reference).
    Always,
    /// Listed in the catalog; the agent applies it automatically when relevant.
    Auto,
    /// Legacy keyword trigger — now also surfaced in the catalog (the agent
    /// decides), so the substring keywords are advisory rather than gating.
    Keyword { keywords: Vec<String> },
    /// Listed in the catalog (the agent may apply it).
    Manual,
    /// Excluded entirely (drafts).
    Never,
}

#[derive(Debug, Deserialize)]
struct FrontMatter {
    name: Option<String>,
    description: Option<String>,
    when: Option<String>,
    trigger: Option<String>,
}

fn parse_trigger(raw: Option<String>) -> SkillTrigger {
    let Some(raw) = raw else {
        return SkillTrigger::Auto;
    };
    let t = raw.trim();
    if t.eq_ignore_ascii_case("always") {
        return SkillTrigger::Always;
    }
    if t.eq_ignore_ascii_case("never") {
        return SkillTrigger::Never;
    }
    if t.eq_ignore_ascii_case("auto") {
        return SkillTrigger::Auto;
    }
    if t.eq_ignore_ascii_case("manual") {
        return SkillTrigger::Manual;
    }
    if let Some(rest) = t.strip_prefix("keyword:") {
        let kws: Vec<String> = rest
            .split(',')
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty())
            .collect();
        return SkillTrigger::Keyword { keywords: kws };
    }
    SkillTrigger::Auto
}

pub fn read_memory() -> Result<String> {
    let path = crate::paths::memory_path()?;
    if !path.exists() {
        return Ok(String::new());
    }
    Ok(std::fs::read_to_string(&path)?)
}

pub fn list_skills() -> Result<Vec<Skill>> {
    let dir = crate::paths::skills_dir()?;
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut out = BTreeMap::new();
    let matter = Matter::<YAML>::new();
    for entry in WalkDir::new(&dir).max_depth(2).into_iter().flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let Some(ext) = p.extension().and_then(|e| e.to_str()) else {
            continue;
        };
        if ext != "md" {
            continue;
        }
        let raw = match std::fs::read_to_string(p) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let parsed = matter.parse(&raw);
        let fm: FrontMatter = parsed
            .data
            .as_ref()
            .and_then(|d| d.deserialize().ok())
            .unwrap_or(FrontMatter {
                name: None,
                description: None,
                when: None,
                trigger: None,
            });
        let name = fm.name.unwrap_or_else(|| {
            p.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unnamed")
                .to_string()
        });
        out.insert(
            name.clone(),
            Skill {
                name,
                description: fm.description,
                when: fm.when,
                trigger: parse_trigger(fm.trigger),
                body: parsed.content,
                path: p.to_string_lossy().to_string(),
            },
        );
    }
    Ok(out.into_values().collect())
}

/// Build the `--append-system-prompt` payload. The skill system is automatic:
/// `always` skills are injected in full (persona/style/reference); every other
/// skill is listed in a compact catalog and the agent applies the right one on
/// its own — the user never names a skill. A self-improvement section lets the
/// agent grow the library by writing new skill files.
///
/// `user_prompt` is unused now (selection is the model's job, not substring
/// matching), but kept in the signature for callers.
pub fn build_system_append(_user_prompt: &str) -> Result<Option<String>> {
    let mem = read_memory()?;
    let skills = list_skills()?;
    let skills_dir = crate::paths::skills_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "~/.claude-agent-desktop/skills".to_string());
    let mut out = String::new();

    if !mem.trim().is_empty() {
        out.push_str("# Persistent agent memory\n\n");
        out.push_str(mem.trim());
        out.push_str("\n\n");
    }

    // Always-on guidance: full body (persona, tone, standing reference).
    let always: Vec<&Skill> = skills
        .iter()
        .filter(|s| matches!(s.trigger, SkillTrigger::Always))
        .collect();
    if !always.is_empty() {
        out.push_str("# Always-on guidance\n\n");
        for s in always {
            out.push_str(&format!("## {}\n", s.name));
            if let Some(d) = &s.description {
                out.push_str(&format!("_{}_\n\n", d));
            }
            out.push_str(s.body.trim());
            out.push_str("\n\n");
        }
    }

    // Skill catalog: everything else the agent can apply automatically.
    let catalog: Vec<&Skill> = skills
        .iter()
        .filter(|s| !matches!(s.trigger, SkillTrigger::Always | SkillTrigger::Never))
        .collect();
    if !catalog.is_empty() {
        out.push_str("# Skill library — apply the right one automatically\n\n");
        out.push_str(
            "You have a library of reusable expert workflows (\"skills\"), listed below. \
             When the user's request matches a skill's purpose, silently follow that skill's \
             workflow — the user does NOT need to name it, ask for it, or know it exists. \
             Pick the single best-fitting skill (or none if nothing fits) and apply it. \
             For the full step-by-step workflow, read the skill's file with your Read tool \
             before you start; the catalog line is only a summary.\n\n",
        );
        for s in catalog {
            let desc = s.description.as_deref().unwrap_or("").trim();
            let when = s
                .when
                .as_deref()
                .map(|w| format!(" — use when: {}", w.trim()))
                .unwrap_or_default();
            out.push_str(&format!("- **{}**: {}{} [{}]\n", s.name, desc, when, s.path));
        }
        out.push('\n');
    }

    // Self-improvement: the agent grows its own library over time.
    out.push_str(&format!(
        "# Growing your skills (self-improvement)\n\n\
         Your skills live as markdown files in: `{dir}`\n\n\
         When a request would clearly benefit from a reusable workflow you don't yet have a \
         skill for — AND it's the kind of task likely to recur for this user — create a new \
         skill AFTER you finish the task. Write a file `{dir}/<kebab-id>.md` in exactly this \
         format:\n\n\
         ```\n\
         ---\n\
         name: <Skill Name>\n\
         category: <coding|writing|research|business|productivity|data|documents|design|learning|creative|it|personal>\n\
         description: <one line>\n\
         when: <the situation that should trigger it>\n\
         trigger: auto\n\
         ---\n\n\
         Purpose: <what it's for>\n\
         Steps:\n\
         1. <concrete step>\n\
         ...\n\
         A good result:\n\
         - <criterion>\n\
         Avoid:\n\
         - <failure mode>\n\
         When finished: <how to close out>\n\
         ```\n\n\
         Rules: only create a skill when it's genuinely reusable (never for one-off requests); \
         keep it general enough to reuse but tuned to how THIS user likes the task done; reuse \
         and refine existing skills instead of duplicating them; and don't announce that you \
         created a skill unless asked — just quietly get better over time.\n\n",
        dir = skills_dir
    ));

    if out.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(out))
    }
}
