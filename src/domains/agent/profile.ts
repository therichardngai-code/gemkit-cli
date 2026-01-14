/**
 * Agent profile loading
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';
import { AgentProfile } from './types.js';
import { getAgentsDir } from '../../utils/paths.js';

/**
 * Load a single agent profile by name
 */
export function loadAgentProfile(name: string, projectDir?: string): AgentProfile | null {
  const agentsDir = getAgentsDir(projectDir);
  const filePath = join(agentsDir, `${name}.md`);

  if (!existsSync(filePath)) {
    return null;
  }

  return parseAgentProfile(filePath);
}

/**
 * List all available agent profiles
 */
export function listAgentProfiles(projectDir?: string): AgentProfile[] {
  const agentsDir = getAgentsDir(projectDir);

  if (!existsSync(agentsDir)) {
    return [];
  }

  const files = readdirSync(agentsDir).filter(f => f.endsWith('.md'));
  const profiles: AgentProfile[] = [];

  for (const file of files) {
    const filePath = join(agentsDir, file);
    const profile = parseAgentProfile(filePath);
    if (profile) {
      profiles.push(profile);
    }
  }

  return profiles;
}

/**
 * Parse YAML frontmatter from markdown
 */
function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const fm: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    fm[key] = val;
  }
  return fm;
}

/**
 * Parse skills - handles single/multiple/array formats:
 * - "research" -> ["research"]
 * - "skill1, skill2" -> ["skill1", "skill2"]
 * - "[skill1, skill2]" -> ["skill1", "skill2"]
 */
function parseSkills(value: string | undefined): string[] {
  if (!value) return [];
  let v = value.trim();
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  return v.split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
}

/**
 * Parse agent profile from markdown file
 */
function parseAgentProfile(filePath: string): AgentProfile | null {
  if (!existsSync(filePath)) {
    return null;
  }

  const content = readFileSync(filePath, 'utf-8');
  const name = basename(filePath, '.md');

  let description = '';
  let model = 'gemini-2.5-flash';
  let skills: string[] = [];

  // Parse YAML frontmatter
  const fm = parseFrontmatter(content);
  let cleanContent = content;

  if (fm) {
    if (fm.description) description = fm.description;
    if (fm.model) model = fm.model;
    skills = parseSkills(fm.skills);
    // Strip frontmatter from content to avoid duplication
    cleanContent = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
  } else {
    // Fallback: parse from content body
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.startsWith('# ')) {
        description = line.substring(2).trim();
        break;
      }
      if (line.trim() && !line.startsWith('#')) {
        description = line.trim();
        break;
      }
    }

    const modelMatch = content.match(/model:\s*(.+)/i);
    if (modelMatch) model = modelMatch[1].trim();

    const skillsMatch = content.match(/skills:\s*(.+)/i);
    if (skillsMatch) skills = parseSkills(skillsMatch[1]);
  }

  return {
    name,
    description,
    model,
    skills,
    content: cleanContent,
    filePath,
  };
}

/**
 * Get agent profile details as formatted string
 */
export function formatAgentProfile(profile: AgentProfile): string {
  let output = `Agent: ${profile.name}\n`;
  output += `Description: ${profile.description}\n`;
  output += `Model: ${profile.model}\n`;
  if (profile.skills && profile.skills.length > 0) {
    output += `Skills: ${profile.skills.join(', ')}\n`;
  }
  output += `Path: ${profile.filePath}\n`;
  return output;
}
