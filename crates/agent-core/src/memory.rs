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
    pub trigger: SkillTrigger,
    pub body: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum SkillTrigger {
    Always,
    Keyword { keywords: Vec<String> },
    Manual,
    Never,
}

#[derive(Debug, Deserialize)]
struct FrontMatter {
    name: Option<String>,
    description: Option<String>,
    trigger: Option<String>,
}

fn parse_trigger(raw: Option<String>) -> SkillTrigger {
    let Some(raw) = raw else {
        return SkillTrigger::Manual;
    };
    let t = raw.trim();
    if t.eq_ignore_ascii_case("always") {
        return SkillTrigger::Always;
    }
    if t.eq_ignore_ascii_case("never") {
        return SkillTrigger::Never;
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
    SkillTrigger::Manual
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
                trigger: parse_trigger(fm.trigger),
                body: parsed.content,
                path: p.to_string_lossy().to_string(),
            },
        );
    }
    Ok(out.into_values().collect())
}

/// Build the `--append-system-prompt` payload for a given user prompt.
/// Returns `None` if there's nothing to append (so we skip the flag entirely).
pub fn build_system_append(user_prompt: &str) -> Result<Option<String>> {
    let mem = read_memory()?;
    let skills = list_skills()?;
    let mut out = String::new();

    if !mem.trim().is_empty() {
        out.push_str("# Persistent agent memory\n\n");
        out.push_str(mem.trim());
        out.push_str("\n\n");
    }

    let lower = user_prompt.to_lowercase();
    let mut included: Vec<&Skill> = Vec::new();

    for s in &skills {
        match &s.trigger {
            SkillTrigger::Always => included.push(s),
            SkillTrigger::Keyword { keywords } => {
                if keywords.iter().any(|k| lower.contains(k)) {
                    included.push(s);
                }
            }
            _ => {}
        }
    }

    if !included.is_empty() {
        out.push_str("# Loaded skills\n\n");
        for s in included {
            out.push_str(&format!("## {}\n", s.name));
            if let Some(d) = &s.description {
                out.push_str(&format!("_{}_\n\n", d));
            }
            out.push_str(s.body.trim());
            out.push_str("\n\n");
        }
    }

    if out.is_empty() {
        Ok(None)
    } else {
        Ok(Some(out))
    }
}
